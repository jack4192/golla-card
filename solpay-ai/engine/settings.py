"""설정 읽기: solpay-ai/.env 와 저장소 루트 .env (docker compose 의 DB 계정).

DB 주소는 SOLPAY_DATABASE_URL 이 있으면 그것을, 없으면 루트 .env 의 POSTGRES_* 로 이 컴퓨터의 로컬 DB 주소를 만든다
(비밀번호를 두 곳에 적지 않는다). 공동 DB 로 갈 때는 solpay-ai/.env 에 SOLPAY_DATABASE_URL 만 넣는다.
"""

import os
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]          # solpay-ai
REPO = ROOT.parent                                  # 저장소 루트 (docker-compose.yml)


def _read(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def load_env() -> None:
    """이미 있는 환경 변수는 덮어쓰지 않는다. 키 값은 로그에 남기지 않는다."""
    _read(ROOT / ".env")
    _read(REPO / ".env")


def database_url(database: str | None = None) -> str | None:
    load_env()
    url = os.environ.get("SOLPAY_DATABASE_URL")
    if url and database is None:
        return url
    user, password = os.environ.get("POSTGRES_USER"), os.environ.get("POSTGRES_PASSWORD")
    if not (user and password):
        return url
    host = os.environ.get("SOLPAY_DB_HOST", "localhost")
    port = os.environ.get("SOLPAY_DB_PORT", "5432")
    name = database or os.environ.get("POSTGRES_DB", "solpay")
    return f"postgresql://{quote(user)}:{quote(password)}@{host}:{port}/{name}"
