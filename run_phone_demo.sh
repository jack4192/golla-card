#!/usr/bin/env bash
# 발표 시연: 휴대폰(Expo Go) 앱과 가상 POS 를 한 번에 켭니다 (2026-11-24).
#   ./run_phone_demo.sh            개발 실행 ('화면 이동' 버튼이 보임, 코드 고치면 바로 반영)
#   ./run_phone_demo.sh --no-dev   정식 앱처럼 ('화면 이동'·경고창 숨김, 첫 로딩이 느림)
# 켜는 순서: DB(docker) → AI(8031) → 백엔드(8091) → 가상 POS(8000) → 앱 서버(8083, QR 표시)
# 같은 포트에 이미 켜진 서버는 그대로 씁니다. 이 스크립트가 켠 서버는 Ctrl+C 로 같이 꺼집니다.
# 필요한 것: backend/.env(DB_URL·AI_INTERNAL_TOKEN·POS_DEMO_TERMINAL_KEY), AI 폴더의 .venv,
#           frontend/node_modules, 맥과 휴대폰이 같은 와이파이(또는 핫스팟), Expo Go 와 맥이 같은 Expo 계정
# 바꿀 수 있는 값: SOLPAY_AI_DIR(AI 폴더), AI_PORT, BACKEND_PORT, POS_PORT, APP_PORT, DB_CONTAINER
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
AI_DIR="${SOLPAY_AI_DIR:-$HOME/Desktop/solpay/solpay-ai}"
AI_PORT="${AI_PORT:-8031}"
BACKEND_PORT="${BACKEND_PORT:-8091}"
POS_PORT="${POS_PORT:-8000}"
APP_PORT="${APP_PORT:-8083}"
DB_CONTAINER="${DB_CONTAINER:-solpay-db}"
TMP_BASE="${TMPDIR:-/tmp}"
LOG_DIR="${TMP_BASE%/}/solpay-phone-demo"
EXPO_MODE=""

for arg in "$@"; do
  case "$arg" in
    --no-dev) EXPO_MODE="--no-dev --minify" ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $arg (쓸 수 있는 옵션: --no-dev)"; exit 1 ;;
  esac
done

mkdir -p "$LOG_DIR"
STARTED_PIDS=""    # 이 스크립트가 켠 프로세스
STARTED_PORTS=""   # 이 스크립트가 켠 서버의 포트 (gradle 이 따로 띄운 자바까지 끄려고)

