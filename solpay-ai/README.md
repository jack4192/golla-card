# SOL페이 카드 배치 엔진

결제화면을 열 때 카드 순서를 정하는 FastAPI 추천 엔진과 학습·평가 코드다. 카드 순서만 바꾸고 결제 확정은 고객이 한다.

알고리즘 설명은 설계서를 본다: https://claude.ai/artifact/JqevE2WhExsRCX496Cs79E

AI 를 붙인 결제 데모(토큰 발급, 가상 POS)는 저장소의 `demo/` 에 있다. 저장소 루트의 `./run_demo.sh` 가 이 엔진을 `--port 8001` 로 켜고 데모 서버가 HTTP 로 부른다.

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
| 1단계 하루 일정으로 상황 파악 | `engine/scenarios.py`, `engine/category_model.py`, `engine/priors.py` |
| 2단계 사용자 규칙 · 일정 프로모션 카드 | `engine/rules.py`, `engine/service.py` (`_promotion_card`) |
| 하루 일정 팝업 (카드 추천 · 프로모션 추천) | `engine/popup.py`, `engine/recommend.py` |
| 3단계 실적 채우기 방식 | `engine/strategy.py`, `engine/ranker.py` (`_first_tier` 등) |
| 4단계 기본 카드 (구간 지키기 → 방식 → 혜택률 1위) | `engine/ranker.py` (`choose_base_card`) |
| 5단계 카드별 원화 점수 (즉시 혜택 + 프로모션 기대값, 설계서 v4.2) | `engine/ranker.py` (`promotion_value`), `engine/scenarios.py` (`promo_brand_mix`), `engine/benefit_calc.py` |
| 6단계 교체 판단 (기본 카드의 실적 가치) | `engine/ranker.py` (`v4_swap`), `engine/perf_value.py` (`switch_threshold`) |
| 안내 문구 | `engine/messages.py` |
| 사용자 상태 | `engine/state.py` |
| 기준값 | `engine/params.py` |
| 진입점 | `engine/service.py`, `engine/api.py` |
| 팀 DB 형식 데이터 읽기 | `engine/team_db.py` |
| AI 챗봇 (도구 8개, OpenAI) | `engine/chat/` (아래 'AI 챗봇' 참고) |
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
uv run python -m training.train_category      # 업종 예측 LightGBM (기본으로 씀)
uv run pytest
```

## 학습

```bash
# 업종 예측 LightGBM (기본값). 7월은 이력으로만 쓰고 8~9월로 학습, 10월로 평가한다
uv run python -m training.train_category

# 실적 채우기 전략 선택 모델 / 남은 소비 예측 모델 (사용자 단위 5겹 교차검증, 각 10초 안팎)
# 재생 평가에서 이득이 확인되지 않아 기본으로 끄고 --ml (서버는 SOLPAY_ML=on) 일 때만 쓴다
uv run python -m training.train_strategy
uv run python -m training.train_spend

# 기준값 후보를 8~9월로 비교하고 10월로 확인한다 (3분 안팎, 설정은 바꾸지 않는다)
uv run python -m training.tune
```

## 평가

```bash
# 습관 대비 알고리즘 평가 (2026-01~11-05, 1분 안팎)
uv run python -m evaluation.replay

# 사후 최적 상한: 알고리즘과 무관하게, 결제를 전부 미리 알 때 받을 수 있는 최대 혜택 (15초 안팎)
uv run python -m evaluation.oracle

# 같은 알고리즘이 결제를 미리 안다고 가정한 값 (알고리즘의 예측 오차만 뺀 값)
uv run python -m evaluation.replay --upper-bound

# 사용자 행동이 달라질 때
uv run python -m evaluation.replay --choice first
uv run python -m evaluation.replay --accept 0.7

# 하루 일정을 미리 입력했다고 가정 (평소와 다른 결제 30%, 일반 10%, 금액 ±20%)
uv run python -m evaluation.replay --schedule
uv run python -m evaluation.replay --schedule --schedule-special 0.5 --schedule-normal 0.2

# 설계서 v4.2 기준: 프로모션 31건 매달 반복, 일정 팝업, 마이샵 ON (습관은 30% 만 켰다고 본다, 기본값)
uv run python -m evaluation.replay --schedule --popup --promotion-source yaml_monthly --choice first
uv run python -m evaluation.replay --schedule --popup --promotion-source yaml_monthly --choice first --myshop-on 1   # 모두 켰다고 볼 때

# 기준값 바꿔 보기
uv run python -m evaluation.replay --switch 200 --two-loss 200
uv run python -m evaluation.replay --base-order top_tier

# 실적 채우기 전략: 기본은 auto (사용자·달마다 본인 지난달 시뮬레이션으로 A/B/C 선택)
uv run python -m evaluation.replay --base-order first_tier   # A 모든 첫 구간 먼저
uv run python -m evaluation.replay --base-order main_top     # B 주력 카드 높은 구간 먼저
uv run python -m evaluation.replay --base-order value        # C 예산 배분
uv run python -m evaluation.replay --ml                      # 전략 선택 모델 + 남은 소비 예측까지

