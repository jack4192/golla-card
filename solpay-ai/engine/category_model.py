"""업종 확률 v2: LightGBM 다중분류.

입력은 배치 시각에 앱이 알 수 있는 값만 쓴다. 사용자 유형, 습관 설정 같은 생성기 전용 컬럼은 쓰지 않는다.
모델이 없으면 엔진은 v1(사용자별 시간대 빈도)으로 동작한다.
"""

import json
from datetime import datetime
from pathlib import Path

import numpy as np

from engine.slots import band_of, is_weekend, slot_of
from engine.state import UserState

BASE_FEATURES = ("hour", "weekday", "is_weekend", "band", "prev_category", "hours_since_prev",
                 "today_count", "slot_count", "total_count")


def features(state: UserState, at: datetime, categories: list[str]) -> list[float]:
    h = state.history
    slot = slot_of(at, state.params)
    slot_counts = h.slot_counts.get(slot, {})
    slot_total = sum(slot_counts.values())
    total = sum(h.category_counts.values())
    prev = -1.0
    since = 999.0
    if h.last is not None:
        prev = float(categories.index(h.last.category)) if h.last.category in categories else -1.0
        since = min((at - h.last.paid_at).total_seconds() / 3600, 999.0)
    today = h.today_count if h.today is not None and h.today.date() == at.date() else 0
    row = [at.hour, at.weekday(), float(is_weekend(at, state.params)), band_of(at.hour), prev, since,
           today, slot_total, total]
    row += [slot_counts.get(c, 0) / slot_total if slot_total else 0.0 for c in categories]
    row += [h.category_counts.get(c, 0) / total if total else 0.0 for c in categories]
    return row


def feature_names(categories: list[str]) -> list[str]:
    return list(BASE_FEATURES) + [f"slot_{c}" for c in categories] + [f"all_{c}" for c in categories]


class CategoryModel:
    def __init__(self, booster, categories: list[str]):
        self.booster = booster
        self.categories = categories

    def predict(self, state: UserState, at: datetime) -> dict[str, float]:
        x = np.array([features(state, at, self.categories)], dtype=np.float32)
        probs = self.booster.predict(x)[0]
        return {c: float(p) for c, p in zip(self.categories, probs)}

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        self.booster.save_model(str(directory / "category_lgbm.txt"))
        (directory / "category_classes.json").write_text(
            json.dumps(self.categories, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, directory: Path) -> "CategoryModel | None":
        model, classes = directory / "category_lgbm.txt", directory / "category_classes.json"
        if not model.exists() or not classes.exists():
            return None
        import lightgbm as lgb
        return cls(lgb.Booster(model_file=str(model)), json.loads(classes.read_text(encoding="utf-8")))
