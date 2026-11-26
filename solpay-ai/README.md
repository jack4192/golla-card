# Pay·Mate AI 서버 (solpay-ai)

결제 화면에서 **어느 카드를 먼저 보여 줄지** 정하고, 그 판단을 설명·추천·리포트·챗봇으로 풀어 주는 FastAPI 서버입니다.
카드 순서만 정하고 결제 확정은 고객이 합니다. 앱은 백엔드(Spring)만 부르고, 백엔드가 이 서버의 `/internal/*` API 를 부릅니다.

- 숫자(혜택·실적·구간·효과)는 모두 엔진이 계산합니다. OpenAI 는 문장을 쓰거나 고르기만 하고, 쓴 문장은 검사를 통과해야 나갑니다.
- 가상 데이터의 카드 혜택과 소비는 임의 값입니다. 평가 수치는 알고리즘 동작 검증이지 실제 절감액이 아닙니다.
- 실행·학습·평가·API·환경 변수의 자세한 내용은 [docs/상세_기록.md](docs/상세_기록.md) 에 있습니다.

| 설계 문서 | 내용 |
|---|---|
| [카드배치_알고리즘_설계서](../docs/설계/카드배치_알고리즘_설계서.md) | 배치 알고리즘 6단계, 설정 값, 실패 처리, 검증 |
| [LLM_챗봇_설계서](../docs/설계/LLM_챗봇_설계서.md) | Tool Calling 구조, 도구 17개, 답변 검사, 모델 설정, 검증 |
| [챗봇_500문항_검증_보고서](../docs/설계/챗봇_500문항_검증_보고서.md) | 챗봇 500문항 평가 방법과 결과 |

## 기능

| 기능 | 하는 일 | API |
|---|---|---|
| 결제 화면 카드 배치 | 시각·소비 패턴·하루 일정·실적·행사를 보고 카드 1장을 맨 앞에 두고 안내 문구와 예시 거래를 붙입니다. 앱 홈 미리보기는 `"record": false`(같은 계산, 추천 기록 없음) | `POST /internal/rank` |
| 하루 시간표 | 오늘 시간대마다 1순위 카드 (홈 '오늘의 카드 시간표') | `POST …/day-placement` |
| 하루 일정 | 그 시간에는 일정 업종으로 배치 (암호화 저장, 지난 날은 삭제) | `PUT·GET·DELETE …/schedules/{day}` |
| 일정 직접 입력 분류 | "스벅"·"헬스장" 같은 짧은 말을 업종·브랜드로 (검색 먼저, 못 찾으면 OpenAI 가 목록 안에서 고름, 확신이 낮으면 후보만) | `POST /internal/places/classify` |
| 맞춤 추천 페이지 | 일정 저장 뒤 '카드사 추천'(아직 없는 신한카드)·'가맹점 추천'(행사) | `POST …/recommendation-page` |
| 일정 팝업·새 카드 추천 | 3일마다 새 신한카드, 그 외 날은 일정에 맞는 행사 | `POST …/schedule-popup`, `POST …/card-recommendation` |
| 연말 결산 놓친 혜택 | 지난 1년 결제를 다른 신한카드로 냈다면 더 받았을 금액 상위 3장 (1만 원 이상) | `GET …/missed-benefit` |
| 월간 리포트 | 카드별 이번 달·지난달 실적과 혜택, 이번 달 방식, 지난달 '추천대로 냈다면' 효과 | `GET …/monthly-report` |
| AI 챗봇 | 결제 카드·실적·혜택·결제 내역·행사·앱 사용법 질문에 도구 17개로 답하고, 규칙·일정 초안을 만듭니다 | `POST /internal/chat` |
| 사용자 규칙 | 카드 고정·제외, 실적 채우기 방식, 실적 채우지 않기. 챗봇 초안 → 사용자 확인 → 저장 | `…/rules`, `/internal/rules/*` |
| 카드 현황·결제 평가 | 카드별 실적·남은 구간·한도, 결제 한 건을 카드마다 냈을 때의 혜택 | `GET …/cards`, `POST /internal/payments/evaluate` |
| 실적 채우기 방식 | 사용자·달마다 지난 결제로 방식(첫 구간 우선·주력 카드 우선·가치 최대·실적 안 채움)을 비교해 고릅니다 | `GET …/strategy`, `POST …/strategy/initialize` |
| 시험 화면 | 위 기능을 눌러 볼 수 있는 개발용 화면 (`SOLPAY_DEV_TOOLS=on`) | `GET /dev`, `GET /docs` |

