#!/usr/bin/env bash
# 공용 RDS 에 팀 계정 2개를 만든다 (이미 있으면 암호와 권한만 다시 맞춘다).
#   team_read   : 팀원 조회용. public 스키마 표를 읽기만 한다.
#   app_backend : Spring 서버용. public 스키마 표를 읽고 쓴다 (SELECT·INSERT·UPDATE·DELETE, 시퀀스 사용).
#                 표를 만들거나 지우거나 구조를 바꾸는 권한(DDL)은 없다.
# 마스터 계정이 앞으로 public 에 만드는 표에도 같은 권한이 자동으로 붙는다.
#
# 사용:  db/create_roles.sh <RDS 엔드포인트> [마스터 계정, 기본 postgres] [DB 이름, 기본 solpay]
#   - 암호 3개(마스터, team_read, app_backend)를 실행할 때 묻는다. 화면·셸 기록·프로세스 목록에 남지 않는다.
#   - 끝나면 새 계정으로 직접 로그인해 권한이 맞는지(읽기 되는지, 막혀야 할 것이 막히는지) 확인한다.
#   - psql 은 docker 의 postgres:16 이미지를 쓴다. Docker Desktop 이 켜져 있어야 한다.
set -euo pipefail

HOST="${1:?사용법: db/create_roles.sh <RDS 엔드포인트> [마스터 계정] [DB 이름]}"
MASTER="${2:-postgres}"
DB_NAME="${3:-solpay}"
export PGSSLMODE="${PGSSLMODE:-require}"

ask_pw() {  # ask_pw <변수 이름> <안내> : 두 번 입력받아 같은지 확인한다
  local var="$1" label="$2" a b
  if [ -n "${!var:-}" ]; then return; fi
  while true; do
    read -rsp "$label: " a; echo
    read -rsp "$label (한 번 더): " b; echo
    if [ -z "$a" ]; then echo "  비어 있습니다. 다시 입력하세요."; continue; fi
    if [ "$a" != "$b" ]; then echo "  두 번 입력한 값이 다릅니다. 다시 입력하세요."; continue; fi
    printf -v "$var" '%s' "$a"; break
  done
}

if [ -z "${MASTER_PW:-}" ]; then read -rsp "$MASTER(마스터) 암호: " MASTER_PW; echo; fi
ask_pw READ_PW    "새 team_read 암호"
ask_pw BACKEND_PW "새 app_backend 암호"
export MASTER_PW READ_PW BACKEND_PW

psql_as() {  # psql_as <계정> <암호 환경변수 이름> [psql 인자...]
  local user="$1" pwvar="$2"; shift 2
  # 암호는 환경변수 이름만 docker 에 넘긴다 (값이 명령줄 인자에 나타나지 않게)
  ( export PGPASSWORD="${!pwvar}"
    docker run --rm -i -e PGPASSWORD -e PGSSLMODE -e READ_PW -e BACKEND_PW postgres:16 \
      psql -h "$HOST" -p 5432 -U "$user" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X "$@" )
}

echo "[1/2] 계정 만들기·권한 주기 (마스터 계정으로)"
psql_as "$MASTER" MASTER_PW -q <<'SQL'
\getenv read_pw READ_PW
\getenv backend_pw BACKEND_PW
BEGIN;
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'team_read')   AS has_read,
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') AS has_backend \gset
\if :has_read
  ALTER ROLE team_read WITH LOGIN PASSWORD :'read_pw';
\else
  CREATE ROLE team_read WITH LOGIN PASSWORD :'read_pw';
\endif
\if :has_backend
  ALTER ROLE app_backend WITH LOGIN PASSWORD :'backend_pw';
\else
  CREATE ROLE app_backend WITH LOGIN PASSWORD :'backend_pw';
\endif

SELECT format('GRANT CONNECT ON DATABASE %I TO team_read, app_backend', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO team_read, app_backend;

-- 팀원: 읽기만
GRANT SELECT ON ALL TABLES IN SCHEMA public TO team_read;
-- 백엔드: 읽기·쓰기 (DDL 없음)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_backend;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend;

-- 마스터 계정이 앞으로 public 에 만드는 표·시퀀스에도 같은 권한
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO team_read;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_backend;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_backend;

-- FastAPI 의 app 스키마(db/setup_app_rds.sh)가 이미 있으면 팀원은 그 표도 읽기만
SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'app') AS has_app \gset
\if :has_app
  GRANT USAGE ON SCHEMA app TO team_read;
  GRANT SELECT ON ALL TABLES IN SCHEMA app TO team_read;
  ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO team_read;
\endif
COMMIT;
SQL
echo "  완료"

echo "[2/2] 새 계정으로 로그인해 권한 확인"
fail=0
expect_ok() {  # expect_ok <설명> <계정> <암호변수> <SQL>
  local out
  if out=$(psql_as "$2" "$3" -At -c "$4" 2>&1); then
    printf "  %-44s 됨 %s\n" "$1" "$(echo "$out" | tail -1)"
  else
    printf "  %-44s 안 됨 (문제)\n    %s\n" "$1" "$(echo "$out" | tail -1)"; fail=1
  fi
}
expect_denied() {  # expect_denied <설명> <계정> <암호변수> <SQL>
  local out
  if out=$(psql_as "$2" "$3" -At -c "$4" 2>&1); then
    printf "  %-44s 됨 (막혀야 하는데 됨, 문제)\n" "$1"; fail=1
  elif echo "$out" | grep -qiE 'permission denied|must be owner|권한|소유주'; then
    printf "  %-44s 막힘 (정상)\n" "$1"
  else
    printf "  %-44s 다른 오류 (문제)\n    %s\n" "$1" "$(echo "$out" | tail -1)"; fail=1
  fi
}

# 쓰기 시험은 WHERE false 라서 실제로 바뀌는 행은 없다 (권한은 행이 없어도 검사된다).
expect_ok     "team_read   읽기 (users 행 수)"          team_read   READ_PW    "select count(*) from users"
expect_denied "team_read   쓰기 (delete)"               team_read   READ_PW    "delete from zones where false"
expect_denied "team_read   표 만들기"                   team_read   READ_PW    "create table _role_probe (x int)"
expect_ok     "app_backend 읽기 (users 행 수)"          app_backend BACKEND_PW "select count(*) from users"
expect_ok     "app_backend 쓰기 (insert·update·delete)" app_backend BACKEND_PW \
  "begin; insert into zones select * from zones where false; update zones set zone_name = zone_name where false; delete from zones where false; rollback; select 'ok'"
expect_ok     "app_backend 시퀀스 사용 권한"            app_backend BACKEND_PW \
  "select bool_and(has_sequence_privilege(c.oid, 'USAGE')) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'S' and n.nspname = 'public'"
expect_denied "app_backend 표 만들기"                   app_backend BACKEND_PW "create table _role_probe (x int)"
expect_denied "app_backend 표 지우기"                   app_backend BACKEND_PW "drop table zones"

if [ "$fail" = 0 ]; then
  echo "완료: team_read 는 읽기만, app_backend 는 읽기·쓰기만 됩니다."
else
  echo "권한이 예상과 다른 항목이 있습니다. 위 목록을 확인하세요."
  exit 1
fi
