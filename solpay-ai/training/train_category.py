"""업종 확률 v2(LightGBM)를 가상 데이터로 학습하고 v1(개인 빈도)과 비교한다.

시간순으로 나눈다. 기본값은 2025-11~12월을 이력으로만 쓰고, 2026-01~06월로 학습하고, 07~10월로 평가한다.
입력은 engine.category_model.features 가 만드는 값뿐이며 생성기 전용 컬럼은 쓰지 않는다.

    uv run python -m training.train_category
    uv run python -m training.train_category --train-until 2026-11-06 --test-until 2026-11-06   # 시연용 최종 모델
"""

import argparse
import json
import math
from datetime import datetime
from zoneinfo import ZoneInfo

import lightgbm as lgb
import numpy as np
import pandas as pd

from engine import loader
from engine.category_model import CategoryModel, feature_names, features
from engine.loader import ARTIFACTS
from engine.params import Params
from engine.priors import Priors
from engine.scenarios import time_category_probs
from engine.state import UserState
from training.build_priors import placement_mask, priors_from_frame

KST = ZoneInfo("Asia/Seoul")
NO_BENEFIT = "9999-12"          # 혜택 계산은 학습에 필요 없다

# 2026-11-23 튜닝 (v2.1 가상 데이터, 1~4월 학습·5~6월 검증, 약 30조합): 검증 로그 손실 1.6452 → 1.6404.
# 이전 값: 학습률 0.05, 잎 15, L2 5, max_bin 255. 재생 혜택률은 그대로(1.316%)였고 팀 결정으로 설정값만 바꿨다.
# 근거: artifacts/data_v2_1/tune, docs/설계/2026-11-23-data-v2.1-routines-design.md
LGB_PARAMS = {"learning_rate": 0.03, "num_leaves": 31, "min_data_in_leaf": 40, "feature_fraction": 0.7,
              "lambda_l2": 20.0, "seed": 20261127, "verbose": -1, "num_threads": 4}
MAX_BIN = 63            # Dataset 을 만들 때 정해지는 값
MAX_ROUNDS = 2000       # 학습률을 낮춰서 넉넉히 두고 조기 종료로 멈춘다
EARLY_STOP = 30


def train_params(n_class: int) -> dict:
    return {"objective": "multiclass", "num_class": n_class, "metric": "multi_logloss", **LGB_PARAMS}


def dataset(x, y, names: list[str], categorical: list[str]) -> lgb.Dataset:
    return lgb.Dataset(x, label=y, feature_name=names, categorical_feature=categorical, params={"max_bin": MAX_BIN})


def collect(df, users, cards, catalog, params, categories, train_from, train_until, test_until, priors):
    train_x, train_y, test_x, test_y, baseline = [], [], [], [], []
    index = {c: i for i, c in enumerate(categories)}
    payments = loader.payments_from_frame(df)
    for user_id, rows in payments.items():
        state = UserState(users[user_id], cards[user_id], catalog, params, benefit_start=NO_BENEFIT)
        for p in rows:
            if p.is_placement and p.paid_at >= train_from and p.category in index:
                row = features(state, p.paid_at, categories)
                if p.paid_at < train_until:
                    train_x.append(row)
                    train_y.append(index[p.category])
                elif p.paid_at < test_until:
                    test_x.append(row)
                    test_y.append(index[p.category])
                    probs = time_category_probs(state, p.paid_at, priors, params)
                    baseline.append([probs.get(c, 0.0) for c in categories])
            state.apply(p)
    return (np.array(train_x, dtype=np.float32), np.array(train_y), np.array(test_x, dtype=np.float32),
            np.array(test_y), np.array(baseline))


def metrics(probs: np.ndarray, y: np.ndarray) -> dict:
    if len(y) == 0:
        return {}
    order = np.argsort(-probs, axis=1)
    picked = np.clip(probs[np.arange(len(y)), y], 1e-6, 1)
    return {"건수": int(len(y)),
            "1순위 적중률": round(float((order[:, 0] == y).mean()), 4),
            "3순위 적중률": round(float((order[:, :3] == y[:, None]).any(axis=1).mean()), 4),
            "로그 손실": round(float(-np.log(picked).mean()), 4)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--train-from", default="2026-01-01")     # 2025-11~12 은 이력으로만
    parser.add_argument("--train-until", default="2026-07-01")    # 1~6월로 학습
    parser.add_argument("--test-until", default="2026-11-01")     # 7~10월로 평가
    parser.add_argument("--rounds", type=int, default=MAX_ROUNDS)
    args = parser.parse_args()
    params = Params()
    moment = lambda s: datetime.fromisoformat(s).replace(tzinfo=KST)
    train_from, train_until, test_until = map(moment, (args.train_from, args.train_until, args.test_until))

    df = loader.read_payments()
    known = df[df.paid_at < pd.Timestamp(train_until)]
    categories = sorted(known[placement_mask(known)].category_code.unique())
    priors: Priors = priors_from_frame(known, params, args.train_until)
    catalog, users, cards = loader.load_catalog(), loader.load_users(), loader.load_user_cards()
    x, y, test_x, test_y, baseline = collect(df, users, cards, catalog, params, categories,
                                             train_from, train_until, test_until, priors)
    print(f"학습 {len(y):,}건, 평가 {len(test_y):,}건, 업종 {len(categories)}개, 입력 {x.shape[1]}개")

    split = int(len(y) * 0.85)
    order = np.random.default_rng(20261127).permutation(len(y))
    fit, valid = order[:split], order[split:]
    names = feature_names(categories)
    train_set = dataset(x[fit], y[fit], names, ["prev_category"])
    valid_set = lgb.Dataset(x[valid], label=y[valid], reference=train_set)
    booster = lgb.train(train_params(len(categories)), train_set, num_boost_round=args.rounds, valid_sets=[valid_set],
                        callbacks=[lgb.early_stopping(EARLY_STOP, verbose=False)])
    model = CategoryModel(booster, categories)
    model.save(ARTIFACTS)

    report = {"학습 구간": [args.train_from, args.train_until], "평가 끝": args.test_until,
              "트리 수": booster.best_iteration, "업종": categories}
    if len(test_y):
        v2 = booster.predict(test_x, num_iteration=booster.best_iteration)
        report["v1 시간대 빈도"] = metrics(baseline, test_y)
        report["v2 LightGBM"] = metrics(v2, test_y)
    path = ARTIFACTS / "category_metrics.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "업종"}, ensure_ascii=False, indent=1))
    importance = pd.Series(booster.feature_importance("gain"), index=names).sort_values(ascending=False)
    print("중요한 입력:", ", ".join(importance.index[:8]))
    print(f"모델 저장: {ARTIFACTS / 'category_lgbm.txt'}")


if __name__ == "__main__":
    main()
