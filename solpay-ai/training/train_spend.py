"""남은 소비 예측 모델(LightGBM 분위수 회귀)을 학습하고 지금 방식(지난달 일평균 × 남은 일수)과 비교한다.

배경 사용자마다 8~10월의 1, 4, 7, …, 28일 정오에
  입력 : engine.spend_model.features (그 시각까지의 결제만)
  정답 : 그 시각부터 월말까지의 실제 현장 결제액
을 만든다. 평가는 전략 선택 모델과 같은 사용자 단위 5겹 교차검증이다.

    uv run python -m training.train_spend
"""

import calendar
import json
import math
from datetime import datetime
from zoneinfo import ZoneInfo

import lightgbm as lgb
import numpy as np

from engine import loader
from engine.loader import ARTIFACTS
from engine.ml import FOLDS, user_folds
from engine.params import Params
from engine.spend_model import FEATURES, QUANTILES, features
from engine.state import UserState

KST = ZoneInfo("Asia/Seoul")
MONTHS = ("2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10")
DAYS = range(1, 29, 3)
LGB_PARAMS = dict(learning_rate=0.05, num_leaves=15, min_data_in_leaf=30, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, verbose=-1, seed=7)
ROUNDS = 200


def collect():
    catalog = loader.load_catalog()
    users, cards = loader.load_users(), loader.load_user_cards()
    payments = loader.payments_from_frame(loader.read_payments())
    params = Params()
    xs, ys, base, owners = [], [], [], []
    for user_id in sorted(u for u in users if u >= 1000):
        rows = payments.get(user_id, [])
        state = UserState(users[user_id], cards[user_id], catalog, params, benefit_start="9999-12")
        i = 0
        for ym in MONTHS:
            year, month = int(ym[:4]), int(ym[5:])
            last = calendar.monthrange(year, month)[1]
            month_end = datetime(year, month, last, 23, 59, 59, tzinfo=KST)
            for day in DAYS:
                at = datetime(year, month, day, 12, tzinfo=KST)
                while i < len(rows) and rows[i].paid_at < at:
                    state.apply(rows[i])
                    i += 1
                state.roll_to(ym)
                if not state.prev_rows:
                    continue
                target = sum(p.amount for p in rows[i:] if p.is_placement and p.paid_at <= month_end)
                days_left = last - day + 0.5
                daily = sum(p.amount for p in state.prev_rows if p.is_placement) / calendar.monthrange(
                    *(int(x) for x in state.prev_ym.split("-")))[1]
                xs.append(features(state, at))
                ys.append(target)
                base.append((daily * days_left, max(daily * math.sqrt(days_left), 1.0)))
                owners.append(user_id)
    return np.array(xs, dtype=np.float32), np.array(ys, dtype=float), np.array(base), np.array(owners)


def train(x, y) -> dict:
    return {q: lgb.train({**LGB_PARAMS, "objective": "quantile", "alpha": q},
                         lgb.Dataset(x, y, feature_name=list(FEATURES)), ROUNDS) for q in QUANTILES}


def main() -> None:
    x, y, base, owners = collect()
    fold_of = user_folds(np.unique(owners))
    folds = np.array([fold_of[int(u)] for u in owners])
    pred = np.zeros((len(y), len(QUANTILES)))
    out = ARTIFACTS / "spend"
    out.mkdir(parents=True, exist_ok=True)

    def save(models, name):
        for q, m in models.items():
            m.save_model(str(out / f"{name}_q{int(q * 100)}.txt"))

    for k in range(FOLDS):
        models = train(x[folds != k], y[folds != k])
        for j, q in enumerate(QUANTILES):
            pred[folds == k, j] = models[q].predict(x[folds == k])
        save(models, f"fold{k}")
    save(train(x, y), "full")

    def summary(mid, low, high):
        return {"평균 절대 오차(원)": round(float(np.abs(mid - y).mean())),
                "16~84% 구간 포함률": round(float(((y >= low) & (y <= high)).mean()), 3)}

    report = {
        "행 수": int(len(y)),
        "지금 방식(지난달 일평균 × 남은 일수, ±σ)": summary(base[:, 0], base[:, 0] - base[:, 1], base[:, 0] + base[:, 1]),
        "남은 소비 예측 모델(교차검증)": summary(pred[:, 1], pred[:, 0], pred[:, 2]),
    }
    (out / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
