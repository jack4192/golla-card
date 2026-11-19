"""남은 소비 예측: 지금부터 월말까지의 현장 결제액을 LightGBM 분위수 회귀(16%, 50%, 84%)로 예측한다.

실적 기여 가치의 '남은 예산'과 그 불확실성(σ)에 쓴다. 모델이 없으면 지난달 일평균 × 남은 일수로 계산한다.
입력은 그 시각까지 앱이 아는 결제만 쓴다.
"""

import calendar
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

QUANTILES = (0.16, 0.5, 0.84)
FEATURES = ("day", "days_left", "weekend_left", "spent_month", "count_month", "prev_total", "prev_after",
            "last7", "last28", "daily_month", "daily_prev")


def _weekend_days(start: datetime, end_day: int, holidays: tuple[str, ...]) -> int:
    n, day = 0, start.date()
    while day.day <= end_day and day.month == start.month:
        n += day.weekday() >= 5 or day.isoformat() in holidays
        day += timedelta(days=1)
    return n


def features(state, at: datetime) -> list[float]:
    last_day = calendar.monthrange(at.year, at.month)[1]
    days_left = last_day - at.day + (24 - at.hour - at.minute / 60) / 24
    cur = [p for p in state.cur_rows if p.is_placement and p.paid_at < at]
    prev = [p for p in state.prev_rows if p.is_placement]
    spent = sum(p.amount for p in cur)
    prev_total = sum(p.amount for p in prev)
    prev_after = sum(p.amount for p in prev if (p.paid_at.day, p.paid_at.hour) >= (at.day, at.hour))
    recent = cur + prev
    last7 = sum(p.amount for p in recent if at - p.paid_at <= timedelta(days=7))
    last28 = sum(p.amount for p in recent if at - p.paid_at <= timedelta(days=28))
    elapsed = max(at.day - 1 + at.hour / 24, 0.5)
    prev_days = 30.0
    return [at.day, days_left, _weekend_days(at, last_day, state.params.holidays), spent, len(cur), prev_total,
            prev_after, last7, last28, spent / elapsed, prev_total / prev_days]


class SpendModel:
    def __init__(self, boosters: dict):
        self.boosters = boosters

    def predict(self, state, at: datetime) -> tuple[float, float, float]:
        row = np.array([features(state, at)], dtype=np.float32)
        low, mid, high = (max(float(self.boosters[q].predict(row)[0]), 0.0) for q in QUANTILES)
        return low, mid, max(high, mid)

    @classmethod
    def load(cls, directory: Path, name: str = "full") -> "SpendModel | None":
        paths = {q: directory / f"{name}_q{int(q * 100)}.txt" for q in QUANTILES}
        if not all(p.exists() for p in paths.values()):
            return None
        import lightgbm as lgb
        return cls({q: lgb.Booster(model_file=str(p)) for q, p in paths.items()})
