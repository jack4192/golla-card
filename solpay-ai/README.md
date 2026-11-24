# SOL페이 AI 엔진 (solpay-ai)

SOL페이 결제 화면에서 **어느 카드를 먼저 보여 줄지** 정하고, 그 판단을 설명·추천·리포트로 풀어 주는 FastAPI 서버다.
카드 순서만 바꾸고 결제 확정은 고객이 한다. 앱은 Spring 만 호출하고, Spring 이 이 서버의 `/internal/*` API 를 부른다.

- 숫자(혜택·실적·구간·효과)는 모두 엔진이 계산한다. OpenAI 는 문장을 쓰거나 고르기만 하고, 쓴 문장은 검사를 통과해야 나간다.
- 가상 데이터의 카드 혜택과 소비는 임의 값이다. 평가 수치는 알고리즘 동작 검증이지 실제 절감액이 아니다.
- 실행·평가·API 의 자세한 기록과 결정 이력은 [docs/상세_기록.md](docs/상세_기록.md) 에 있다.

## 기능

| 기능 | 하는 일 | API |
|---|---|---|
| 결제 화면 카드 배치 | 지금 시각·소비 패턴·하루 일정·실적·행사를 보고 카드 1장을 맨 앞에 두고 안내 문구를 붙인다. 앱 홈 일정 카드는 `"record": false`(같은 계산, 추천 기록 없음)로 미리 본다 | `POST /internal/rank` |
| 하루 일정 | 오늘 어디서 얼마 쓸지 받아 그 시간에는 일정 업종으로 배치한다 (암호화 저장, 지난 날은 삭제) | `PUT·GET·DELETE /internal/users/{id}/schedules/{day}` |
| 일정 직접 입력 분류 | "스벅"·"헬스장" 같은 짧은 말을 업종·가맹점 브랜드로 (가맹점·별칭·업종 검색 먼저, 못 찾으면 OpenAI 가 목록 안에서 고름, 확신 낮으면 후보만). 일정 항목에 선택 칸 `brand`(브랜드 코드)를 저장한다. 입력 원문은 저장하지 않는다 | `POST /internal/places/classify` |
| 맞춤 추천 페이지 | 일정 저장 뒤 '카드사 추천'(아직 없는 신한카드)·'가맹점 추천'(행사) 탭. 문구는 OpenAI | `POST /internal/users/{id}/recommendation-page` |
| 일정 팝업·신규 카드 추천 | 3일마다 새 카드 추천, 그 외 날은 일정에 맞는 행사 추천 | `POST …/schedule-popup`, `POST …/card-recommendation` |
| 연말정산 놓친 혜택 | 지난 1년 결제를 다른 신한카드로 냈다면 더 받았을 금액 상위 3장 | `GET …/missed-benefit` |
| AI 챗봇 | "왜 이 카드야?", "이번 달 실적 얼마 남았어?", "주말엔 이 카드로 해 줘" 같은 질문과 앱 사용법·진행 중인 프로모션에 도구 9개로 답하고 규칙 초안을 만든다 | `POST /internal/chat` |
| 사용자 규칙 | 카드 고정·제외, 실적 채우기 방식, 실적 채우지 않기 등. 챗봇 초안 → 사용자 확인 → 저장 | `…/rules`, `/internal/rules/validate`, `/internal/rules/drafts/{id}/confirm·cancel` |
| 월간 리포트 | 카드별 이번 달·지난달 실적과 혜택, 배치 전략, 지난달 '추천대로 냈다면' 효과, 요약 문장 | `GET …/monthly-report` |
| 카드 현황·결제 평가 | 카드별 실적·남은 구간·한도, 결제 한 건을 카드마다 냈을 때의 혜택 | `GET …/cards`, `POST /internal/payments/evaluate` |
| 실적 채우기 방식 | 사용자·달마다 지난 결제로 방식(첫 구간 우선·주력 카드 우선·가치 최대·실적 안 채움)을 비교해 고른다 | `GET …/strategy`, `POST …/strategy/initialize` |
| 시험 화면 | 브라우저에서 위 기능을 눌러 볼 수 있는 개발용 화면 | `GET /dev`, `GET /docs` |

