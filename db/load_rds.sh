#!/usr/bin/env bash
# 카드서비스_DB_1년(팀 DB 23개 표)을 RDS PostgreSQL 에 적재한다. 테스트_가이드.md 순서대로 schema.sql → load_all.sql.
#
# 사용:  db/load_rds.sh <RDS 엔드포인트> [계정, 기본 postgres] [DB 이름, 기본 solpay]
#   - 암호는 실행할 때 묻는다 (화면과 셸 기록에 남지 않는다).
#   - 이 Mac 에 psql 이 없어서 docker 의 postgres:16 이미지로 psql 을 띄운다. Docker Desktop 이 켜져 있어야 한다.
#   - public 스키마에 팀 표가 이미 있으면 중복 적재를 막으려고 아무것도 하지 않고 멈춘다.
#   - load_all.sql 은 하나의 트랜잭션이라 중간에 실패하면 적재가 모두 취소된다 (schema.sql 로 만든 빈 표는 남는다).
set -euo pipefail

HOST="${1:?사용법: db/load_rds.sh <RDS 엔드포인트> [계정] [DB 이름]}"
DB_USER="${2:-postgres}"
DB_NAME="${3:-solpay}"
DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/카드서비스_DB_1년"
export PGSSLMODE="${PGSSLMODE:-require}"   # RDS PostgreSQL 15 이상은 SSL 이 기본으로 강제된다

[ -f "$DATA_DIR/schema.sql" ] || { echo "폴더를 찾을 수 없습니다: $DATA_DIR"; exit 1; }

if [ -z "${PGPASSWORD:-}" ]; then
  read -rsp "$DB_USER 암호: " PGPASSWORD; echo
fi
export PGPASSWORD

psql_() {
  docker run --rm -i -e PGPASSWORD -e PGSSLMODE -v "$DATA_DIR":/data:ro -w /data postgres:16 \
    psql -h "$HOST" -p 5432 -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

echo "[1/4] 연결 확인"
psql_ -Atc "select version()"

echo "[2/4] 기존 표 확인"
existing=$(psql_ -Atc "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('users', 'cards', 'payments')")
if [ "$existing" != "0" ]; then
  echo "public 스키마에 팀 표가 이미 있습니다. 중복 적재를 막으려고 멈춥니다."
  exit 1
fi

echo "[3/4] 표 만들기 (schema.sql)"
psql_ -q -f schema.sql

echo "[4/4] CSV 적재 (load_all.sql, 결제 44.8만 건이라 몇 분 걸릴 수 있습니다)"
psql_ -q -f load_all.sql > /dev/null

echo "행 수 대조 (CSV ↔ DB)"
expected=$(python3 - "$DATA_DIR" <<'PY'
import csv, pathlib, sys
for f in sorted(pathlib.Path(sys.argv[1]).glob("*.csv")):
    if f.stem == "테이블_명세서":
        continue
    with f.open(encoding="utf-8", newline="") as fh:
        rows = csv.reader(fh)
        next(rows)
        print(f"{f.stem}|{sum(1 for _ in rows)}")
PY
)
sql=$(echo "$expected" | awk -F'|' '{printf "%sselect %c%s%c, count(*) from public.%s", (NR>1?" union all ":""), 39, $1, 39, $1}')
actual=$(psql_ -At -F'|' -c "$sql")

fail=0
while IFS='|' read -r t n; do
  got=$(echo "$actual" | awk -F'|' -v t="$t" '$1 == t {print $2}')
  if [ "$got" = "$n" ]; then
    printf "  %-20s %8s  같음\n" "$t" "$n"
  else
    printf "  %-20s CSV=%s DB=%s  다름\n" "$t" "$n" "${got:-없음}"
    fail=1
  fi
done <<< "$expected"

if [ "$fail" = 0 ]; then
  echo "완료: 23개 표의 행 수가 CSV 와 모두 같습니다."
else
  echo "행 수가 다른 표가 있습니다. 위 목록을 확인하세요."
  exit 1
fi
