"""업종 모델 학습 설정값 (2026-11-23 튜닝 결과 반영, 사용자 결정: 설정값만, 입력은 그대로)."""

import lightgbm as lgb
import numpy as np

from training import train_category as T


def test_튜닝한_설정값으로_학습한다():
    p = T.LGB_PARAMS
    assert (p["learning_rate"], p["num_leaves"], p["min_data_in_leaf"], p["feature_fraction"], p["lambda_l2"]) == \
        (0.03, 31, 40, 0.7, 20.0)
    assert T.MAX_BIN == 63
    assert "bagging_fraction" not in p     # 튜닝에서 bagging 없음이 가장 좋았다


def test_학습률을_낮춘_만큼_최대_트리_수를_넉넉히_둔다():
    assert T.MAX_ROUNDS >= 2000 and T.EARLY_STOP == 30


def test_설정값으로_작은_다중_분류가_학습된다():
    rng = np.random.default_rng(0)
    x = rng.normal(size=(600, 4))
    y = (x[:, 0] > 0).astype(int) + (x[:, 1] > 0).astype(int)
    ds = T.dataset(x, y, [f"f{i}" for i in range(4)], [])
    booster = lgb.train(T.train_params(3), ds, 20)
    assert booster.predict(x).shape == (600, 3)
    assert ds.get_params()["max_bin"] == 63
