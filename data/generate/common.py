"""생성기 공통 경로와 설정 읽기."""

import os
from pathlib import Path

import yaml

DATA_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = DATA_DIR / "config"
CACHE_DIR = DATA_DIR / "cache"
# 데이터 판 (2026-11-22). v2 는 config/v2/*.yml 을 기본 설정 위에 겹쳐 쓰고 결과를 out_v2 에 둔다.
# v2.1 (2026-11-23)은 v2 위에 config/v2.1/*.yml(개인 루틴)을 한 번 더 겹치고 결과를 out_v2.1 에 둔다.
VERSION = os.environ.get("SOLPAY_DATA_VERSION", "v1")
OUT_DIR = DATA_DIR / ("out" if VERSION == "v1" else f"out_{VERSION}")


def deep_merge(base: dict, over: dict) -> dict:
    """사전은 안쪽까지 합치고, 목록과 값은 over 로 바꿔 끼운다. 입력은 바꾸지 않는다."""
    out = dict(base)
    for k, v in over.items():
        out[k] = deep_merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def version_chain(version: str) -> list[str]:
    """겹쳐 쓸 설정 폴더 순서. v1 은 없음, v2 는 [v2], 점이 있는 판(v2.1, 2026-11-23)은 큰 판 위에 겹친다: [v2, v2.1]."""
    if version == "v1":
        return []
    return [version.split(".")[0], version] if "." in version else [version]


def load_config(name: str, version: str | None = None) -> dict:
    with open(CONFIG_DIR / f"{name}.yml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for v in version_chain(version or VERSION):
        over = CONFIG_DIR / v / f"{name}.yml"
        if over.exists():
            with open(over, encoding="utf-8") as f:
                cfg = deep_merge(cfg, yaml.safe_load(f) or {})
    return cfg


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