일정 직접 입력 분류 평가 (2026-11-23, `uv run python -m evaluation.place_eval`, 정답 69개: 브랜드 20·별칭/약칭 10·오타 10·일반 말 15·애매 5·함정 5('멜론 빙수'·'웨이브 펌'·'outback'·'flower'·'biscuit' — 브랜드를 붙이면 안 됨)·업종 이름 같은 말 4, 실제 OpenAI gpt-4o-mini): 업종 98.6%, 브랜드 100%, 틀린 브랜드 0건. 검색 35건(수 ms)·OpenAI 29건(중앙값 1.3초)·못 정함 5건. 규칙: 가맹점·브랜드·별칭이 글자 그대로 같을 때만 검색으로 확정(브랜드를 품기만 한 글은 후보 → OpenAI), 업종은 업종 이름과 같거나 후보가 모두 한 업종이고 가맹점 근거가 있을 때('카페'·'커피'·'주유소'), 여러 업종의 여러 브랜드면('GS') 후보만, OpenAI 브랜드는 글과 닮고 그 업종에 있는 브랜드일 때만. 남은 1건: '친구랑 저녁'은 확신이 낮아 음식점 후보로만 보여 줌. 주의: 이 세트는 규칙을 고칠 때도 썼으므로(따로 떼어 둔 세트가 아님) 처음 보는 표현의 정확도는 더 낮을 수 있다.

### 배치 알고리즘 (v4.2) 한눈에

1. **상황 파악**: 하루 일정이 있으면 일정, 없으면 시간대별 소비 패턴(LightGBM 업종 예측)으로 어디서 얼마 쓸지 확률을 만든다.
2. **사용자 규칙**: 고정·제외 규칙과, 일정 팝업에서 추천한 행사 카드를 먼저 적용한다.
3. **실적 채우기 방식**: 이번 달 방식을 정한다 (지난 결제로 비교한 월간 맞춤, 또는 사용자가 정한 방식).
4. **기본 카드**: 지난달 받던 구간 지키기 → 방식이 고른 카드 → 혜택률 1위 순서로 정한다.
5. **원화 점수**: 카드마다 즉시 혜택 + 프로모션 기대값을 원으로 계산한다.
6. **교체**: 다른 카드의 이득이 기본 카드의 실적 가치보다 클 때만 바꾼다. 단 이득이 500원 이상이면 실적 가치를 넘지 않아도 바꾼다(`Params.big_gain_swap`, 2026-11-23, 재생 1.316% → 1.324%·손해 6 → 7명). 항상 1장과 안내 문구를 준다.

### 행사(카드사 이벤트·마이샵) 목록

- 원본은 DB `promotions` 표 하나다 (2026-11-23). 앱 혜택 탭(백엔드 `/api/promotions`)과 챗봇·추천·카드 배치가 같은 표를 읽는다.
- 점수 기간은 `start_date`~`end_date`(1년치 가상 결제용으로 대부분 2025-11-01 부터), '지금 진행 중'(맞춤 추천·일정 팝업·챗봇 목록)과 화면 기간은 `display_start`~`display_end`(실제 행사 기간).
- `needs_check`(응모·선착순 조건) 행사는 점수와 챗봇 목록에서 뺀다. 응답에는 화면 이름(`display_name`)과 로고(`logo_url`)를 싣는다.
- 화면용 칸이 없는 데이터(마이그레이션 전 DB, v2 폴더 등)는 `data/config/promotions.yml` 에서 같은 번호의 확인 필요·실제 기간·화면 이름을 채운다.
  칸 값의 원본도 그 yml 이고, `data` 에서 `uv run python -m generate.promotions --sql` 로 DB 마이그레이션 SQL 을 만든다.

### OpenAI 를 쓰는 곳과 안전장치