# 업종 모델 비교. 2026-01~06 으로 학습했으므로 학습에 안 쓴 7월부터 비교한다
uv run python -m evaluation.replay --start 2026-07 --category-model v1
uv run python -m evaluation.replay --start 2026-07

# 데모 사용자 보고서. 결제별 CSV 는 artifacts/reports 에 저장된다
uv run python -m evaluation.demo_report --user 1
```

## API 서버

```bash
uv run uvicorn engine.api:app --port 8000
```

브라우저에서 http://127.0.0.1:8000/docs 를 열면 API 를 직접 호출할 수 있다.

안내 문구 (`reason_code`, `engine/messages.py`, 2026-11-21 수정):

| `reason_code` | 문구 |
|---|---|
| `GENERAL_BENEFIT`·`AMOUNT_BENEFIT`·`TIME_BENEFIT` | "카페에서 결제하면 10% 할인을 받을 수 있어요!" (금액·시간 조건이 있으면 함께) |
| `HOLD` | "○○ 40만 원 구간까지 70,000원 남았어요. 채우면 다음 달에도 지금 혜택을 받아요" |
| `PERFORMANCE` | "○○ 실적 달성까지 80,000원 남았어요!" |
| `PROMOTION` | "올리브영 마이샵 25%로 약 150원을 더 받을 수 있어요!" 금액이 100원(`Params.promo_message_min`) 미만이면 내지 않고 카드 혜택 문구를 쓴다 |
| `PROMOTION_CARD` | 일정 팝업에서 추천한 행사의 카드 |
| `REPEAT` | "평일 아침에는 보통 대중교통에서 결제하셔서 이 카드를 먼저 보여 드려요" |
| `BASE_CHANGED` | "앞 카드 실적을 채워 오늘부터 ○○를 먼저 보여 드려요" 직전 기본 카드가 이번 달 구간을 실제로 채웠을 때만 |
| `HABIT` | "보통 지금 시간대에 이 카드로 계산하셨어요!" 최근 두 달 그 시간대에 그 카드를 가장 많이, 3번 이상 썼을 때만 |
| `NEUTRAL` | "지금은 카드마다 혜택 차이가 크지 않아요." 말할 혜택이 없고 습관 문구도 사실이 아닐 때 (새 코드) |
| `RULE` | "설정하신 대로 ○○를 먼저 보여 드려요" |

```bash
curl -s -X POST http://127.0.0.1:8000/internal/rank -H 'Content-Type: application/json' -d '{"user_id": 1, "lat": 37.4979, "lng": 127.0276, "accuracy_m": 20, "at": "2026-11-05T12:20:00+09:00"}'
```

| API | 용도 |
|---|---|
| `POST /internal/rank` | 카드 순서와 안내 문구를 돌려준다. `"explain": true` 면 판단 근거도 준다 |
| `GET /internal/users/{user_id}` | 사용자 확인 |
| `GET /internal/users/{user_id}/cards` | 카드별 전월·당월 실적, 다음 구간까지 남은 금액, 이번 달 받은 혜택 |
| `GET`, `PUT /internal/users/{user_id}/rules` | 챗봇이 사용자 확인을 받은 규칙 조회·저장 |
| `POST /internal/payments/evaluate` | 승인 직전 결제를 카드마다 했을 때의 혜택과 가장 유리한 카드 |
| `GET /internal/merchants` | 현장 가맹점 목록 (좌표는 주지 않음) |
| `POST /internal/payments` | 로컬 시연용 결제 추가. Postgres 저장소에서는 405 를 돌려준다 |
| `POST /internal/dev/reset` | 로컬 시연용 초기화. Postgres 저장소에서는 405 를 돌려준다 |
| `GET /health` | 상태 확인 |

| 환경 변수 | 뜻 | 기본값 |
|---|---|---|
| `SOLPAY_STORE` | `db`(로컬 개인 DB·공동 DB), `teamdb`(CSV), `parquet`, `postgres`(예전 placement 스키마) | DB 주소가 있으면 `db`, 없으면 `teamdb` |
| `SOLPAY_DATABASE_URL` | DB 주소. 없으면 루트 .env 의 `POSTGRES_*` 로 `localhost:5432` 주소를 만든다 | 없음 |
| `SOLPAY_APP_SCHEMA` | 쓰기용 표 스키마 | `app` |
| `SOLPAY_TEAM_DB_SOURCE` | `csv` 또는 `postgres` (teamdb 의 출처) | `csv` |
| `SOLPAY_TEAM_DB_DIR` | 팀 DB 형식 CSV 폴더 | `../카드서비스_DB_1년` |
| `SOLPAY_TEAM_DB_SCHEMA` | 팀 DB 표가 있는 Postgres 스키마 | `public` |
| `OPENAI_API_KEY` | 챗봇용 OpenAI 키 (`solpay-ai/.env`). 없으면 챗봇은 예비 답변만 한다 | 없음 |
| `OPENAI_MODEL`, `CHAT_TIMEOUT_SEC`, `CHAT_MAX_TOOL_CALLS`, `CHAT_HISTORY_TURNS` | 챗봇 모델·제한 시간·도구 호출 수·대화 수 | `gpt-4o-mini`, 15, 3, 10 |
| `SOLPAY_INTERNAL_TOKEN` | 설정하면 `X-Internal-Token` 헤더를 검사한다 | 없음 |
| `SOLPAY_CATEGORY_MODEL` | `v2` 면 LightGBM 업종 모델을 쓴다 | v1 |
| `SOLPAY_DATA_DIR` | 가상 데이터 폴더 | `../data/out/parquet` |
| `SOLPAY_ARTIFACTS` | 학습 결과 폴더 | `artifacts` |

### API 시나리오 테스트 (Postman)

`postman/solpay-ai.postman_collection.json` 은 서버를 켠 상태에서 알고리즘 동작을 확인하는 요청 20개와 자동 검사 59개다.
준비(기록 초기화) → 기본 배치 → 하루 일정과 팝업 → 사용자 규칙 → 결제 결과와 안내 순서로 돈다.
데이터가 2025-11-01~2026-11-05 가상 결제라 요청마다 시각(`at`)을 넣는다. 일정 팝업은 지금 `promotions.yml`(11월) 행사를 쓰므로 11월 날짜로 확인한다.

```bash
cd postman && postman collection run solpay-ai.postman_collection.json -e local.postman_environment.json
# 다른 포트의 서버: --env-var baseUrl=http://127.0.0.1:8011
```

Postman 앱에서는 Import 로 두 파일을 불러오고, 오른쪽 위 환경을 'solpay-ai 로컬'로 고른 뒤 컬렉션의 Run 으로 돌린다.

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

- 프로모션의 기간 누적 한도와 1인 횟수 제한. 지금은 신한 SOL페이 11월 이벤트·마이샵 31건과 팀 DB 행사를 건당 한도로만 계산하고, 가상 가맹점과 브랜드가 맞는 10건이 실제로 작동한다. 가맹점을 모르는 결제는 업종 안 브랜드 비중으로 기대값을 센다 (설계서 v4.2, `Params.promo_in_score`).
- 사용자의 마이샵 ON 상태. 엔진은 켜지 않은 마이샵도 받을 수 있다고 보고 계산하고, 행사 때문에 고른 카드면 문구에 행사 이름을 보여 준다.
- K-패스 정부 환급. 카드사 혜택만 계산한다.
- 하루 일정 입력률(평소와 다른 결제 30%, 일반 10%)과 입력 금액 오차(±20%)는 평가용 가정값이다.

## 하루 일정·신규 카드 추천 (2026-11-14)

GPS 는 쓰지 않는다. 결제 화면은 하루 일정이 있으면 일정(시작 30분 전 ~ 끝 30분 후)으로, 없으면 소비 패턴으로 배치한다.

| API | 하는 일 |
|---|---|
| `PUT /internal/users/{id}/schedules/{day}` | 하루 일정 저장 (시작·끝 시각, 업종, 예상 금액만). 운영 DB 에는 암호문으로만 저장하고 지난 날은 지운다 |
| `GET/DELETE /internal/users/{id}/schedules/{day}` | 조회·삭제 |
| `POST /internal/users/{id}/schedule-popup` | 일정 저장 뒤 팝업 (설계서 v4.1). 마지막 카드 추천에서 3일이 지났으면 신규 신한카드 추천(`kind=card`, 월 3,000원 이상 이득), 그 외의 날은 일정 업종에 맞는 프로모션 최대 2건(`kind=promotion`). 프로모션을 추천한 일정 시간(시작 30분 전 ~ 끝 30분 후)에는 그 프로모션을 받으면서 건당 혜택이 가장 큰 신한카드를 1순위로 둔다. 프로모션 목록은 `data/config/promotions.yml` (`SOLPAY_POPUP_PROMOTIONS`) |
| `POST /internal/users/{id}/recommendation-page` | 맞춤 추천 페이지 (일정 저장·건너뛰기 뒤, 설계서 `docs/superpowers/specs/2026-11-19-recommendation-page-design.md`). `tabs`: `card`(아직 없는 신한카드 중 오늘 항목에서 보유 카드보다 더 주고, 지난 1년 소비로 따져 연회비를 빼고도 이득인 카드 가운데 1년 이득이 가장 큰 카드. 2026-11-21 변경) / `merchant`(일정 업종 프로모션 가맹점 최대 2건). 카드날(마지막 카드 추천 3일 뒤, 대신 보여 준 카드는 세지 않음)은 두 탭, 그 외 날은 가맹점 탭, 프로모션이 없으면 카드 탭. 일정이 없으면 최근 30일 평소 소비로. 카드·금액은 엔진, 문구는 OpenAI(`gpt-4o-mini`, `PAGE_COPY_TIMEOUT_SEC` 기본 8초, 검사에 걸리면 정해진 문구 `copy_source=template`, 탭이 비면 OpenAI 를 부르지 않고 `none`). 그 안에서도 오늘 일정 업종·브랜드를 콕 집은 혜택이 있는 카드를 먼저 고른다 (`Params.page_schedule_first`). 화면의 큰 글씨는 `card.keyword`(오늘 일정에서 받는 혜택, 예 '음식점 10% 할인')이고 `card.keywords`·`items[].keyword`·`items[].specific` 을 함께 준다. 문구는 `copy.title`(예 '점심엔 음식점 10% 할인'), `copy.amount_label`(큰 글씨 아래 한 줄, 예 '13:00 음식점 9,800원 → 980원 할인'), `copy.reasons`(함께 받는 혜택 → '지난 1년 소비라면 ○원 더' → '○○ 대신 썼을 때 기준' → 연회비·실적 조건, 최대 4줄). `card.yearly_gain`(지난 1년 결제에 그 카드가 있었다면 더 받았을 금액, 연회비 뺌. 연말정산 놓친 혜택과 같은 숫자)과 `yearly_months`·`yearly_basis`(add/swap)·`replaces` 는 결제 이력이 두 달 미만이면 없다(null). `card.show_amount` 는 오늘 혜택 금액(원)을 문구에 쓰는지(오늘 더 받는 금액 500원, `Params.page_amount_min`). 표본 60명(2026-11-05 08시, 일정 없음): 1년 손해 카드 추천 21명 → 0명, 대표 혜택이 일정 업종 혜택 52/57명, 1년 1위 카드 12명 → 43명, 카드 탭 60명 → 57명. `Params.page_yearly=False`·`page_schedule_first=False` 면 이전 규칙. 같은 카드는 2주(`Params.recommend_same_card_days`, 2026-11-21 에 30일에서 줄임) 안에 다시 추천하지 않는다: 3일마다 카드날 11번에서 카드 탭 310회 → 476회. 같은 날 다시 부르면 `cached=true`. 실제 문구 확인: `uv run python -m evaluation.page_eval` |
| `GET /internal/users/{id}/strategy` | 이번 달 실적 채우기 방식과 근거 (화면·챗봇 표시) |
| `POST /internal/users/{id}/card-recommendation` | (이전 방식) 신규 신한카드 추천 (일정의 특수 고액 결제 / 특수 업종 방문 / 같은 업종 반복 / 3일 간격) |
| `GET /internal/users/{id}/missed-benefit` | 연말정산 안내: 지난 365일(`days`) 결제에 아직 없는 신한카드가 있었다면 더 받았을 금액, 연회비를 빼고 상위 3장. 두 가정 중 큰 쪽을 쓴다 (2026-11-19 결정): 함께 쓰기(`basis=add`, 결제마다 150원 이상 더 주고 기존 카드 실적 구간을 지킬 때만 새 카드) / 가진 카드 하나를 바꾸기(`basis=swap`, 그 카드로 내던 결제를 모두 새 카드로, `replaces`). 첫 달은 실적만 쌓아 `months` 는 보통 11~12. `message` 는 정해진 틀("그때 KB ALL 카드 대신 이 카드를 쓰셨다면 11개월 동안 95,333원을 더 받으셨어요", 12개월이면 '1년'). 시연 1~5번 모두 3장, 표본 60명 중 0장 1명(이전 방식은 35명). 시험 화면 `/dev` 4번 탭 |

암호화 키: 로컬은 `.env` 의 `SOLPAY_DATA_KEY` (`uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`),
운영은 KMS 로 암호화한 데이터 키 `SOLPAY_DATA_KEY_ENCRYPTED` + `SOLPAY_KMS_KEY_ID`. 키가 없으면 일정을 저장하지 않는다.
외부 AI 로 보내는 값은 `engine/privacy.py` (`redact`, `llm_view`) 를 거친다.

## 일정과 카드 실적

일정의 업종과 예상 금액으로 현재 결제 혜택을 계산하고, 카드별 당월 실적·전월 실적과 구간별 예상 혜택으로 실적 기여 가치를 계산한다. 오늘 남은 일정이 있으면 오늘 남은 지출 예측분(지난달 일평균의 0.5일분)을 그 일정의 합으로 대체한다. 현재 활성 일정은 현재 결제로 따로 고려하므로 다시 더하지 않는다. 일정은 카드가 지정되지 않은 공동 예산이며 여러 카드에 확정 실적으로 더하지 않는다. 일정이 없으면 기존 예측을 유지한다. 예측은 일정 이행과 금액을 보장하지 않으며 0.5일은 운영 전 검증할 휴리스틱이다.

`카드서비스_DB_1년` CSV는 엔진이 직접 읽지 않는다. 해당 CSV는 `data/out/parquet`에서 내보낸 시연 데이터다. 2026-11-17 대조에서 결제 447,808건의 카드·금액·업종과 월별 당월 실적 13,806건이 일치했다. 전월 실적 1,021건의 차이는 모두 2025-11 최초 월의 데이터 생성 가정 때문이다. 다른 필드와 전 카드의 혜택 정확성이 검증된 것은 아니다.

일정은 현재 필수 업종·예상 금액 형태이며 같은 업종의 결제 이력으로 완료를 추정한다. 겹친 일정 선택·수동 완료·일정 ID별 결제 연결 및 취소 처리는 구현되지 않았다. Parquet 시연 일정은 메모리 전용이다. 실제 카드사 실적 제외 규칙·마이데이터 수신 시각 및 실제 고객 일정 데이터 검증은 별도로 필요하다.

## 로컬 개인 DB → 공동 DB (2026-11-19)

엔진과 챗봇은 데이터 폴더를 직접 읽지 않고 **로컬 개인 DB(PostgreSQL)** 를 읽는다 (`engine/db_store.py`).
DB 주소가 있으면 이것이 기본이다. 팀원과 합친 **공동 DB** 로 갈 때는 접속 주소만 바꾼다.

| 구분 | 위치 | 누가 쓰나 |
|---|---|---|
| 팀 DB 23개 표 (public) | 카드서비스_DB_1년 `schema.sql` + CSV | 엔진·챗봇은 **읽기만** |
| 쓰기용 표 (app) | `sql/002_app.sql`: 규칙, 규칙 초안, 실적 채우기 방식, 추천 기록, 하루 일정(암호문), 신규 카드 추천 기록, 시연 결제 | Spring 이 붙기 전까지 FastAPI |

- 읽는 방식: 카드·혜택·가맹점·행사·업종 표는 서버 시작 때 한 번, 사용자·보유 카드·결제는 요청마다 그 사용자 것만 (최근 400일).
- CSV 저장소와 대조 (2026-11-19): 카드 40장·가맹점 660곳·행사 29건·365명 전원의 카드와 결제가 같고, 배치 150건의 순서와 1순위 문구가 모두 같다.
- 배치 응답: 0.24초 안팎. 사용자·달마다 첫 요청(서버를 다시 켠 뒤도)은 월간 맞춤 방식을 계산해 0.31~0.48초 (HTTP, 사용자 10명).
  2026-11-19 전에는 첫 요청이 최대 1.36초로 60명 중 8명이 0.8초를 넘었다. 원인은 같은 (카드, 업종, 브랜드) 혜택 매칭을
  수백만 번 반복한 것이라 `Card.benefits_for` 가 (업종, 브랜드)마다 한 번만 고르게 했다 (60명 결과 방식·순서·점수 동일, 최대 0.51초).
  `data/generate/benefit.py` 는 이 파일과 글자까지 같아야 한다 (`tests/test_real_data.py`).
- 연결 풀 (2026-11-20): 요청마다 DB 에 새로 접속하던 것을 `psycopg_pool` 로 재사용한다 (`SOLPAY_DB_POOL_MAX` 기본 10,
  `SOLPAY_DB_POOL_TIMEOUT` 기본 5초). 꺼내 줄 때 연결이 살아 있는지 확인한다. 앱이 만든 저장소는 서버를 끌 때 닫는다.
- 지난 일정 삭제 (2026-11-20): 결제 화면 요청은 DB 에 쓰지 않는다. 지난 날 일정은 서버 시작 때 한 번, 그 뒤 매일 00:05(한국 시각)에
  지운다 (`engine/jobs.py`). 삭제가 실패해도(읽기 전용 계정 등) 서버는 멈추지 않고 경고만 남긴다.
  같은 컴퓨터 DB 에서 사용자 10명 `context()` 가 중앙값 166ms → 46ms, HTTP 배치는 중앙값 48ms (첫 요청 153ms) 로 줄었다.
  원격 공용 DB 는 접속 비용이 더 커서 차이가 더 크다.

처음 준비 (여러 번 실행해도 된다):

```bash
# 저장소 루트: 로컬 PostgreSQL 켜기 (Docker Desktop 필요, 계정은 루트 .env)
docker compose up -d db
# solpay-ai: 팀 표가 없으면 schema.sql + CSV 적재, 있으면 행 수 대조. app 스키마 생성. 일정 암호화 키가 없으면 solpay-ai/.env 에 만든다
uv run python -m scripts.setup_local_db
uv run python -m scripts.setup_local_db --db solpay_test     # 자동 테스트용 DB (tests/test_db_store.py)
# 서버 (DB 주소는 루트 .env 의 POSTGRES_* 로 만든다)
uv run uvicorn engine.api:app --port 8000
```

| API (로컬에서 Spring 대신) | 하는 일 |
|---|---|
| `POST /internal/chat` | 규칙 초안이 나오면 `app.chat_rule_drafts` 에 '대기'로 두고 `rule_draft.draft_id` 를 준다 |
| `POST /internal/rules/drafts/{id}/confirm` | 규칙 카드의 '저장': 다시 검사하고 `app.user_rules` 에 더한다 (다른 사용자 404, 이미 처리 409) |
| `POST /internal/rules/drafts/{id}/cancel` | '취소' |
| `POST /internal/payments` | 시연 결제를 `app.demo_payments` 에 쓴다 (팀 payments 표에는 쓰지 않는다) |
| `POST /internal/dev/reset` | app 표를 모두 비운다. 접속 주소가 이 컴퓨터일 때만 된다 (공동 DB 는 405) |

공동 DB 로 바꿀 때:

1. 공동 DB 에 팀 `schema.sql` 로 23개 표를 만들고 데이터를 적재한다 (팀 절차. `setup_local_db` 는 로컬에만 쓴다).
2. `solpay-ai/.env` 에 `SOLPAY_DATABASE_URL=postgresql://계정:비밀번호@공동DB주소:5432/DB이름` 을 넣는다 (읽기 전용 계정이면 된다).
3. Spring 이 붙기 전이면 공동 DB 에 `sql/002_app.sql` 을 적용하고 쓰기 권한을 준다. Spring 이 붙으면 app 표를 Spring 의 표로 옮기고
   FastAPI 는 읽기 전용 계정으로 바꾼다.
