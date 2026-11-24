# 백엔드 ↔ AI 엔진 연동

백엔드(Spring)가 AI 엔진(`solpay-ai`, FastAPI)을 HTTP 로 부른다. 앱은 백엔드의 `/api/ai/...` 만 부른다.
코드는 `src/main/java/com/paymate/backend/ai/` 에 있다.

## 원칙

- **사용자 번호는 로그인 토큰에서만** 꺼낸다. 앱이 본문에 `user_id` 를 넣어 보내도 버린다.
- **응답은 AI 엔진의 JSON 그대로**다. 필드 이름이 `user_card_id` 처럼 밑줄 형식이고, 뜻은 `solpay-ai/openapi.json` 의 같은 이름 API 에 있다.
- **카드 배치는 멈추지 않는다.** AI 가 2초(`AI_RANK_TIMEOUT_MS`) 안에 답하지 못하면 내 카드 표시 순서대로 돌려준다 (`reason_code: "FALLBACK"`).
- **기준 시각은 서버 설정으로만** 정한다 (`AI_FIXED_AT`). 앱은 시각을 바꿀 수 없다.

## API

모두 로그인(Bearer 토큰)이 필요하다.

| 앱이 부르는 주소 | AI 엔진 API | 내용 |
|---|---|---|
| `POST /api/ai/rank` (`?explain=true`) | `POST /internal/rank` | 결제 화면 카드 순서와 안내 문구 |
| `POST /api/ai/payments/evaluate` | `POST /internal/payments/evaluate` | 가정 계산. 본문 `category_code`, `amount`, (`user_card_id`, `merchant_id`) |
| `GET /api/ai/me` | `GET /internal/users/{id}` | AI 가 아는 사용자인지 |
| `GET /api/ai/cards` | `GET /internal/users/{id}/cards` | 카드별 실적 현황 |
| `GET /api/ai/merchants` (`?zone=`) | `GET /internal/merchants` | 가맹점 목록 |
| `GET /api/ai/schedules/{day}` | `GET /internal/users/{id}/schedules/{day}` | AI 가 갖고 있는 그날 일정 |
| `POST /api/ai/schedules/{day}/sync` | `PUT /internal/users/{id}/schedules/{day}` | 그날 일정을 AI 에 다시 넘기기 |
| `POST /api/ai/schedule-popup` | `POST /internal/users/{id}/schedule-popup` | 일정 저장 뒤 팝업 |
| `POST /api/ai/recommendation-page` | `POST /internal/users/{id}/recommendation-page` | 맞춤 추천 페이지 |
| `POST /api/ai/card-recommendation` | `POST /internal/users/{id}/card-recommendation` | 신규 카드 추천 |
| `GET /api/ai/monthly-report` | `GET /internal/users/{id}/monthly-report` | 월간 리포트 |
| `GET /api/ai/missed-benefit` (`?days=`) | `GET /internal/users/{id}/missed-benefit` | 연말정산 놓친 혜택 |
| `GET /api/ai/strategy` | `GET /internal/users/{id}/strategy` | 실적 채우기 방식 |
| `POST /api/ai/strategy/initialize` | `POST /internal/users/{id}/strategy/initialize` | 방식 처음 고르기 |
| `POST /api/ai/chat` | `POST /internal/chat` | 챗봇. 본문 `message`, (`session_id`, `history[{role,text}]`, `screen{name,recommendation_id}`) |
| `GET /api/ai/rules` | `GET /internal/users/{id}/rules` | 규칙 조회 |
| `PUT /api/ai/rules` | `PUT /internal/users/{id}/rules` | 규칙 통째로 저장. 본문은 규칙 목록 |
| `POST /api/ai/rules/validate` | `POST /internal/rules/validate` | 규칙 검사. 본문 `{"rule": {...}}` |
| `POST /api/ai/rules/drafts/{draftId}/confirm` | 같은 경로 | 챗봇이 만든 규칙 초안 저장 |
| `POST /api/ai/rules/drafts/{draftId}/cancel` | 같은 경로 | 초안 버리기 |
| `GET /api/ai/health` | `GET /health` | AI 엔진이 켜져 있는지 |

붙이지 않은 것: 결제 기록 전달(`POST /internal/payments`). 백엔드에 결제 API 가 생기면 결제 저장 뒤에 부르면 된다.

## 일정은 자동으로 넘어간다

`/api/schedules` 로 일정을 등록·수정·삭제하면, 저장이 끝난 뒤 그 날짜의 일정을 통째로 AI 엔진에 넘긴다.