### 배치 알고리즘 한눈에

1. **상황 파악**: 하루 일정이 있으면 일정, 없으면 LightGBM 업종 예측으로 지금 어디서 얼마 쓸지 확률을 만듭니다.
2. **사용자 규칙**: 고정·제외 규칙과, 일정 팝업에서 추천한 행사 카드를 먼저 적용합니다.
3. **실적 채우기 방식**: 지난 결제로 비교한 월간 맞춤 방식, 또는 사용자가 정한 방식.
4. **기본 카드**: 지난달 받던 구간 지키기 → 방식이 고른 카드 → 혜택률 1위.
5. **원화 점수**: 카드마다 즉시 혜택 + 프로모션 기대값.
6. **교체**: 다른 카드의 이득이 기본 카드의 실적 가치보다 크거나 500원 이상이고, 근거 확률이 30% 이상일 때만 바꿉니다. 항상 1장과 안내 문구를 줍니다.

백엔드는 배치 응답을 2초까지 기다리고, 넘으면 사용자가 정한 카드 순서로 결제 화면을 보여 줍니다.

### OpenAI 를 쓰는 곳과 안전장치

모델은 GPT-6.1 Terra(`gpt-6.1-terra`, 생각 단계 none)입니다.

| 쓰는 곳 | OpenAI 가 하는 일 | 안전장치 |
|---|---|---|
| 챗봇 | 질문 이해, 도구 호출, 답변 문장 | 숫자는 도구 결과만 (숫자 검사기), 저장 주장·소비 권유 검사, 개인정보 가리기, 저장은 사용자 확인 뒤, 시간 초과면 예비 답변 |
| 일정 직접 입력 분류 | 검색으로 못 찾은 말을 업종·브랜드 목록 안에서 고르기 | 목록 밖 답은 버림, 브랜드는 글과 닮고 그 업종에 있을 때만, 확신이 낮으면 후보만 |
| 월간 리포트 | 제목 한 줄 + 엔진이 쓴 후보 문장 중 1~2개 고르기 | 제목의 숫자는 지난달 합계만, 요점·효과·전략 문장은 엔진이 씀 |
| 맞춤 추천 페이지 | (`SOLPAY_PAGE_COPY_LLM=1` 일 때) 추천 문구 | 엔진 금액·줄을 그대로 썼는지 검사, 실패하면 정해진 문구. 기본은 정해진 틀 |

OpenAI 에는 카드 상품명·업종·금액만 보내고 사용자 번호·이름·가맹점 원문·일정 원문은 보내지 않습니다. 키가 없어도 모든 API 는 정해진 문구로 동작합니다.

### 챗봇 도구

| 묶음 | 도구 |
|---|---|
| 지금 결제 | `explain_ranking`(추천 이유), `recommend_for_payment`(이 가게에서 낼 카드), `simulate_payment`(가정 계산), `get_day_plan`(오늘 시간대별 1순위 카드) |
| 카드 | `get_card_status`(실적·구간·한도), `get_card_benefits`(혜택표, 44종), `compare_cards`(카드 비교) |
| 결제 내역 | `get_spending`(기간·업종·카드별 합계), `review_payments`(지난 결제를 다른 카드로 냈다면), `get_benefit_summary`(받은 혜택·놓친 혜택) |
| 추천·행사 | `recommend_new_card`(새 신한카드), `list_promotions`(진행 중인 행사), `find_merchant`(가게 찾기) |
| 규칙·일정 | `draft_rule`(규칙 초안), `draft_rule_delete`(규칙 지우기 초안), `list_my_rules`(저장된 규칙), `draft_schedule`(일정 초안) |

## 평가 결과 (가상 데이터 v2.1, 1,005명)