4. 스키마 이름이 다르면 `SOLPAY_TEAM_DB_SCHEMA`(기본 public), `SOLPAY_APP_SCHEMA`(기본 app) 로 맞춘다.
5. 엔진은 `user_card_details`, `payment_details` 를 조회한다. 팀 최종 DB(18개 표)에 이 두 표가 없으면 넣어야 한다.
6. 결제 조회용 인덱스를 만든다: `CREATE INDEX ON payments (user_card_id, paid_at);` (없으면 요청마다 결제 전체를 훑는다).
7. 공동 DB 를 쓰는 FastAPI 는 모두 같은 `SOLPAY_DATA_KEY` 를 쓴다 (다르면 남이 저장한 일정을 못 읽는다).

DB 없이 돌리려면 `SOLPAY_STORE=teamdb` (CSV 를 메모리에 올림).

## 데이터 출처: 팀 DB 형식 (2026-11-19)

API 서버는 기본으로 `카드서비스_DB_1년` CSV(팀 DB 23개 표, `schema.sql` 과 같은 칸)를 읽는다 (`engine/team_db.py`).
나중에 DB 로 바꿀 때는 같은 표를 읽으므로 출처만 바꾼다.

```bash
# 지금: CSV 폴더
uv run uvicorn engine.api:app --port 8000
# 나중: schema.sql → load_all.sql 로 적재한 Postgres 의 같은 표 (읽기 전용 계정이면 된다)
SOLPAY_TEAM_DB_SOURCE=postgres SOLPAY_DATABASE_URL=postgresql://... uv run uvicorn engine.api:app --port 8000
```