say() { printf '\n▶ %s\n' "$*"; }
die() { printf '\n✖ %s\n' "$*" >&2; exit 1; }
listening() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}
cleanup() {
  [ -z "$STARTED_PIDS" ] && return
  echo
  echo "이 스크립트가 켠 서버를 끕니다..."
  local pid port
  for pid in $STARTED_PIDS; do kill_tree "$pid"; done
  sleep 1
  for port in $STARTED_PORTS; do
    for pid in $(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null; done
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

remember() { STARTED_PIDS="$STARTED_PIDS $1"; STARTED_PORTS="$STARTED_PORTS $2"; }

# backend/.env 에서 값 하나 읽기 (값은 화면에 찍지 않음)
env_value() {
  grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# 주소가 응답할 때까지 기다리기: wait_http 주소 최대초 [pid]
wait_http() {
  local i
  for ((i = 0; i < $2; i++)); do
    curl -sf -o /dev/null --max-time 3 "$1" && return 0
    if [ -n "${3:-}" ] && ! kill -0 "$3" 2>/dev/null; then return 1; fi
    sleep 1
  done
  return 1
}

pick_python() {
  local py
  for py in python3.13 python3.12 python3.11 python3.10 python3; do
    command -v "$py" >/dev/null 2>&1 || continue
    "$py" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null && { echo "$py"; return 0; }
  done
  return 1
}

# ── 0. 준비물 확인 ────────────────────────────────────────────
[ -f "$ROOT/backend/.env" ] || die "backend/.env 가 없어요."
[ -d "$ROOT/frontend/node_modules" ] || die "frontend/node_modules 가 없어요. 먼저 실행: cd frontend && npm install"
[ -x "$AI_DIR/.venv/bin/python" ] || die "AI 폴더($AI_DIR)에 .venv 가 없어요. SOLPAY_AI_DIR=AI폴더 로 위치를 알려 주세요."
JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21 2>/dev/null)}"
[ -n "$JAVA_HOME" ] || die "Java 21 이 필요해요."

AI_TOKEN="$(env_value AI_INTERNAL_TOKEN)"
DEMO_KEY="$(env_value POS_DEMO_TERMINAL_KEY)"
DB_URL="$(env_value DB_URL)"
[ ${#DEMO_KEY} -ge 16 ] || die "backend/.env 에 POS_DEMO_TERMINAL_KEY(16자 이상)가 없어요. 가상 POS 에서 가맹점을 고르려면 필요해요."
[ -n "$DB_URL" ] || die "backend/.env 에 DB_URL 이 없어요."

# ── 1. 맥 주소 (휴대폰이 접속할 주소) ─────────────────────────
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IP=""
[ -n "$IFACE" ] && IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null)"
[ -n "$IP" ] || IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)"
[ -n "$IP" ] || die "네트워크 주소를 못 찾았어요. 맥이 와이파이(또는 휴대폰 핫스팟)에 연결됐는지 확인하세요."
say "맥 주소: $IP (${IFACE:-?}) — 휴대폰도 같은 네트워크에 있어야 해요"

# ── 2. Expo 로그인 (Expo Go 가 로그인돼 있으면 맥도 같은 계정이어야 'Opening project' 에서 안 멈춤) ──
EXPO_USER="$(python3 -c "import json,os;print((json.load(open(os.path.expanduser('~/.expo/state.json'))).get('auth') or {}).get('username') or '')" 2>/dev/null)"
if [ -n "$EXPO_USER" ]; then
  say "Expo 계정: $EXPO_USER (휴대폰 Expo Go 도 이 계정이어야 해요)"
else
  say "⚠ 맥에 Expo 로그인이 안 돼 있어요. 휴대폰 Expo Go 가 로그인돼 있다면 먼저 실행: cd frontend && npx expo login"
fi

# ── 3. DB ────────────────────────────────────────────────────
DB_NAME="${DB_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
LOCAL_DB=""
case "$DB_URL" in
  *//localhost*|*//127.0.0.1*)
    LOCAL_DB=1
    say "DB 확인: 이 맥의 docker $DB_CONTAINER ($DB_NAME)"
    if ! docker info >/dev/null 2>&1; then
      echo "Docker 를 켭니다 (최대 90초)..."
      open -a Docker 2>/dev/null
      for ((i = 0; i < 90; i++)); do docker info >/dev/null 2>&1 && break; sleep 1; done
      docker info >/dev/null 2>&1 || die "Docker 가 켜지지 않았어요. Docker Desktop 을 직접 켠 뒤 다시 실행하세요."
    fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" != "true" ]; then
      docker start "$DB_CONTAINER" >/dev/null || die "DB 컨테이너 $DB_CONTAINER 를 켜지 못했어요."
    fi
    for ((i = 0; i < 30; i++)); do docker exec "$DB_CONTAINER" pg_isready -q 2>/dev/null && break; sleep 1; done
    docker exec "$DB_CONTAINER" pg_isready -q 2>/dev/null || die "DB 가 준비되지 않았어요."
    ;;
  *) say "DB: backend/.env 의 원격 DB 를 써요 (인터넷이 끊기면 멈춰요)" ;;
esac

# ── 4. AI ────────────────────────────────────────────────────
if listening "$AI_PORT"; then
  say "AI($AI_PORT)는 이미 켜져 있어 그대로 써요"
else
  say "AI 를 켭니다 (포트 $AI_PORT, 로그 $LOG_DIR/ai.log)"
  (
    cd "$AI_DIR" || exit 1
    export SOLPAY_STORE=db SOLPAY_ARTIFACTS="${SOLPAY_ARTIFACTS:-artifacts/v2.1}" SOLPAY_INTERNAL_TOKEN="$AI_TOKEN"
    # 로컬 DB 면 백엔드와 같은 DB 를 보게 한다 (solpay-ai/.env 의 원격 주소는 쓰지 않음)
    [ -n "$LOCAL_DB" ] && export SOLPAY_DATABASE_URL= POSTGRES_DB="$DB_NAME"
    exec .venv/bin/python -m uvicorn engine.api:app --host 127.0.0.1 --port "$AI_PORT"
  ) >"$LOG_DIR/ai.log" 2>&1 &
  pid=$!; remember "$pid" "$AI_PORT"
  wait_http "http://127.0.0.1:$AI_PORT/health" 180 "$pid" || die "AI 가 켜지지 않았어요. 로그: $LOG_DIR/ai.log"
