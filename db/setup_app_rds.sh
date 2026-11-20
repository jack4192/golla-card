#!/usr/bin/env bash
# 공용 RDS 에 FastAPI(solpay-ai) 를 붙이기 위한 설정 (solpay-ai/README '시스템에 합칠 때').
#   1) 결제 조회 인덱스 payments (user_card_id, paid_at)   — 없으면 요청마다 결제 44.8만 건을 훑는다
#   2) DB 시간대 Asia/Seoul                                — app 표의 timestamptz·now() 를 한국 시간으로
#   3) app 스키마 표 7개 (solpay-ai/sql/002_app.sql, 빈 표)
#   4) app_ai 계정: public 표 읽기만, app 표 읽기·쓰기 (표 만들기·지우기 같은 DDL 없음)
#   5) team_read 계정이 있으면 app 표 읽기 권한
#   6) solpay-ai/.env 의 SOLPAY_DATABASE_URL 을 app_ai 로 RDS 에 붙도록 넣는다 (다른 줄은 그대로 둔다)
#
# 사용:  db/setup_app_rds.sh <RDS 엔드포인트> [마스터 계정, 기본 postgres] [DB 이름, 기본 solpay]
#   - 암호(마스터, 새 app_ai)를 실행할 때 묻는다. 화면·셸 기록·프로세스 목록에 남지 않는다.
#   - 여러 번 실행해도 된다: 있는 것은 건너뛰고, app_ai 암호와 권한만 다시 맞춘다.
#   - SKIP_ENV=1 이면 solpay-ai/.env 를 건드리지 않는다.
#   - psql 은 docker 의 postgres:16 이미지를 쓴다. Docker Desktop 이 켜져 있어야 한다.
set -euo pipefail

HOST="${1:?사용법: db/setup_app_rds.sh <RDS 엔드포인트> [마스터 계정] [DB 이름]}"
MASTER="${2:-postgres}"
DB_NAME="${3:-solpay}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SQL_DIR="$REPO/solpay-ai/sql"
ENV_FILE="${ENV_FILE:-$REPO/solpay-ai/.env}"
export PGSSLMODE="${PGSSLMODE:-require}" HOST DB_NAME

[ -f "$SQL_DIR/002_app.sql" ] || { echo "찾을 수 없습니다: $SQL_DIR/002_app.sql"; exit 1; }

if [ -z "${MASTER_PW:-}" ]; then read -rsp "$MASTER(마스터) 암호: " MASTER_PW; echo; fi
if [ -z "${AI_PW:-}" ]; then
  while true; do
    read -rsp "새 app_ai 암호: " a; echo
    read -rsp "새 app_ai 암호 (한 번 더): " b; echo
    if [ -z "$a" ]; then echo "  비어 있습니다. 다시 입력하세요."; continue; fi
    if [ "$a" != "$b" ]; then echo "  두 번 입력한 값이 다릅니다. 다시 입력하세요."; continue; fi
    AI_PW="$a"; break
  done
fi
export MASTER_PW AI_PW

psql_as() {  # psql_as <계정> <암호 환경변수 이름> [psql 인자...]
  local user="$1" pwvar="$2"; shift 2
  # 암호는 환경변수 이름만 docker 에 넘긴다 (값이 명령줄 인자에 나타나지 않게)
  ( export PGPASSWORD="${!pwvar}"
    docker run --rm -i -e PGPASSWORD -e PGSSLMODE -e AI_PW -v "$SQL_DIR":/sql:ro postgres:16 \
      psql -h "$HOST" -p 5432 -U "$user" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X "$@" )
}

echo "[1/3] 인덱스·시간대·app 표·app_ai 계정 (마스터 계정으로)"
psql_as "$MASTER" MASTER_PW -q <<'SQL'
\getenv ai_pw AI_PW
SET client_min_messages = warning;   -- 다시 실행할 때 'already exists, skipping' 안내를 숨긴다
-- 1) 결제 조회 인덱스 (엔진은 사용자 카드별 최근 400일 결제를 요청마다 읽는다)
CREATE INDEX IF NOT EXISTS payments_user_card_paid_at ON public.payments (user_card_id, paid_at);
-- 2) DB 시간대 (새로 여는 접속부터 적용)
SELECT format('ALTER DATABASE %I SET timezone = %L', current_database(), 'Asia/Seoul') \gexec
-- 3) app 표 7개 (create ... if not exists 라 여러 번 실행해도 된다)
\i /sql/002_app.sql