| 항목 | 결과 |
|---|---|
| 결제 화면 배치 (2026-07-01~11-05 결제 202,288건 재생) | 혜택률 습관 0.811% → 엔진 **1.326%** (+0.515%p), 1인 월평균 8,205원 더 받음, 손해 37명(3.7%) |
| 상한 대비 | 사후 최적 1.536% → 확보율 71.1% (남은 차이의 약 96% 는 결제 예측) |
| 업종 예측 LightGBM (07~10월) | 1순위 적중 52.2%, 3순위 75.6% |
| 규칙 점검 | 45명·배치 9,361건, 문제 0건 |
| 배치 속도 (엔진 계산) | 중앙 4.5ms, 95% 11.4ms |
| 챗봇 500문항 (데모 1~5번, 13묶음) | 495/500 (99.0%), 처음 보는 417문항 98.8%, 정답 숫자 99.4%, 응답 시간 중앙 7.1초 |
| 일정 직접 입력 분류 69개 | 업종 95.7%, 브랜드 100%, 틀린 브랜드 0 |
| 자동 시험 | `tests/` 692개 (DB 가 필요한 시험은 로컬 시험 DB 가 있을 때만 돎) |

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| `engine/` | 배치 엔진과 API (배포 대상) |
| `engine/chat/` | 챗봇, 일정 분류, OpenAI 문구 작성·검사 |
| `training/` | 전체 분포·LightGBM 모델 학습 (학습할 때만) |
| `evaluation/` | 재생 평가, 상한, OpenAI 기능 평가 (평가할 때만) |
| `scripts/` | 로컬 DB 준비, API 명세 내보내기 |
| `sql/` | 엔진이 쓰는 표 |
| `tests/` | 자동 시험 |
| `postman/` | API 시나리오 (요청 24개, 검사 79개) |
| `docs/` | 상세 기록 |
| `artifacts/` | 학습 결과·평가 결과 (깃 제외, 각자 만든다) |

## 파일별 설명

### `engine/` — 배치 엔진

| 파일 | 하는 일 |
|---|---|
| `api.py` | FastAPI 앱. 경로 27개(내부 API·상태 확인·시험 화면), 입력 검사, 내부 토큰 검사, 오류 응답 |
| `service.py` | 진입점. 저장소에서 사용자 상태를 만들어 배치·추천·리포트를 조립합니다 |
| `ranker.py` | 기본 카드 고르기, 카드별 원화 점수, 교체 판단 (알고리즘 4~6단계) |
| `scenarios.py` | 지금 어디서 얼마 결제할지를 확률로 만듭니다 (일정 → 반복 구간 → 업종 예측) |
| `category_model.py` | 업종 예측 LightGBM 을 불러 확률을 냅니다 |
| `priors.py` | 전체 사용자 분포. 개인 이력이 적을 때 섞어 씁니다 |
| `slots.py` | 평일/주말 × 시간대 구간 |
| `rules.py` | 사용자 규칙 형식 검사와 적용 (고정·제외·성향·방식·실적 안 채움) |
| `strategy.py`, `strategy_store.py` | 실적 채우기 방식을 지난 결제로 비교해 고르기, 방식 저장 |
| `perf_value.py` | 남은 필요액·구간 가치·실적 가치 (교체 기준) |
| `benefit_calc.py` | 카드 혜택 계산 (할인·적립, 실적 구간, 한도). `data/generate/benefit.py` 와 같은 파일 |
| `catalog.py`, `domain.py` | 카드·가맹점 기준 정보, 엔진이 주고받는 값 |
| `state.py` | 사용자 한 명의 상태. 결제를 시간순으로 넣으면 실적·한도·패턴이 쌓입니다 |
| `messages.py`, `example.py` | 안내 문구와 이유 코드(`reason_code`), 결제 화면 '이 거래의 예상 혜택'에 쓸 예시 거래 |
| `day_plan.py` | 하루 시간대별 1순위 카드 |
| `popup.py`, `recommend.py` | 일정 팝업의 행사 추천, 새 카드 추천·놓친 혜택 계산 |
| `page.py`, `report.py` | 맞춤 추천 페이지, 월간 리포트 |
| `place.py` | 일정 직접 입력 분류 (검색 단계) |
| `params.py` | 알고리즘 기준값 |
| `spend_model.py`, `ml.py` | 남은 소비 예측·방식 선택 모델 (기본은 끔, 파일이 없으면 규칙으로 동작) |
| `store.py`, `team_db.py`, `db_store.py`, `pg_store.py`, `loader.py` | 저장소: 메모리, 팀 DB 형식 CSV, PostgreSQL(팀 표 읽기 + `app` 스키마 쓰기), placement 스키마, parquet·행사 yml |
| `crypto.py`, `privacy.py`, `jobs.py`, `settings.py` | 일정 암호화, OpenAI 로 보내기 전 개인정보 가리기, 매일 지난 일정 삭제, `.env` 읽기 |
| `static/dev_console.html` | 개발용 시험 화면 (`/dev`) |

