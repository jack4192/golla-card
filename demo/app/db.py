"""SQLite 저장소: 시연 설정, 일회용 토큰, 거래 내역.

카드와 사용자 정보는 AI 엔진(가상 데이터)에서 받아 온다. 실제 카드번호는 받지도 저장하지도 않는다.
"""
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("SOLPAY_DB", ROOT / "data" / "app.db"))
SCHEMA_VERSION = 3

SCHEMA = """
-- 시연 화면의 현재 설정 (한 줄)
CREATE TABLE IF NOT EXISTS demo_state (
    id                    INTEGER PRIMARY KEY CHECK (id = 1),
    user_id               INTEGER NOT NULL,
    demo_at               TEXT NOT NULL
);

-- 일회용 결제 토큰. 원문은 저장하지 않고 HMAC 해시만 저장한다.
CREATE TABLE IF NOT EXISTS tokens (
    id            TEXT PRIMARY KEY,
    token_hash    TEXT NOT NULL UNIQUE,
    user_id       INTEGER NOT NULL,
    card_id       INTEGER NOT NULL,          -- AI 엔진의 user_card_id
    card_name     TEXT NOT NULL,
    card_last4    TEXT NOT NULL,
    ai_first_card INTEGER,                   -- 발급 시점의 AI 1순위 카드
    ai_rank       INTEGER,                   -- 고른 카드의 AI 순위
    issued_at     REAL NOT NULL,
    expires_at    REAL NOT NULL,
    used_at       REAL,
    revoked_at    REAL
);

-- 가상 POS의 모든 승인 시도(승인·거절 모두).
CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at    REAL NOT NULL,
    demo_at       TEXT,
    result        TEXT NOT NULL CHECK (result IN ('APPROVED', 'DECLINED')),
    reason        TEXT,
    approval_no   TEXT,
    token_id      TEXT,
    user_id       INTEGER,
    card_id       INTEGER,
    card_name     TEXT,
    merchant_id   INTEGER,
    merchant      TEXT NOT NULL,
    category      TEXT NOT NULL,
    amount        INTEGER NOT NULL,
    benefit       INTEGER,                   -- 이 결제로 받은 혜택 (AI 계산)
    best_card_id  INTEGER,                   -- 사후 최적 카드
    best_card     TEXT,
    best_benefit  INTEGER,
    ai_rank       INTEGER,
    ai_synced     INTEGER NOT NULL DEFAULT 0 -- AI 엔진에 결제를 보냈는지
);
"""


def _open() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


@contextmanager
def connect():
    """요청 하나에 연결 하나. 정상 종료 시 커밋, 예외 시 롤백."""
    con = _open()
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init(default_user: int, default_at: str) -> None:
    with connect() as con:
        if con.execute("PRAGMA user_version").fetchone()[0] < SCHEMA_VERSION:
            # 이전 버전(가상 카드 3장, 위치 시연)의 표는 구조가 달라 지우고 새로 만든다
            for table in ("transactions", "tokens", "cards", "users", "demo_state"):
                con.execute(f"DROP TABLE IF EXISTS {table}")
            con.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        con.executescript(SCHEMA)
        con.execute("INSERT OR IGNORE INTO demo_state (id, user_id, demo_at) VALUES (1, ?, ?)",
                    (default_user, default_at))


def clear_activity() -> None:
    with connect() as con:
        con.execute("DELETE FROM transactions")
        con.execute("DELETE FROM tokens")