| 쓰는 곳 | OpenAI 가 하는 일 | 안전장치 |
|---|---|---|
| 챗봇 | 질문 이해, 도구 호출, 답변 문장 | 숫자는 도구 결과만 (숫자 검사기), 개인정보 가리기, 저장은 사용자 확인 뒤, 시간 초과·검사 실패면 예비 답변 |
| 맞춤 추천 페이지 | 카드·가맹점 추천 문구 | 엔진이 정한 금액·줄을 그대로 썼는지 검사, 한 번 다시 쓰기, 실패하면 정해진 문구 |
| 월간 리포트 | 제목 한 줄 + 엔진이 쓴 후보 문장 중 1~2개 고르기 | 제목의 숫자는 지난달 합계만, 요점·효과·전략 문장은 엔진이 쓴다 |

OpenAI 에는 카드 상품명·업종·금액만 보내고 사용자 번호·이름·가맹점 원문·일정 원문은 보내지 않는다. 키가 없어도 모든 API 는 정해진 문구로 동작한다.

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| `engine/` | 배치 엔진과 API (배포 대상) |
| `engine/chat/` | 챗봇과 OpenAI 문구 작성·검사 |
| `training/` | 전체 분포·LightGBM 모델 학습 (학습할 때만 실행) |
| `evaluation/` | 1년 재생 평가, OpenAI 문구 평가 (평가할 때만 실행) |
| `scripts/` | 로컬 DB 준비, API 명세 내보내기 |
| `sql/` | 엔진이 쓰는 표 |
| `tests/` | 자동 테스트 (483개) |
| `postman/` | API 시나리오 모음 |
| `docs/` | 상세 기록 |
| `artifacts/` | 학습 결과·평가 결과 (깃 제외, 각자 만든다) |

## 파일별 설명

### `engine/` — 배치 엔진

| 파일 | 하는 일 |
|---|---|
| `api.py` | FastAPI 앱. 내부 API(경로 21개), 입력 검사, 오류 응답 |
| `service.py` | 진입점. 저장소에서 사용자 상태를 만들어 배치·추천·리포트를 조립한다 |
| `ranker.py` | 기본 카드 고르기, 카드별 원화 점수, 교체 판단 (알고리즘 4~6단계) |
| `scenarios.py` | 지금 어디서 얼마 결제할지를 확률로 만든다 (일정 → 반복 구간 → 시간대) |
| `category_model.py` | 업종 예측 LightGBM 을 불러 확률을 낸다 |
| `priors.py` | 전체 사용자 분포. 개인 이력이 적을 때 섞어 쓴다 |
| `slots.py` | 평일/주말 × 시간대 구간 |
| `rules.py` | 사용자 규칙 형식 검사와 적용 (고정·제외·선호·방식·실적 안 채움) |
| `strategy.py` | 실적 채우기 방식을 지난 결제로 비교해 고른다 (월간 맞춤, 손해 방지) |
| `strategy_store.py` | 시연용 방식 저장소 (SQLite) |
| `perf_value.py` | 실적 기여 가치: 이번 결제가 다음 달 구간 달성에 주는 가치를 원으로 계산 |
| `spend_model.py` | 월말까지 남은 소비 예측 (LightGBM 분위수 회귀, 기본은 끔) |
| `ml.py` | 학습 모델 모음. 모델 파일이 없으면 규칙으로 동작한다 |
| `benefit_calc.py` | 카드 혜택 계산 (할인·적립, 실적 구간, 한도) |
| `catalog.py` | 카드·가맹점 기준 정보 |
| `state.py` | 사용자 한 명의 상태. 결제를 시간순으로 넣으면 실적·한도·패턴이 쌓인다 |
| `messages.py` | 안내 문구와 이유 코드 (`reason_code`). 금액은 엔진 계산값만 넣는다 |
| `example.py` | 결제 화면 '이 거래의 예상 혜택'에 보일 예시 거래 (배치 응답 `example`, 1순위 카드 문구가 가리키는 거래) |
| `params.py` | 알고리즘 기준값을 모아 둔 곳 |
| `domain.py` | 엔진이 주고받는 값 (결제·카드·행사·일정·배치 결과) |
| `popup.py` | 하루 일정 팝업: 일정에 맞는 행사 추천 |
| `recommend.py` | 신규 카드 추천, 연말정산 놓친 혜택 계산 |
| `page.py` | 맞춤 추천 페이지: 카드 탭·가맹점 탭에 넣을 것을 고른다 |
| `report.py` | 월간 리포트: 카드별 숫자, 지난달 효과 다시 계산, 프로모션 계산 |
| `store.py` | 저장소 인터페이스와 메모리 저장소 |
| `team_db.py` | 팀 DB 형식(CSV 23개 표)을 엔진 값으로 바꾼다 |
| `db_store.py` | PostgreSQL 저장소 (팀 표 읽기 + `app` 스키마 쓰기) |
| `pg_store.py` | 예전 `placement` 스키마 저장소 |
| `loader.py` | 가상 데이터(parquet)·행사 목록(yml, 화면용 칸이 없을 때 대신) 읽기 |
| `crypto.py` | 하루 일정 암호화 (봉투 암호화) |
| `privacy.py` | OpenAI 로 보내기 전 개인정보 가리기, 보내도 되는 항목만 남기기 |
| `jobs.py` | 하루 한 번 작업 (지난 일정 삭제) |
| `settings.py` | `.env` 읽기 |
| `static/dev_console.html` | 개발용 시험 화면 (`/dev`) |

