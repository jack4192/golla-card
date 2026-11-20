#!/usr/bin/env bash
# AI 엔진(solpay-ai)과 결제 데모(demo)를 함께 켠다. Ctrl+C 로 둘 다 끈다.
#   ./run_demo.sh
#   AI_PORT=8101 DEMO_PORT=8100 ./run_demo.sh      # 포트 바꾸기
#   DEMO_HOST=0.0.0.0 ./run_demo.sh                 # 같은 와이파이의 휴대폰에서 열기
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
AI_PORT="${AI_PORT:-8001}"
DEMO_PORT="${DEMO_PORT:-8000}"
DEMO_HOST="${DEMO_HOST:-127.0.0.1}"
AI_PID=""
DEMO_PID=""

command -v uv >/dev/null || { echo "uv 가 필요합니다: https://docs.astral.sh/uv/getting-started/installation/"; exit 1; }

if [ ! -f "$ROOT/data/out/parquet/payments.parquet" ]; then
  echo "가상 데이터를 만듭니다 (처음 한 번, 1분 안팎)"
  (cd "$ROOT/data" && uv sync -q && uv run python -m generate.main)
fi
if [ ! -f "$ROOT/solpay-ai/artifacts/priors.json" ]; then
  echo "전체 사용자 분포를 만듭니다 (처음 한 번)"
  (cd "$ROOT/solpay-ai" && uv sync -q && uv run python -m training.build_priors)
fi

trap 'kill $AI_PID $DEMO_PID 2>/dev/null || true' EXIT INT TERM

(cd "$ROOT/solpay-ai" && exec uv run uvicorn engine.api:app --port "$AI_PORT") &
AI_PID=$!
echo "AI 엔진을 켜는 중 (포트 $AI_PORT)"
for _ in $(seq 1 120); do
  curl -sf "http://127.0.0.1:$AI_PORT/health" >/dev/null 2>&1 && break
  kill -0 "$AI_PID" 2>/dev/null || { echo "AI 엔진이 시작되지 않았습니다. 위 오류를 확인하세요."; exit 1; }
  sleep 0.5
done

(cd "$ROOT/demo" && SOLPAY_AI_URL="http://127.0.0.1:$AI_PORT" \
  exec uv run --no-project --with-requirements requirements.txt uvicorn app.main:app --host "$DEMO_HOST" --port "$DEMO_PORT") &
DEMO_PID=$!

echo ""
echo "결제 화면: http://localhost:$DEMO_PORT/pay"
echo "가상 POS:  http://localhost:$DEMO_PORT/pos"
echo "끄려면 Ctrl+C"
wait
