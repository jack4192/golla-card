"""배치 엔진이 쓰는 학습 모델 모음. 모델 파일이 없으면 해당 단계는 규칙으로 동작한다.

- 업종 예측 (engine.category_model, artifacts/category_lgbm.txt)
- 남은 소비 예측 (engine.spend_model, artifacts/spend/)
- 실적 채우기 전략 선택 (engine.strategy, artifacts/strategy/)
"""

import json
from dataclasses import dataclass
from pathlib import Path

from engine.spend_model import SpendModel
from engine.strategy import StrategyModel

FOLDS = 5
SEED = 7


@dataclass
class Models:
    spend: SpendModel | None = None
    strategy: StrategyModel | None = None


def load(directory: Path, name: str = "full") -> Models:
    return Models(SpendModel.load(directory / "spend", name), StrategyModel.load(directory / "strategy", name))


def user_folds(user_ids) -> dict[int, int]:
    """배경 사용자를 5겹으로 나눈다. 학습 스크립트들과 재생 평가가 같은 나눔을 쓴다."""
    import numpy as np
    users = np.array(sorted(int(u) for u in user_ids))
    rng = np.random.default_rng(SEED)
    return {int(u): k for k, part in enumerate(np.array_split(rng.permutation(users), FOLDS)) for u in part}


def fold_models(directory: Path) -> tuple[dict[int, int], dict[str, Models]]:
    """재생 평가용: (사용자 → 겹, 이름 → 모델). 배경 사용자는 자기를 빼고 학습한 겹 모델을 쓴다."""
    path = directory / "strategy" / "folds.json"
    folds = {int(k): v for k, v in json.loads(path.read_text()).items()} if path.exists() else {}
    names = ["full"] + [f"fold{k}" for k in range(FOLDS)]
    return folds, {n: load(directory, n) for n in names}