- 엔진이 읽는 표: cards, card_tiers, benefits, benefit_tiers, benefit_targets, benefit_groups, benefit_group_tiers, categories,
  merchants, merchant_aliases, users, user_cards, user_card_details, payments, payment_details, promotions (+ 챗봇 안내용 card_perks)
- 카드 코드·카드사 코드·브랜드 표기 규칙은 데이터가 아니라 설정이라 `data/config/card_db_map.yml` 을 읽는다.
- 가맹점: 팀 DB merchants 의 ID 를 그대로 쓰고, 결제(`payments.merchant_name`, 브랜드 단위)는 (브랜드, 업종)마다 대표 지점에 잇는다.
  지점이 없는 온라인·동네 가맹점은 10,000,001 부터 번호를 붙인다.
- parquet 와 대조 (2026-11-19): 카드 40장 계산 값 동일, 결제 447,808건 동일, 배치 150건의 카드 순서 모두 동일.
  문구 1건만 달랐다 (parquet 에서 브랜드 없는 '현대백화점 ○○' 가게에 행사가 붙던 것. 팀 DB 쪽이 맞다).
- Postgres 출처(`SOLPAY_TEAM_DB_SOURCE=postgres`)는 코드만 있고 아직 실제 DB 로 확인하지 않았다.
- 배경 사용자 번호가 parquet 와 달라 전략 기록은 `artifacts/strategy_teamdb.sqlite` 에 따로 둔다.