fi

# ── 5. 백엔드 ─────────────────────────────────────────────────
BACKEND_CHECK="http://127.0.0.1:$BACKEND_PORT/api/users/email-availability?email=check%40example.com"
if listening "$BACKEND_PORT"; then
  say "백엔드($BACKEND_PORT)는 이미 켜져 있어 그대로 써요 (가맹점 고르기는 만능 키가 들어간 코드여야 돼요)"
else
  say "백엔드를 켭니다 (포트 $BACKEND_PORT, 처음엔 1~2분, 로그 $LOG_DIR/backend.log)"
  (
    cd "$ROOT/backend" || exit 1
    export JAVA_HOME SERVER_PORT="$BACKEND_PORT" AI_BASE_URL="http://127.0.0.1:$AI_PORT"
    exec sh ./gradlew bootRun --console=plain
  ) >"$LOG_DIR/backend.log" 2>&1 &
  pid=$!; remember "$pid" "$BACKEND_PORT"
  wait_http "$BACKEND_CHECK" 300 "$pid" || die "백엔드가 켜지지 않았어요. 로그: $LOG_DIR/backend.log"
fi

# ── 6. 가상 POS ───────────────────────────────────────────────
POS_PY="$ROOT/demo/.venv/bin/python"
if [ ! -x "$POS_PY" ]; then
  PY="$(pick_python)" || die "파이썬 3.10 이상이 필요해요."
  say "가상 POS 용 파이썬 환경을 만듭니다 (처음 한 번, 인터넷 필요)"
  "$PY" -m venv "$ROOT/demo/.venv" && "$POS_PY" -m pip install -q -r "$ROOT/demo/requirements.txt" \
    || { rm -rf "$ROOT/demo/.venv"; die "가상 POS 환경을 만들지 못했어요."; }
fi
if listening "$POS_PORT"; then
  say "가상 POS($POS_PORT)는 이미 켜져 있어 그대로 써요"
else
  say "가상 POS 를 켭니다 (포트 $POS_PORT, 로그 $LOG_DIR/pos.log)"
  (
    cd "$ROOT/demo" || exit 1
    export POS_DEMO_TERMINAL_KEY="$DEMO_KEY" SOLPAY_AI_TOKEN="$AI_TOKEN" \
      SOLPAY_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" SOLPAY_AI_URL="http://127.0.0.1:$AI_PORT"
    exec "$POS_PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$POS_PORT"
  ) >"$LOG_DIR/pos.log" 2>&1 &
  pid=$!; remember "$pid" "$POS_PORT"
  wait_http "http://127.0.0.1:$POS_PORT/pos" 60 "$pid" || die "가상 POS 가 켜지지 않았어요. 로그: $LOG_DIR/pos.log"
fi
open "http://localhost:$POS_PORT/pos" 2>/dev/null

# ── 7. 앱 서버 (Expo Go 용 QR) ────────────────────────────────
listening "$APP_PORT" && die "앱 서버 포트 $APP_PORT 를 이미 쓰고 있어요. 그 창을 끄거나 APP_PORT=8084 ./run_phone_demo.sh 처럼 다른 포트로 켜세요."

cat <<EOF

────────────────────────────────────────────────
 준비 완료
 · 휴대폰: Expo Go 로 아래에 뜨는 QR 을 찍으세요
 · 가상 POS: http://localhost:$POS_PORT/pos (맥 크롬에서 열림)
 · 앱이 쓰는 백엔드: http://$IP:$BACKEND_PORT
 · 로그: $LOG_DIR
 · 끄려면 Ctrl+C (이 스크립트가 켠 서버도 같이 꺼져요)
────────────────────────────────────────────────
EOF

cd "$ROOT/frontend" || exit 1
# shellcheck disable=SC2086  # EXPO_MODE 는 옵션 두 개로 나눠 넘긴다
EXPO_PUBLIC_API_URL="http://$IP:$BACKEND_PORT" npx expo start --go --lan --port "$APP_PORT" --clear $EXPO_MODE