- 장소 일정만 넘긴다. 상황 일정(회식 등)은 업종을 알 수 없어 넘기지 않는다. 직접 입력(`OTHER`)은 이름을 AI 분류기에 물어 업종이 나오면 그 업종(·가맹점)으로 넘기고, 못 찾으면 넘기지 않는다.
- AI 엔진은 예상 금액이 필수인데 일정에는 금액이 없다. 과거 결제로 채운다: 내 그 업종 결제 중앙값 → 전체 사용자 중앙값 → 10,000원.
- 끝 시각 `24:00` 은 `23:59` 로 바꾼다. 하루 10개까지 넘긴다.
- 지난 날의 일정은 AI 엔진이 받지 않아 넘기지 않는다.
- 넘기다 실패해도 일정 저장은 성공이다 (경고 로그만 남긴다). 나중에 `POST /api/ai/schedules/{day}/sync` 로 맞춘다.
- `POST /api/ai/recommendation-page` 는 AI 를 부르기 전에 AI 의 오늘 일정과 서버 일정을 비교해 다르면 다시 넘긴다 (`ScheduleAiSync.ensureSynced`, 2026-11-23).
  AI 가 꺼져 있었거나 서버를 다시 켜는 중에 저장한 일정, 직접 입력을 넘기지 않던 옛 백엔드로 저장한 일정이 AI 에 없으면 AI 가 '오늘 일정 없음'으로 보고 평소 소비로 추천하기 때문이다.
  같으면 넘기지 않는다 (넘기면 AI 가 그날 추천을 새로 계산한다). 실패해도 추천은 그대로 부른다.

## 오류 응답

다른 API 와 같은 `{code, message}` 형식이다.

| 상황 | 상태 | code |
|---|---|---|
| AI 서버가 꺼져 있음 | 503 | `AI_UNAVAILABLE` |
| 제한 시간 초과 | 504 | `AI_TIMEOUT` |
| AI 가 대상을 못 찾음 (없는 사용자·초안) | 404 | `AI_NOT_FOUND` |
| AI 가 입력을 거절 (message 에 이유) | 400 | `AI_INVALID_REQUEST` |
| 이미 처리한 초안 등 | 409 | `AI_CONFLICT` |
| 그 밖의 AI 오류, 내부 토큰 불일치 | 502 | `AI_ERROR` |

카드 배치(`/api/ai/rank`)만은 어떤 실패에도 200 과 기본 순서를 돌려준다.

## 설정

`backend/.env` (또는 환경 변수). `.env.example` 참고.

| 변수 | 기본값 | 뜻 |
|---|---|---|
| `AI_BASE_URL` | `http://localhost:8001` | AI 엔진 주소 |
| `AI_INTERNAL_TOKEN` | 없음 | AI 엔진의 `SOLPAY_INTERNAL_TOKEN` 과 같은 값. 비우면 헤더를 보내지 않는다 |
| `AI_RANK_TIMEOUT_MS` | `2000` | 카드 배치 제한 시간 (공용 RDS 첫 계산 0.9~1.9초, 2026-11-24 예전 800) |
| `AI_TIMEOUT_MS` | `20000` | 나머지 호출 제한 시간 (챗봇은 최대 15초) |
| `AI_FIXED_AT` | 없음 | 시연용 기준 시각 (예: `2026-11-05T09:30:00`). 비우면 현재 시각 |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:8081,http://localhost:19006` | 웹에서 부를 수 있게 허용할 주소 |

**AI 엔진은 백엔드와 같은 DB 를 봐야 한다** (`SOLPAY_STORE=db`). CSV 로 켜면 백엔드에서 새로 가입한 사용자를 AI 가 몰라 404 가 난다.

## 로컬에서 함께 띄우기

로컬 도커 DB 의 복사본 `solpay_backend` 를 쓴다. 만드는 방법은 `local-db/backend_additions.sql` 맨 위에 있다.

```bash
# AI 엔진 (저장소 맨 위 .env 의 로컬 DB 계정으로 solpay_backend 에 붙는다)
cd solpay-ai
SOLPAY_STORE=db SOLPAY_DATABASE_URL= POSTGRES_DB=solpay_backend SOLPAY_INTERNAL_TOKEN=<backend/.env 의 AI_INTERNAL_TOKEN> uv run uvicorn engine.api:app --port 8031

# 백엔드
cd backend
SERVER_PORT=8090 sh gradlew bootRun
```

## 테스트

```bash
cd backend
sh gradlew test
```

`AiClientTest`(호출·오류 변환), `AiServiceTest`(사용자 번호·기준 시각·기본 순서), `ScheduleAiSyncTest`(일정 변환) 29개와 서버 기동 테스트 1개.