### `engine/chat/` — 챗봇과 문구

| 파일 | 하는 일 |
|---|---|
| `agent.py` | 챗봇 본체: OpenAI 함수 호출, 도구 반복(3번), 15초 제한, 답변 검사·다시 쓰기, 예비 답변 |
| `tools.py` | 도구 17개의 정의와 실행, 화면 요소, 규칙·일정 초안 |
| `prompts.py` | 시스템 프롬프트(앱 사용 안내·카드 용어 포함)와 요청마다 바뀌는 문맥 |
| `guard.py` | 답변 검사: 도구 결과에 없는 숫자, 소비 권유, 저장 주장, 초안 없는 저장 안내 |
| `history.py` | 결제 기록 합계, 지난 결제 다시 계산, 받은 혜택 |
| `search.py` | 카드·가맹점·업종 이름 검색 (LLM 은 이름으로 말하고 서버가 번호로 바꿈) |
| `new_card.py` | 최근 결제를 미보유 신한카드 한 장으로 다시 계산하는 새 카드 추천 |
| `openai_params.py` | 모델·생각 단계 설정 |
| `place_llm.py` | 일정 직접 입력 분류의 OpenAI 단계 |
| `page_copy.py`, `report_copy.py` | 맞춤 추천 페이지 문구, 월간 리포트 문장·제목 검사 |

### `training/` — 학습

| 파일 | 하는 일 |
|---|---|
| `build_priors.py` | 전체 사용자 분포(`priors.json`). 서버 실행에 필요합니다 |
| `train_category.py` | 업종 예측 LightGBM 학습 (1~6월 학습, 7~10월 평가) |
| `train_spend.py`, `train_strategy.py` | 남은 소비 예측·방식 선택 모델 학습 |
| `tune.py` | 기준값 후보 비교 (설정은 바꾸지 않음) |

### `evaluation/` — 평가

| 파일 | 하는 일 |
|---|---|
| `replay.py` | 결제를 시간순으로 다시 흘려 '습관대로' 대비 엔진의 혜택률을 잽니다 |
| `oracle.py` | 결제를 모두 미리 안다고 할 때의 최대 혜택 (상한) |
| `demo_report.py` | 시연 사용자 한 명의 결과 표와 결제별 CSV |
| `chat_eval.py` | 챗봇 83문항을 실제 OpenAI 로 채점 |
| `chat_eval_500.py`, `chat_cases_500.json` | 챗봇 500문항 (데모 1~5번, 13묶음) 질문 셋 만들기·실행·채점, 결과 `evaluation/results/` |
| `place_eval.py` | 일정 직접 입력 분류 69개 |
| `page_eval.py`, `report_eval.py` | 맞춤 추천 페이지·월간 리포트 문구 |

### 그 밖

| 파일 | 하는 일 |
|---|---|
| `scripts/setup_local_db.py` | 로컬 PostgreSQL 에 팀 표와 `app` 스키마를 준비합니다 |
| `scripts/export_openapi.py` | 백엔드에 넘길 API 명세 `openapi.json` 을 만듭니다 |
| `scripts/load_demo_to_postgres.py` | parquet 가상 데이터를 placement 스키마에 넣습니다 |
| `sql/002_app.sql` | 엔진이 쓰는 표: 규칙, 규칙 초안, 방식 선택, 추천 기록, 일정, 카드 추천 기록, 시연 결제 |
| `sql/001_placement.sql` | placement 스키마 |
| `openapi.json` | API 명세 (코드를 바꾸면 `export_openapi` 로 다시 만듭니다) |

