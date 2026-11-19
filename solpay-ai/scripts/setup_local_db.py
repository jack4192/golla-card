"""로컬 개인 DB 준비 (2026-11-19). 여러 번 실행해도 된다.

1. DB 가 없으면 만든다 (--db, 기본 루트 .env 의 POSTGRES_DB).
2. 팀 DB 23개 표가 없으면 카드서비스_DB_1년 의 schema.sql 로 만들고 CSV 를 적재한다 (load_all.sql 의 순서·칸 그대로,
   한 트랜잭션). 이미 있으면 표마다 행 수를 CSV 와 대조만 한다 (데이터를 고치지 않는다).
3. 쓰기용 app 스키마(sql/002_app.sql)를 만든다.
4. 하루 일정 암호화 키(SOLPAY_DATA_KEY)가 없으면 만들어 solpay-ai/.env 에 더한다 (로컬 전용).

먼저 저장소 루트에서 DB 를 켠다:  docker compose up -d db
실행:  uv run python -m scripts.setup_local_db
       uv run python -m scripts.setup_local_db --db solpay_test     # 테스트용 DB
공동 DB 에는 실행하지 않는다 (팀이 정한 절차로 적재한다). 접속 주소가 이 컴퓨터가 아니면 멈춘다.
"""

import argparse
import csv
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import psycopg

from engine.settings import REPO, ROOT, database_url, load_env

TEAM_DIR = REPO / "카드서비스_DB_1년"
COPY = re.compile(r"^\\copy (\w+) \(([^)]*)\) FROM '([^']+)'", re.M)


def team_tables(directory: Path) -> list[tuple[str, str, str]]:
    """load_all.sql 의 (표, 칸 목록, CSV 파일) — 외래키 순서."""
    return COPY.findall((directory / "load_all.sql").read_text(encoding="utf-8"))


def csv_rows(path: Path) -> int:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def ensure_database(url: str) -> None:
    name = urlparse(url).path.lstrip("/")
    admin = url.rsplit("/", 1)[0] + "/postgres"
    with psycopg.connect(admin, autocommit=True) as c:
        if c.execute("select 1 from pg_database where datname = %s", (name,)).fetchone() is None:
            c.execute(f'create database "{name}"')
            print(f"DB 를 만들었습니다: {name}")


def load_team(c, directory: Path) -> None:
    print("팀 DB 표를 만들고 CSV 를 적재합니다 (1분 안팎)...")
    with c.transaction():
        c.execute((directory / "schema.sql").read_text(encoding="utf-8"))
        for table, cols, file in team_tables(directory):
            with c.cursor().copy(f"copy {table} ({cols}) from stdin with (format csv, header true)") as cp:
                with (directory / file).open("rb") as f:
                    while chunk := f.read(1 << 20):
                        cp.write(chunk)
            print(f"  {table:22s} {csv_rows(directory / file):>9,}행")


def verify(c, directory: Path) -> int:
    bad = 0
    for table, _, file in team_tables(directory):
        n = c.execute(f"select count(*) from {table}").fetchone()[0]
        m = csv_rows(directory / file)
        bad += n != m
        print(f"  {table:22s} DB {n:>9,}  CSV {m:>9,}{'' if n == m else '  <-- 다름'}")
    return bad


def ensure_data_key() -> None:
    import os
    load_env()
    if os.environ.get("SOLPAY_DATA_KEY") or os.environ.get("SOLPAY_DATA_KEY_ENCRYPTED"):
        return
    from cryptography.fernet import Fernet
    path = ROOT / ".env"
    with path.open("a", encoding="utf-8") as f:
        f.write(f"\n# 하루 일정 암호화 키 (로컬 개인 DB 전용, setup_local_db 가 만듦)\nSOLPAY_DATA_KEY={Fernet.generate_key().decode()}\n")
    print(f"하루 일정 암호화 키를 만들어 {path} 에 더했습니다")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="DB 이름 (기본: 루트 .env 의 POSTGRES_DB)")
    ap.add_argument("--team-dir", default=str(TEAM_DIR))
    args = ap.parse_args()
    url = database_url(args.db)
    if not url:
        sys.exit("DB 주소가 없습니다. 루트 .env 의 POSTGRES_USER·POSTGRES_PASSWORD 를 확인하세요.")
    if (urlparse(url).hostname or "") not in ("localhost", "127.0.0.1", "::1"):
        sys.exit("이 스크립트는 이 컴퓨터의 로컬 DB 에만 씁니다. 공동 DB 는 팀 절차로 적재하세요.")
    directory = Path(args.team_dir)
    ensure_database(url)
    with psycopg.connect(url, autocommit=True) as c:
        exists = c.execute("select to_regclass('public.users') is not null").fetchone()[0]
        if not exists:
            load_team(c, directory)
        print("팀 DB 표 행 수 대조:")
        bad = verify(c, directory)
        c.execute((ROOT / "sql" / "002_app.sql").read_text(encoding="utf-8"))
        print("app 스키마 준비 완료 (sql/002_app.sql)")
    ensure_data_key()
    print("다른 표 수:", bad)
    if bad:
        sys.exit("CSV 와 행 수가 다른 표가 있습니다. 데이터를 다시 적재할지 팀과 정하세요.")


if __name__ == "__main__":
    main()
