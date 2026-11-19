"""사용자 맞춤 실적 채우기 전략 선택 모델(LightGBM)을 학습한다.

배경 사용자마다 8~10월 각 달에 대해
  입력  : 그 달 1일에 알 수 있는 값 (지난달 결제, 보유 카드 구간 혜택, 본인 지난달 시뮬레이션 점수)  engine.strategy.features
  정답  : 그 달의 실제 결제를 세 전략으로 각각 다시 골랐을 때의 점수                          engine.strategy.simulate
전략마다 회귀 모델 하나씩 (점수 − 세 전략 평균) ÷ 지난달 현장 결제의 1% 를 예측하고, 예측이 가장 큰 전략을 고른다.
세 전략 점수가 같은 달이 절반 가까이라 '1위 전략' 분류보다 점수 차이 회귀가 손실이 작았다 (교차검증 748원 vs 795원).
을 만든다. 데모 사용자 5명은 학습에 넣지 않는다.
평가는 사용자 단위 5겹 교차검증이다 (같은 사용자의 다른 달이 학습과 평가에 같이 들어가지 않게).
재생 평가는 배경 사용자마다 그 사용자를 빼고 학습한 겹 모델을 쓴다.

    uv run python -m training.train_strategy
"""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import lightgbm as lgb
import numpy as np

from engine import loader
from engine.loader import ARTIFACTS
from engine.ml import FOLDS, user_folds
from engine.params import STRATEGIES, Params
from engine.perf_value import month_plan
from engine.state import UserState
from engine.strategy import FEATURES, features, self_scores, simulate

KST = ZoneInfo("Asia/Seoul")
MONTHS = ("2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10")
LGB_PARAMS = dict(objective="regression", learning_rate=0.05, num_leaves=7, min_data_in_leaf=20,
                  feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=7)
ROUNDS = 80


def collect():
    """(x, y, 정답 전략 점수, 본인 시뮬레이션 점수, user_id) — 사용자·달마다 한 행."""
    catalog = loader.load_catalog()
    users, cards = loader.load_users(), loader.load_user_cards()
    payments = loader.payments_from_frame(loader.read_payments())
    params = Params()                                   # 기본 전략(A)으로 상태만 쌓는다
    xs, ys, label_scores, sim_scores, owners = [], [], [], [], []
    for user_id in sorted(u for u in users if u >= 1000):
        rows = payments.get(user_id, [])
        state = UserState(users[user_id], cards[user_id], catalog, params, benefit_start="2026-08")
        by_month: dict[str, list] = {}
        for p in rows:
            by_month.setdefault(p.paid_at.strftime("%Y-%m"), []).append(p)
        i = 0
        for ym in MONTHS:
            start = datetime(int(ym[:4]), int(ym[5:]), 1, tzinfo=KST)
            while i < len(rows) and rows[i].paid_at < start:
                state.apply(rows[i])
                i += 1
            state.roll_to(ym)
            month = by_month.get(ym, [])
            if not state.prev_rows or not month:
                continue
            plan = month_plan(state)
            scores = self_scores(state, plan)
            start_prev = {uc: st.prev_perf for uc, st in state.ledger.items()}
            truth = {s: simulate(state, s, month, start_prev, plan, params) for s in STRATEGIES}
            xs.append(features(state, plan, scores))
            ys.append(max(range(len(STRATEGIES)), key=lambda k: (truth[STRATEGIES[k]], -k)))
            label_scores.append([truth[s] for s in STRATEGIES])
            sim_scores.append([scores[s] for s in STRATEGIES])
            owners.append(user_id)
    return (np.array(xs, dtype=np.float32), np.array(ys), np.array(label_scores), np.array(sim_scores),
            np.array(owners))


def targets(x, label_scores):
    scale = np.maximum(np.expm1(x[:, 0]) / 100, 1.0)          # place_log → 지난달 현장 결제의 1%
    return (label_scores - label_scores.mean(axis=1, keepdims=True)) / scale[:, None]


def train(x, target) -> list:
    return [lgb.train(LGB_PARAMS, lgb.Dataset(x, target[:, k], feature_name=list(FEATURES)), ROUNDS)
            for k in range(len(STRATEGIES))]


def save(models, out, name) -> None:
    for s, m in zip(STRATEGIES, models):
        m.save_model(str(out / f"{name}_{s}.txt"))


def regret(choice: np.ndarray, scores: np.ndarray) -> dict:
    """고른 전략의 점수가 그 달 최선 전략보다 얼마나 낮은지 (원, 사용자·달 평균)."""
    best = scores.max(axis=1)
    got = scores[np.arange(len(scores)), choice]
    return {"최선 일치율": round(float((got == best).mean()), 3), "평균 손실(원)": round(float((best - got).mean()), 1)}


def main() -> None:
    x, y, label_scores, sim_scores, owners = collect()
    target = targets(x, label_scores)
    fold_of = user_folds(np.unique(owners))
    folds = np.array([fold_of[int(u)] for u in owners])

    predicted = np.zeros(len(y), dtype=int)
    out = ARTIFACTS / "strategy"
    out.mkdir(parents=True, exist_ok=True)
    for k in range(FOLDS):
        models = train(x[folds != k], target[folds != k])
        predicted[folds == k] = np.column_stack([m.predict(x[folds == k]) for m in models]).argmax(axis=1)
        save(models, out, f"fold{k}")
    full = train(x, target)
    save(full, out, "full")
    (out / "folds.json").write_text(json.dumps(fold_of), encoding="utf-8")

    report = {
        "행 수(사용자·달)": int(len(y)),
        "정답 분포": {s: int((y == k).sum()) for k, s in enumerate(STRATEGIES)},
        **{f"항상 {s}": regret(np.full(len(y), k), label_scores) for k, s in enumerate(STRATEGIES)},
        "본인 지난달 시뮬레이션 1위": regret(sim_scores.argmax(axis=1), label_scores),
        "전략 선택 모델(교차검증)": regret(predicted, label_scores),
        "중요한 입력": dict(sorted(zip(FEATURES, (int(sum(v)) for v in zip(*(m.feature_importance("gain") for m in full)))),
                              key=lambda kv: -kv[1])[:8]),
    }
    (out / "metrics.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
