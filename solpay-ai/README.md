# SOL페이 카드 배치 엔진

결제화면을 열 때 카드 순서를 정하는 FastAPI 추천 엔진과 학습·평가 코드다. 카드 순서만 바꾸고 결제 확정은 고객이 한다.

알고리즘 설명은 설계서를 본다: https://claude.ai/artifact/JqevE2WhExsRCX496Cs79E

AI 를 붙인 결제 데모(토큰 발급, 가상 POS)는 별도 프로젝트 `sol-pay-mvp` 에 있다. 이 엔진을 `--port 8001` 로 켜고 데모 서버가 HTTP 로 부른다.

가상 데이터의 혜택과 소비는 임의 값이므로, 평가 수치는 알고리즘 동작 검증이고 실제 절감액이 아니다.

## 폴더 구성

| 폴더 | 내용 | 시스템 반영 |
|---|---|---|
| `engine/` | 배치 엔진과 API | 그대로 배포한다 |
| `training/` | 전체 분포, LightGBM 업종 모델, 기준값 비교 | 학습할 때만 실행한다 |
| `evaluation/` | 시간순 재생 평가, 데모 사용자 보고서 | 평가할 때만 실행한다 |
| `scripts/` | Postgres 적재, API 명세 내보내기 | 필요할 때 실행한다 |
| `sql/` | 엔진용 테이블 | DB 에 적용한다 |
| `tests/` | 자동 테스트 | CI 에서 실행한다 |
| `artifacts/` | 학습 결과와 평가 보고서 (깃 제외) | `priors.json` 과 모델 파일을 함께 배포한다 |

엔진 파일과 설계서 단계의 대응은 다음과 같다.

| 단계 | 파일 |
|---|---|
| 1단계 사용자 규칙 | `engine/rules.py` |
| 2단계 결제 시나리오 | `engine/scenarios.py`, `engine/category_model.py`, `engine/priors.py` |
| 3단계 카드별 점수 | `engine/ranker.py`, `engine/benefit_calc.py`, `engine/perf_value.py` |
| 4~5단계 기본 카드, 교체, 2장 | `engine/ranker.py` |
| 6단계 안내 문구 | `engine/messages.py` |
| 사용자 상태 | `engine/state.py` |
| 기준값 | `engine/params.py` |
| 진입점 | `engine/service.py`, `engine/api.py` |
| 저장소 | `engine/store.py`, `engine/pg_store.py` |

`engine/benefit_calc.py` 는 `data/generate/benefit.py` 와 같은 파일이다. 한쪽을 고치면 다른 쪽도 고쳐야 하며, 테스트가 차이를 잡아낸다.

## 처음 실행