### `engine/chat/` — 챗봇과 문구

| 파일 | 하는 일 |
|---|---|
| `agent.py` | 챗봇 본체: OpenAI 함수 호출, 도구 반복, 시간 제한, 답변 검사, 예비 답변 |
| `tools.py` | 도구 9개의 정의와 실행: 추천 이유 설명, 가정 계산, 카드 현황, 카드 혜택, 규칙 초안, 신규 카드 추천, 결제 추천, 프로모션 목록, 가맹점 찾기 |
| `prompts.py` | 시스템 프롬프트와 요청마다 바뀌는 문맥 |
| `guard.py` | 답변 검사: 도구 결과에 없는 숫자, 금지 표현 |
| `search.py` | 카드·가맹점·업종 이름 검색 (LLM 은 이름으로 말하고 서버가 번호로 바꾼다) |
| `new_card.py` | 최근 결제를 미보유 신한카드 한 장으로 다시 계산하는 맞춤 카드 추천 |
| `page_copy.py` | 맞춤 추천 페이지 문구 작성과 검사 |
| `report_copy.py` | 월간 리포트 문장: 엔진 효과·전략 문장, 요점 후보 문장, 제목 검사 |

### `training/` — 학습

| 파일 | 하는 일 |
|---|---|
| `build_priors.py` | 전체 사용자 분포(`priors.json`)를 만든다. 서버 실행에 필요하다 |
| `train_category.py` | 업종 예측 LightGBM 학습 (기본으로 쓴다) |
| `train_spend.py` | 남은 소비 예측 모델 학습 |
| `train_strategy.py` | 방식 선택 모델 학습 |
| `tune.py` | 기준값 후보 비교 (설정은 바꾸지 않는다) |

### `evaluation/` — 평가

| 파일 | 하는 일 |
|---|---|
| `replay.py` | 1년 결제를 시간순으로 다시 흘려 '습관대로' 대비 엔진의 혜택률을 잰다 |
| `oracle.py` | 결제를 모두 미리 안다고 할 때의 최대 혜택 (상한) |
| `demo_report.py` | 시연 사용자 한 명의 결과 표와 결제별 CSV |
| `chat_eval.py` | 챗봇 질문 50개를 실제 OpenAI 로 채점 |
| `page_eval.py` | 맞춤 추천 페이지 문구를 실제 OpenAI 로 확인 |
| `report_eval.py` | 월간 리포트 문구를 실제 OpenAI 로 확인 |

### 그 밖

| 파일 | 하는 일 |
|---|---|
| `scripts/setup_local_db.py` | 로컬 PostgreSQL 에 팀 표와 `app` 스키마를 준비한다 |
| `scripts/export_openapi.py` | Spring 에 넘길 API 명세 `openapi.json` 을 만든다 |
| `scripts/load_demo_to_postgres.py` | 가상 데이터를 예전 `placement` 스키마에 넣는다 |
| `sql/002_app.sql` | 엔진이 쓰는 표: 규칙, 규칙 초안, 방식 선택, 추천 기록, 일정, 카드 추천 기록, 시연 결제 |
| `sql/001_placement.sql` | 예전 `placement` 스키마 |
| `openapi.json` | API 명세 (코드를 바꾸면 `export_openapi` 로 다시 만든다) |
| `postman/` | Postman 시나리오와 로컬 환경 |
| `tests/` | 엔진·API·챗봇·리포트·DB 저장소 테스트 |

