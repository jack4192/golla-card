"""생성기 공통 경로와 설정 읽기."""

import os
from pathlib import Path

import yaml

DATA_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = DATA_DIR / "config"
CACHE_DIR = DATA_DIR / "cache"
OUT_DIR = DATA_DIR / "out"


def load_config(name: str) -> dict:
    with open(CONFIG_DIR / f"{name}.yml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_env(path: Path = DATA_DIR / ".env") -> None:
    """data/.env 의 KEY=VALUE 줄을 환경 변수로 읽는다. 이미 설정된 값은 덮어쓰지 않는다."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