[uv](https://docs.astral.sh/uv/) 가 필요하다. 가상 데이터가 없으면 먼저 만든다.

```bash
cd data
uv sync
uv run python -m generate.main
```

엔진을 준비한다.

```bash
cd ../solpay-ai
uv sync
uv run python -m training.build_priors
uv run pytest
```

## 학습

```bash
# 7월은 이력으로만 쓰고 8~9월로 학습, 10월로 평가한다
uv run python -m training.train_category

# 기준값 후보를 8~9월로 비교하고 10월로 확인한다 (3분 안팎, 설정은 바꾸지 않는다)
uv run python -m training.tune
```

## 평가

```bash
# 위치 동의·미동의 버전 평가 (10초 안팎)
uv run python -m evaluation.replay

# 결제를 미리 안다고 가정한 상한
uv run python -m evaluation.replay --upper-bound

# 사용자 행동이 달라질 때
uv run python -m evaluation.replay --choice first
uv run python -m evaluation.replay --accept 0.7

# 위치 가정값 바꾸기
uv run python -m evaluation.replay --loc-error 15 --loc-fail 0

# 기준값 바꿔 보기
uv run python -m evaluation.replay --switch 200 --two-loss 200
uv run python -m evaluation.replay --base-order top_tier

# 업종 모델 비교. v2 는 8~9월로 학습했으므로 10월로만 비교한다
uv run python -m evaluation.replay --start 2026-10 --until 2026-11
uv run python -m evaluation.replay --start 2026-10 --until 2026-11 --category-model v2

# 데모 사용자 보고서. 결제별 CSV 는 artifacts/reports 에 저장된다
uv run python -m evaluation.demo_report --user 1
```

## API 서버

```bash
uv run uvicorn engine.api:app --port 8000
```

브라우저에서 http://127.0.0.1:8000/docs 를 열면 API 를 직접 호출할 수 있다.

```bash
curl -s -X POST http://127.0.0.1:8000/internal/rank -H 'Content-Type: application/json' -d '{"user_id": 1, "lat": 37.4979, "lng": 127.0276, "accuracy_m": 20, "at": "2026-11-05T12:20:00+09:00"}'
```

| API | 용도 |
|---|---|
| `POST /internal/rank` | 카드 순서와 안내 문구를 돌려준다. `"explain": true` 면 판단 근거도 준다 |
| `GET /internal/users/{user_id}` | 위치 동의 여부와 계산 버전 |
| `PUT /internal/users/{user_id}/consent` | 위치 동의가 바뀌면 Spring 이 알린다 |
| `GET /internal/users/{user_id}/cards` | 카드별 전월·당월 실적, 다음 구간까지 남은 금액, 이번 달 받은 혜택 |
| `GET`, `PUT /internal/users/{user_id}/rules` | 챗봇이 사용자 확인을 받은 규칙 조회·저장 |
| `POST /internal/payments/evaluate` | 승인 직전 결제를 카드마다 했을 때의 혜택과 가장 유리한 카드 |
| `GET /internal/merchants` | 위치가 있는 가맹점 목록 |
| `POST /internal/payments` | 로컬 시연용 결제 추가. Postgres 저장소에서는 405 를 돌려준다 |
| `POST /internal/dev/reset` | 로컬 시연용 초기화. Postgres 저장소에서는 405 를 돌려준다 |
| `GET /health` | 상태 확인 |

| 환경 변수 | 뜻 | 기본값 |
|---|---|---|
| `SOLPAY_STORE` | `parquet` 또는 `postgres` | `parquet` |
| `SOLPAY_DATABASE_URL` | Postgres 주소 | 없음 |
| `SOLPAY_INTERNAL_TOKEN` | 설정하면 `X-Internal-Token` 헤더를 검사한다 | 없음 |
| `SOLPAY_CATEGORY_MODEL` | `v2` 면 LightGBM 업종 모델을 쓴다 | v1 |
| `SOLPAY_DATA_DIR` | 가상 데이터 폴더 | `../data/out/parquet` |
| `SOLPAY_ARTIFACTS` | 학습 결과 폴더 | `artifacts` |

## Postgres 로 실행

저장소 루트의 `docker-compose.yml` 로 DB 를 켠다. 비밀번호는 루트의 `.env` 에 있다.

```bash
docker compose up -d db
```

```bash
export SOLPAY_DATABASE_URL="postgresql://solpay_app:비밀번호@localhost:5432/solpay"
```

```bash
cd solpay-ai
uv run python -m scripts.load_demo_to_postgres
SOLPAY_STORE=postgres uv run uvicorn engine.api:app --port 8000
```

DB 와 가상 데이터의 결과가 같은지 확인한다.

```bash
SOLPAY_TEST_DATABASE_URL="$SOLPAY_DATABASE_URL" uv run pytest tests/test_pg_store.py
```

## 시스템에 합칠 때

1. **호출:** 앱은 Spring 만 호출하고, Spring 이 `POST /internal/rank` 를 부른다. 0.8초 안에 응답이 없으면 기본 순서로 결제화면을 구성한다. 계약은 `uv run python -m scripts.export_openapi` 로 만든 `openapi.json` 을 쓴다.
2. **토큰:** 운영에서는 `SOLPAY_INTERNAL_TOKEN` 을 설정해 Spring 만 호출하게 한다.
3. **결제:** Spring 이 결제를 저장한다. 엔진은 DB 를 읽기만 하고 요청마다 상태를 다시 만든다.
4. **테이블:** `sql/001_placement.sql` 을 적용한다. Spring 테이블로 합치면 `engine/pg_store.py` 의 쿼리만 바꾼다.
5. **배포:** 이미지에 `engine/` 과 `artifacts/priors.json` 을 넣는다. v2 를 쓰면 `category_lgbm.txt`, `category_classes.json` 도 넣는다.
6. **기준값:** `engine/params.py` 에서 바꾼다. 공휴일 목록은 운영 달력으로 교체한다.

## 아직 포함하지 않은 것

- 챗봇 대화. 엔진은 사용자가 확인한 규칙 JSON 만 받아 검증하고 저장한다.
- 가상 프로모션 데이터. 코드는 프로모션을 계산하지만 `promotions` 테이블이 비어 있다.
- K-패스 정부 환급. 카드사 혜택만 계산한다.
- 실제 카드 혜택과 실제 위치 측정값. 위치 오차와 실패율은 평가용 가정값이다.