## AI 챗봇 (2026-11-19)

설계서: `SOL페이 AI 챗봇 설계서.docx`. 앱 → Spring `/api/chat` → FastAPI `/internal/chat` → OpenAI(gpt-4o-mini, Chat Completions 함수 호출).
금액·혜택·실적 숫자는 모두 엔진 도구가 계산하고, LLM 은 문장만 쓴다. FastAPI 는 대화를 기억하지 않고 DB 에 쓰지 않는다.

```bash
cp .env.example .env      # OPENAI_API_KEY 를 채운다
uv run uvicorn engine.api:app --port 8000
curl -s -X POST http://127.0.0.1:8000/internal/chat -H 'Content-Type: application/json' \
  -d '{"user_id": 1, "message": "스타벅스에서 6천 원 결제할 건데 뭐 써?", "at": "2026-11-05T12:20:00+09:00", "screen": {"name": "pay"}}'
```

| 파일 | 역할 |
|---|---|
| `engine/chat/agent.py` | OpenAI 호출, 도구 반복(질문당 3번), 15초 제한, 검사 실패 시 한 번 다시 쓰기, 예비 답변 |
| `engine/chat/tools.py` | 도구 8개의 정의(JSON 스키마)와 실행, 화면 요소(blocks) |
| `engine/chat/prompts.py` | 시스템 프롬프트(역할·숫자 원칙·도구 사용·답변 형식·금지 사항)와 문맥 |
| `engine/chat/guard.py` | 숫자 검사기(도구 결과에 없는 금액·비율), 소비 권유·저장 주장 검사 |
| `engine/chat/search.py` | 카드 이름·가맹점 이름(별칭 포함)·업종 검색 |
| `engine/chat/new_card.py` | 맞춤형 카드 추천: 최근 3개월 결제를 미보유 신한카드 한 장으로 다시 계산 |
| `evaluation/chat_eval.py` | 질문 세트를 실제 OpenAI 로 돌려 도구 선택 정확도·숫자 검사 통과율·응답 시간 측정 |