## 실행

[uv](https://docs.astral.sh/uv/) 가 필요합니다. 데이터와 학습 결과는 저장소에 없으므로 처음 한 번 준비합니다.

```bash
# 0) 팀 DB 형식 CSV 폴더 카드서비스_DB_1년_v2.1/ 을 저장소 루트에 둔다 (아래 '저장소에 없는 것')

# 1) 학습용 가상 데이터 (parquet, data/out_v2.1 에 생김)
cd data && uv sync && SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.main

# 2) 전체 분포와 업종 모델
cd ../solpay-ai && uv sync
export SOLPAY_DATA_DIR=../data/out_v2.1/parquet SOLPAY_ARTIFACTS=artifacts/v2.1
uv run python -m training.build_priors
uv run python -m training.train_category

# 3) 시험
uv run pytest

# 4) 서버 (DB 없이 CSV 만으로)
SOLPAY_STORE=teamdb SOLPAY_TEAM_DB_DIR=../카드서비스_DB_1년_v2.1 SOLPAY_ARTIFACTS=artifacts/v2.1 \
  uv run uvicorn engine.api:app --port 8001
```

- PostgreSQL 로 켜려면 `SOLPAY_STORE=db` 와 DB 주소(또는 루트 `.env` 의 `POSTGRES_*`)를 줍니다. 백엔드와 같은 DB 를 봐야 새로 가입한 사용자도 알아봅니다.
- `SOLPAY_ARTIFACTS` 는 서버를 켤 때 환경 변수로 줍니다 (`.env` 로는 정할 수 없습니다).
- 챗봇과 OpenAI 문구를 쓰려면 `solpay-ai/.env` 에 `OPENAI_API_KEY` 를 넣습니다 (`.env.example` 참고).
- 시험 화면은 `SOLPAY_DEV_TOOLS=on` 으로 켜고 http://127.0.0.1:8001/dev , API 문서는 `/docs`.
- 휴대폰 시연(`run_phone_demo.sh`)은 저장소 루트 README 를 봅니다.

주요 환경 변수 (전체 목록은 상세 기록 8장):

| 변수 | 뜻 |
|---|---|
| `SOLPAY_STORE` | `teamdb`(CSV) 또는 `db`(PostgreSQL). DB 주소가 있으면 `db` |
| `SOLPAY_DATABASE_URL` | DB 주소 |
| `SOLPAY_TEAM_DB_DIR` | 팀 DB 형식 CSV 폴더 (기본 `../카드서비스_DB_1년`) |
| `SOLPAY_ARTIFACTS` | 학습 결과 폴더 (v2.1 은 `artifacts/v2.1`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | OpenAI 키, 모델(기본 `gpt-6.1-terra`), 생각 단계(기본 `none`) |
| `SOLPAY_INTERNAL_TOKEN` | 넣으면 `X-Internal-Token` 헤더를 검사합니다. **안 넣으면 같은 컴퓨터(127.0.0.1)에서 온 요청만 받습니다** (배포에서는 꼭 넣습니다) |
| `SOLPAY_DEV_TOOLS` | `on` 이면 `/dev`, `/docs`·`/openapi.json`, 시연용 `/internal/dev/reset`·`/internal/payments` 를 엽니다. 기본은 꺼짐 |

## 저장소에 없는 것

깃에 올리지 않아 각자 만들거나 받아야 합니다.

| 무엇 | 어떻게 |
|---|---|
| `.env` (저장소 루트, `solpay-ai/`) | `.env.example` 을 복사해 값을 채웁니다. DB 비밀번호·OpenAI 키가 들어 있어 올리지 않습니다 |
| `카드서비스_DB_1년_v2.1/` | 팀에서 따로 받아 저장소 루트에 둡니다. `data` 에서 `SOLPAY_DATA_VERSION=v2.1` 로 `generate.main` → `generate.export_db` 를 돌려 다시 만들 수도 있습니다 |
| `solpay-ai/artifacts/v2.1/` | 위 '실행' 2) 로 만듭니다 |