BEGIN;
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_ai')    AS has_ai,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'team_read') AS has_read \gset
-- 4) app_ai: public 읽기만, app 읽기·쓰기
\if :has_ai
  ALTER ROLE app_ai WITH LOGIN PASSWORD :'ai_pw';
\else
  CREATE ROLE app_ai WITH LOGIN PASSWORD :'ai_pw';
\endif
SELECT format('GRANT CONNECT ON DATABASE %I TO app_ai', current_database()) \gexec
GRANT USAGE ON SCHEMA public, app TO app_ai;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_ai;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_ai;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_ai;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO app_ai;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_ai;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_ai;
-- 5) team_read: app 표도 읽기만
\if :has_read
  GRANT USAGE ON SCHEMA app TO team_read;
  GRANT SELECT ON ALL TABLES IN SCHEMA app TO team_read;
  ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO team_read;
\endif
COMMIT;
SQL
echo "  완료"

echo "[2/3] app_ai 로 로그인해 확인"
fail=0
expect_ok() {
  local out
  if out=$(psql_as app_ai AI_PW -At -c "$2" 2>&1); then
    printf "  %-40s 됨 %s\n" "$1" "$(echo "$out" | tail -1)"
  else
    printf "  %-40s 안 됨 (문제)\n    %s\n" "$1" "$(echo "$out" | tail -1)"; fail=1
  fi
}
expect_denied() {
  local out
  if out=$(psql_as app_ai AI_PW -At -c "$2" 2>&1); then
    printf "  %-40s 됨 (막혀야 하는데 됨, 문제)\n" "$1"; fail=1
  elif echo "$out" | grep -qiE 'permission denied|must be owner|권한|소유주'; then
    printf "  %-40s 막힘 (정상)\n" "$1"
  else
    printf "  %-40s 다른 오류 (문제)\n    %s\n" "$1" "$(echo "$out" | tail -1)"; fail=1
  fi
}
# 쓰기 시험은 WHERE false 라서 실제로 바뀌는 행은 없다 (권한은 행이 없어도 검사된다).
expect_ok     "팀 표 읽기 (users 행 수)"       "select count(*) from public.users"
expect_ok     "app 표 7개"                     "select count(*) from information_schema.tables where table_schema = 'app'"
expect_ok     "app 표 쓰기 (insert·update·delete)" \
  "begin; insert into app.user_rules select * from app.user_rules where false; update app.user_rules set active = active where false; delete from app.user_rules where false; rollback; select 'ok'"
expect_ok     "시간대"                         "show timezone"
expect_ok     "결제 인덱스"                    "select count(*) from pg_indexes where schemaname = 'public' and indexname = 'payments_user_card_paid_at'"
expect_denied "팀 표 쓰기 (payments delete)"   "delete from public.payments where false"
expect_denied "app 에 표 만들기"               "create table app._role_probe (x int)"
expect_denied "public 에 표 만들기"            "create table public._role_probe (x int)"
if [ "$fail" != 0 ]; then
  echo "권한이 예상과 다른 항목이 있습니다. .env 는 바꾸지 않았습니다."
  exit 1
fi

if [ "${SKIP_ENV:-}" = 1 ]; then
  echo "[3/3] SKIP_ENV=1 이라 solpay-ai/.env 는 그대로 둡니다."
else
  echo "[3/3] solpay-ai/.env 에 SOLPAY_DATABASE_URL (app_ai → RDS) 넣기"
  python3 - "$ENV_FILE" <<'PY'
import os, pathlib, sys
from urllib.parse import quote
path = pathlib.Path(sys.argv[1])
url = (f"postgresql://app_ai:{quote(os.environ['AI_PW'], safe='')}@{os.environ['HOST']}:5432/"
       f"{os.environ['DB_NAME']}?sslmode=require")
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
out, done = [], False
for line in lines:
    if line.strip().startswith("SOLPAY_DATABASE_URL="):
        if not done:
            out.append("SOLPAY_DATABASE_URL=" + url)
            done = True
        continue
    out.append(line)
if not done:
    out += ["", "# 공용 RDS (FastAPI 계정 app_ai). 로컬 Docker DB 로 돌아가려면 이 줄을 지우거나 # 로 막는다.",
            "SOLPAY_DATABASE_URL=" + url]
path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
  echo "  완료 (다른 줄은 그대로 두었습니다)"
fi
echo "끝: FastAPI 를 다시 켜면 RDS 를 씁니다."