| 도구 | 명세서 기능 | 화면 요소 |
|---|---|---|
| `explain_ranking` | 추천 이유 설명, 이번 달 배치 방식 안내(지난 결제로 비교한 방식별 혜택) | `score_table` |
| `simulate_payment` | 가정 계산 (차이 금액은 도구가 미리 계산) | `card_compare` |
| `get_card_status` | 실적·한도 조회 (지금 구간 유지·다음 구간까지 남은 금액, 한도 사용) | `card_status` |
| `get_card_benefits` | 카드 혜택 안내 (6개 카드사 40종, 계산 제외 혜택은 이름만) | `benefit_list` |
| `draft_rule` | 규칙 설정, 실적 채우기 방식 변경(order), 실적 채울 카드 설정(no_fill) | `rule_card` |
| `recommend_new_card` | 맞춤형 카드 추천 (연회비÷12 를 뺀 월 평균 순혜택 상위 3장) | `new_card_list` |
| `recommend_for_payment` | 가맹점·금액 입력 추천 (업종 예측 없이 정확히, 프로모션·실적 포함) | `card_compare`, `pay_button` |
| `find_merchant` | 가맹점 검색 (다른 도구의 입력 준비) | 없음 |

결정 (2026-11-19):
- 도구는 8개를 유지한다. 방식 변경·실적 제외는 `draft_rule` 의 규칙 종류로, 이번 달 방식 안내는 `explain_ranking` 결과에 넣는다.
- 새 규칙 종류 `no_fill`: 그 카드를 실적을 채울 기본 카드 후보에서 빼고 건당 혜택으로만 경쟁시킨다. 규칙이 없는 사용자의 결과는 그대로다.
  `order` 규칙은 '실적 안 채움'(none)도 받는다. 확정한 방식은 월간 맞춤 선택보다 우선한다.