## 실행

[uv](https://docs.astral.sh/uv/) 가 필요하다. 저장소에는 데이터와 학습 결과가 들어 있지 않으므로 처음 한 번 만든다.

```bash
# 0) 팀 DB 형식 CSV 폴더 `카드서비스_DB_1년/` 을 저장소 루트에 둔다 (깃에 없다. 아래 '저장소에 없는 것' 참고)

# 1) 가상 데이터 (학습용 parquet, data/out 에 생긴다)
cd data && uv sync && uv run python -m generate.main

# 2) 엔진 준비: 전체 분포와 업종 모델
cd ../solpay-ai && uv sync
uv run python -m training.build_priors
uv run python -m training.train_category

# 3) 테스트
uv run pytest

# 4) 서버 (DB 없이 CSV 만으로)
SOLPAY_STORE=teamdb uv run uvicorn engine.api:app --port 8001
```

- 시험 화면: http://127.0.0.1:8001/dev , API 문서: http://127.0.0.1:8001/docs
- 챗봇과 OpenAI 문구를 쓰려면 `solpay-ai/.env` 에 `OPENAI_API_KEY` 를 넣는다 (`.env.example` 참고). 없으면 정해진 문구로 동작한다.
- PostgreSQL 로 실행하는 방법과 결제 데모(`demo/`, `./run_demo.sh`)는 상세 기록과 저장소 루트 README 를 본다.

주요 환경 변수:

| 변수 | 뜻 |
|---|---|
| `SOLPAY_STORE` | `teamdb`(CSV) 또는 `db`(PostgreSQL). DB 주소가 있으면 `db` |
| `SOLPAY_DATABASE_URL` | DB 주소 |
| `SOLPAY_TEAM_DB_DIR` | 팀 DB 형식 CSV 폴더 (기본 `../카드서비스_DB_1년`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | OpenAI 키와 모델 (기본 `gpt-4o-mini`) |
| `SOLPAY_INTERNAL_TOKEN` | 넣으면 `X-Internal-Token` 헤더를 검사한다. **안 넣으면 같은 컴퓨터(127.0.0.1)에서 온 요청만 받는다** (배포에서는 꼭 넣는다, 2026-11-24) |
| `SOLPAY_DEV_TOOLS` | `on` 이면 개발 화면 `/dev`, API 명세 `/docs`·`/openapi.json`, 시연용 `/internal/dev/reset`·`/internal/payments` 를 연다. 기본은 꺼짐 (2026-11-24) |

## 평가 결과 (가상 데이터, 365명 1년)

| 항목 | 결과 |
|---|---|
| 결제 화면 배치 (1년 재생 189,250건) | 혜택률 습관 0.824% → 엔진 1.316%, 덜 받는 사용자 6명 |
| 챗봇 58문항 (실제 OpenAI, 앱 사용법·프로모션 8문항 포함) | 58/58, 응답 시간 중앙값 2.6초 |
| 맞춤 추천 페이지 문구 | 10/10 통과 |
| 월간 리포트 문구 | 11/11 통과, 중앙값 1.2초 |
| 자동 테스트 | 483개 통과 |

## 저장소에 없는 것

깃에 올리지 않아 각자 만들거나 받아야 한다.

| 무엇 | 어떻게 |
|---|---|
| `.env` (저장소 루트, `solpay-ai/`) | `.env.example` 을 복사해 값을 채운다. DB 비밀번호·OpenAI 키가 들어 있어 올리지 않는다 |
| `카드서비스_DB_1년/` (102MB) | 팀에서 압축 파일로 따로 받아 저장소 루트에 푼다. 원본 `카드서비스_DB/` 폴더가 있으면 `data` 에서 `generate.main` → `generate.export_db` 로 다시 만들 수 있다 |
| `solpay-ai/artifacts/` | `training.build_priors`, `training.train_category` 로 만든다 |