- 규칙은 초안만 만든다(`rule_draft`). Spring 이 저장 직전에 `POST /internal/rules/validate` 로 다시 검사한다.
  시연용 `PUT /internal/users/{id}/rules` 는 Spring 연동 전까지 남겨 둔다.
- 숫자 검사기는 도구 값을 10·100·1,000·10,000원 단위로 반올림한 표현('약 145만 원')을 통과시킨다.
- 추천 질문 칩 = 예비 답변 4개: 왜 이 카드가 1순위야? / 이번 달 실적 얼마 남았어? / 내 소비에 맞는 카드 찾아줘 / 스타벅스에서 6천 원 결제할 건데 뭐 써?
  OpenAI 키가 없거나 장애·시간 초과면 이 4개는 도구만 실행한 정해진 문장으로 답하고(`fallback: true`), 나머지는 '잠시 후 다시 물어봐 주세요'.
- 검사기는 초안 없이 '저장을 누르면'이라고 안내한 답을 잡아 다시 쓰게 하고, 이때는 draft_rule 을 부를 수 있게 한다.
  '설정했습니다'·'변경했습니다' 같은 저장 주장도 잡는다.
- 규칙 조건은 사용자가 말한 것만: 사용자 문장에 시각('6시', '18:00')이나 요일('주말', '토·일')이 없으면 draft_rule 이 초안을 만들지 않고 되묻게 한다.
- '편의점'처럼 업종 이름과 같으면 가맹점이 아니라 업종으로 계산하고, LLM 이 업종 인자를 빠뜨리면 질문 속 업종 이름(하나일 때만)으로 채운다.
- 질문에 브랜드(스타벅스 등, 별칭 포함)가 하나만 있는데 LLM 이 업종만 넘기면 그 가맹점으로 다시 찾는다 (브랜드 혜택·행사가 빠지지 않게).
- 가정 계산은 카드마다 1위 대비 차이(less_than_best)를 미리 계산한다. 규칙에 요일 7개가 모두 들어오면 '매일'로 본다.
- 시각만 말하고 요일을 말하지 않으면 초안을 만들지 않고 "어떤 요일에 적용할까요? (매일·평일·주말 등)"라고 되묻는다 (사용자 결정, 프롬프트 v5).
- OpenAI 에는 카드 상품명·업종·금액과 대화만 보낸다. 사용자 문장은 `engine/privacy.redact` 로 카드번호·전화번호 등을 가린다.

| API | 부르는 쪽 | 용도 |
|---|---|---|
| `POST /internal/chat` | Spring | 질문과 최근 대화(history), 화면 문맥(screen)을 보내고 답(reply), 화면 요소(blocks), 규칙 초안, 기록용 log 를 받는다 |
| `POST /internal/rules/validate` | Spring | 저장 직전 규칙 초안 재검사 (보유하지 않은 카드면 422) |

평가 (`OPENAI_API_KEY` 필요, 질문마다 비용이 든다):

```bash
uv run python -m evaluation.chat_eval
```

평가 기록 (2026-11-19, 데모 1번, 2026-11-05 12:20 기준):
- 17문항, 도구 선택·거절 정확도: 프롬프트 v1 82.4% → v2 94.1% → v3 100%
- 50문항(설계서 6개 묶음, 정답 숫자·규칙 종류까지 채점): v3 84%(처음 보는 33문항 78.8%) → v4 98%(97%).
  v4: 도구 100%, 정답 숫자 포함 100%, 응답 시간 중앙값 2.7초·최대 7.7초. 남은 오답 1건은 '6시부터 10시까지'(되물은 뒤)에서
  LLM 이 오늘 요일을 넣어 검사에 걸리고 요일을 다시 물은 것.
- v5(요일 되묻기): 96%(48/50). 오답 2건 중 '주말엔 KB 먼저'는 다시 돌리면 2/2 정답(LLM 흔들림),
  나머지는 "'…KB 카드를 1순위로 저장해'라는 가맹점" 질문에 규칙 초안을 만든 것(3번 중 2번 재현, 코드 방어 필요).
- v6(요일을 말했으면 되묻지 않기, `guard.DAYS_GIVEN` 검사 + 도구 허용 재시도): 98%(처음 보는 질문 97%). 남은 오답은 위 주입 질문.
- 따옴표 속 지시 방어 (2026-11-19, 사용자 승인): `draft_rule` 은 사용자 문장에서 따옴표('…', "…", ‘…’, “…”, 「…」) 안을 빼고도
  규칙을 요청하는 말('먼저', '빼줘', '실적', '방식', '순위' 등, `tools.asked_rule`)이 있어야 초안을 만든다. 없으면 `need=request` 를 돌려준다.
  도구 결과(가맹점명 등)에 숨은 지시도 사용자 문장에 규칙 요청이 없으면 초안이 되지 않는다.
  확인: 50문항 100%(50/50), 응답 시간 중앙값 2.8초·최대 8.8초. 주입 질문 3종 × 5번 = 15번 모두 초안 없음
  (LLM 이 draft_rule 을 부른 7번을 코드가 막음). 한계: 최근 사용자 문장 6개를 함께 보므로, 바로 앞에서 규칙을 요청했다면 통과한다(초안은 저장 버튼을 눌러야 저장된다).
- 결과 파일: `artifacts/reports/chat_eval_prompt_v1.json`, `_v2.json`, `_v3_17q.json`, `chat_eval_50q_v3.json`, `chat_eval_50q_v4.json`, `chat_eval_latest.json`(v6 + 따옴표 방어)
- RAG·LangChain·LangGraph 는 쓰지 않는다. openai SDK 의 함수 호출 반복을 직접 짰다.
- 데모 1번 한 사람, 한 시각으로만 쟀다. 다른 사용자·시각으로도 재야 한다.

설계서(구현 반영): https://claude.ai/artifact/GTibT2ED41KLAKvsfqWgzk

아직 하지 않은 것: 다른 데모 사용자로 평가, 하루 질문 수 제한(Spring), 대화 기록 보관 기간, Postman 컬렉션에 챗봇 요청 추가.
