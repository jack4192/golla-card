# SOL페이 스마트 카드 배치 에이전트 (PayMate)

결제 화면의 카드 순서를 AI 가 정하고, 결제 확정은 고객이 하는 SOL페이 기능이다. 신한 교육과정 금융 AI 에이전트 경진대회용 저장소다.

이 브랜치(`final`)는 앱·백엔드·AI 를 한곳에 모은 것이다. 카드 이름과 혜택, 결제 내역은 모두 가상 데이터이고 실제 카드·결제망과 연결되지 않는다.

## 전체 구조

```
앱 (frontend/, Expo·React Native, 웹 8081)
   │  /api/...  (JWT)
   ▼
백엔드 (backend/, Spring Boot, 8080)  ── 회원·카드·일정, DB 저장
   │  /internal/...  (X-Internal-Token)
   ▼
AI 엔진 (solpay-ai/, FastAPI, 8001)  ── 카드 배치, 추천, 챗봇, 리포트
   │
   ▼
PostgreSQL (5432)
```

앱은 백엔드만 부르고, 백엔드가 AI 엔진을 부른다. AI 엔진이 늦거나 꺼져 있어도 결제는 기본 카드 순서로 진행되어야 한다.

## 폴더 구성

| 폴더 | 내용 | 자세한 설명 |
|---|---|---|
| `frontend/` | 앱. 회원가입, 이메일 로그인, 오늘의 일정, 추천, 카드 지갑, 결제 화면 | [frontend/README.md](frontend/README.md) |
| `backend/` | Spring Boot 서버. 회원·로그인(JWT), 카드, 카드 상품, 일정 API | 아래 '2. 백엔드' 참고 |
| `solpay-ai/` | AI 엔진. 결제 화면 카드 배치, 맞춤 추천, 챗봇, 월간 리포트, 연말정산 | [solpay-ai/README.md](solpay-ai/README.md) |
| `data/` | 가상 소비 데이터 생성기. AI 엔진이 `data/config` 를 읽는다 | [data/README.md](data/README.md) |
| `demo/` | AI 엔진만 붙인 결제 데모(일회용 코드, 가상 POS). Spring 역할을 대신한다 | [demo/README.md](demo/README.md) |
| `db/`, `docker-compose.yml` | 로컬 PostgreSQL(PostGIS)과 DB 스크립트 | 아래 '로컬 DB' 참고 |
| `docs/` | AI 설계 문서와 구현 계획 | `docs/superpowers/` |

## 지금 연결 상태

파일은 한곳에 모였지만 세 부분이 모두 이어진 것은 아니다.

| 구간 | 상태 |
|---|---|
| 앱 → 백엔드 | 회원가입, 로그인, 로그아웃, 이메일·휴대폰 중복 확인, 내 정보 6개가 연결되어 있다. 서버 주소(`EXPO_PUBLIC_API_URL`)를 넣었을 때만 서버를 부르고, 없으면 앱 안의 데이터로 동작한다 |
| 앱 → 백엔드 (카드·일정) | 연결되어 있다. 서버 모드에서는 지갑과 일정을 서버에서 읽고, 카드 등록·순서 변경·일정 저장·삭제를 서버에 반영한다(`/api/cards`, `/api/schedules`). 카드 탭 상품 목록·상세도 서버(`/api/card-products`)에서 읽고, 카드 이미지 40장은 백엔드가 로그인 없이 준다(`/card-images/{카드번호}.webp`). 혜택 탭·홈 미리보기·오늘의 프로모션의 행사 29건도 서버(`/api/promotions`, DB `promotions` 표)에서 읽고 로고 28장은 `/brand-logos/` 로 받는다. 데모 모드에는 행사가 없다 |
| 백엔드 → AI 엔진 | 연결되어 있다. 백엔드의 `/api/ai/...` 가 AI 엔진을 부르고, 일정을 저장하면 AI 엔진에도 넘어간다. 결제 기록 전달만 빠져 있다(백엔드에 결제 API 가 없다). [backend/docs/AI_연동.md](backend/docs/AI_연동.md) |
| 앱 → 백엔드 (AI 기능) | 전체 결제 화면('혜택 자세히 보기')이 카드 순서(`/api/ai/rank`)·예상 혜택(`/api/ai/payments/evaluate`)·챗봇을, 홈 챗봇(SOL 카드 도우미)이 AI 챗봇(`/api/ai/chat`)을 부른다. 일정 맞춤 추천과 가입 직후 일과 맞춤 카드 추천은 AI 맞춤 추천(`/api/ai/recommendation-page`)을, 홈 '오늘의 일정'의 일정별 카드는 AI 계산을 쓴다. 앱에서 넣은 장소 일정이 AI 배치에 반영된다. AI 가 답하지 못하거나 데모 모드면 앱 자체 계산으로 보여 준다. QR 결제 시트, 월간 리포트·연말정산 화면, 일정 직접 입력 분류(가게 이름 → 업종·가맹점)는 아직 AI 에 붙지 않았다. 분류는 AI 엔진 API 와 결제 데모(`demo/`)에만 있다. [frontend/docs/AI_연동.md](frontend/docs/AI_연동.md) |
| 웹 브라우저 → 백엔드 | CORS 설정이 있어 웹(8081)에서도 부를 수 있다. 허용 주소는 `CORS_ALLOWED_ORIGINS` 로 바꾼다 |

AI 연결에서 알아둘 것:

- 앱이 부를 주소와 AI 엔진 API 의 대응은 [backend/docs/AI_연동.md](backend/docs/AI_연동.md) 에 있다. 응답은 AI 엔진의 JSON 그대로다.
- API 계약은 [solpay-ai/openapi.json](solpay-ai/openapi.json) 이고, 서버를 켜면 http://127.0.0.1:8001/docs 에서도 볼 수 있다.
- 주요 API: 카드 배치 `POST /internal/rank`, 결제 기록 `POST /internal/payments`, 하루 일정 `PUT /internal/users/{id}/schedules/{day}`(항목에 선택 칸 `brand`), 일정 직접 입력 분류 `POST /internal/places/classify`, 맞춤 추천 `POST /internal/users/{id}/recommendation-page`, 챗봇 `POST /internal/chat`, 월간 리포트 `GET /internal/users/{id}/monthly-report`, 연말정산 `GET /internal/users/{id}/missed-benefit`, 규칙 `GET·PUT /internal/users/{id}/rules`.
- 등록한 카드가 없는 사용자는 카드 배치가 오류 없이 빈 목록으로 온다 (`cards=[]`, `reason_code="NO_CARD"`, `recommendation_id=null`).
- AI 엔진이 0.8초 안에 답하지 못하면 백엔드가 내 카드 순서대로 돌려준다 (`reason_code="FALLBACK"`).
- AI 엔진은 백엔드와 같은 DB 를 봐야 한다 (`SOLPAY_STORE=db`). CSV 로 켜면 새로 가입한 사용자를 몰라 404 가 난다.

## 실행

켜는 순서는 AI 엔진 → 백엔드 → 앱이다. 지금은 서로 이어지지 않은 구간이 있어 하나씩 따로 켜도 된다.

### 필요한 프로그램

| 프로그램 | 쓰는 곳 |
|---|---|
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | AI 엔진, 데이터 생성기, 결제 데모 (Python 은 uv 가 설치한다) |
| Java 21 (JDK) | 백엔드 |
| Node.js 24 | 앱 |
| Docker | 로컬 DB 를 쓸 때만 |

### 1. AI 엔진 (8001)

저장소에는 데이터와 학습 결과가 없어 처음 한 번 만든다. 팀에서 받은 `카드서비스_DB_1년/` 폴더를 저장소 맨 위에 먼저 둔다.

```bash
cd data && uv sync && uv run python -m generate.main
cd ../solpay-ai && uv sync
uv run python -m training.build_priors
uv run python -m training.train_category
SOLPAY_STORE=teamdb uv run uvicorn engine.api:app --port 8001
```

시험 화면은 http://127.0.0.1:8001/dev 이다. 챗봇과 OpenAI 문구를 쓰려면 `solpay-ai/.env` 에 `OPENAI_API_KEY` 를 넣는다. 없으면 정해진 문구로 동작한다. 테스트는 `solpay-ai` 폴더에서 `uv run pytest` 로 돌린다.

### 2. 백엔드 (8080)

아래 4개가 있어야 뜬다. `backend/.env.example` 을 `backend/.env` 로 복사해 채우면 서버가 뜰 때 읽는다 (환경 변수로 넣어도 된다). 값은 팀에서 따로 받는다.

| 변수 | 뜻 |
|---|---|
| `DB_URL` | DB 주소 (`jdbc:postgresql://주소:5432/DB이름`) |
| `DB_USERNAME`, `DB_PASSWORD` | DB 계정 |
| `JWT_SECRET` | 로그인 토큰 서명용 비밀키 |

AI 엔진 주소(`AI_BASE_URL`, 기본 `http://localhost:8001`)와 내부 토큰(`AI_INTERNAL_TOKEN`) 등은 [backend/docs/AI_연동.md](backend/docs/AI_연동.md) 의 '설정' 에 있다.

```bash
cd backend
sh gradlew bootRun
```

- `Started PaymateBackendApplication` 이 보이면 http://localhost:8080 에서 받는다. Windows 는 `gradlew.bat bootRun` 을 쓴다.
- 저장소의 `gradlew` 에 실행 권한이 없어 Mac·Linux 에서는 `./gradlew` 가 거절된다. 위처럼 `sh gradlew` 로 부른다.
- 테이블이 이미 있는 DB 여야 한다 (`ddl-auto: validate`). 표가 없는 빈 DB 로는 뜨지 않는다.
- IntelliJ 로 열 때는 저장소 전체가 아니라 `backend/` 폴더를 연다.

### 3. 앱 (8081)

```bash
cd frontend
npm ci
npx expo start --go
```

- 이대로 켜면 서버 없이 앱 안의 데이터로 동작한다. 휴대폰은 Expo Go 로 QR 코드를 찍고, 웹은 http://localhost:8081 을 연다.
- 백엔드에 붙이려면 서버 주소를 넣고 켠다. 휴대폰에서 볼 때는 `localhost` 대신 PC 의 IP 를 쓴다.

```bash
EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --go --clear
```

- Windows 는 `.\scripts\start-with-backend.ps1` 이 같은 일을 한다. 테스트 계정과 웹 배포 방법은 [frontend/README.md](frontend/README.md) 와 [frontend/docs/새_노트북_설정.md](frontend/docs/새_노트북_설정.md) 에 있다.

### 결제 데모만 써 보기

앱과 백엔드 없이 AI 엔진의 카드 배치를 바로 볼 수 있다. 저장소 맨 위에서 실행하면 가상 데이터 생성(처음 한 번, 1분 안팎), AI 엔진, 데모 서버가 함께 켜진다.

```bash
./run_demo.sh
```

결제 화면은 http://localhost:8000/pay, 가상 POS 는 http://localhost:8000/pos 이다. 시연 순서는 [demo/README.md](demo/README.md) 에 있다.

### 로컬 DB

저장소 맨 위의 `.env.example` 을 `.env` 로 복사해 `POSTGRES_PASSWORD` 를 채운 뒤 켠다.

```bash
docker compose up -d db
```

PostGIS 확장만 들어 있는 빈 DB 가 5432 포트에 뜬다. 표와 데이터를 넣는 방법은 [solpay-ai/docs/상세_기록.md](solpay-ai/docs/상세_기록.md) 에 있다.

## 포트

| 포트 | 무엇 |
|---|---|
| 5432 | PostgreSQL |
| 8000 | 결제 데모 (`demo/`) |
| 8001 | AI 엔진 (`solpay-ai/`) |
| 8080 | 백엔드 (`backend/`) |
| 8081 | 앱 웹 화면 (`frontend/`) |

## 저장소에 없는 것

비밀값이거나 크기가 커서 깃에 올리지 않는다. 각자 만들거나 팀에서 따로 받는다.

| 무엇 | 어떻게 |
|---|---|
| `.env` 파일들 | `.env.example` 을 복사해 채우거나 팀에서 값을 받는다. DB 비밀번호, JWT 비밀키, OpenAI 키가 들어 있다 |
| `카드서비스_DB_1년/` (102MB) | 팀에서 압축 파일로 받아 저장소 맨 위에 푼다 |
| `data/out/` | `data` 폴더에서 `uv run python -m generate.main` |
| `solpay-ai/artifacts/` | `solpay-ai` 폴더에서 `training.build_priors`, `training.train_category` |
| `frontend/node_modules/`, `backend/build/` | `npm ci`, `gradlew bootRun` 이 만든다 |

## 브랜치

| 브랜치 | 내용 |
|---|---|
| `final` | 통합본. 이 README 가 있는 곳 |
| `ai` | AI 엔진과 데이터 (`final` 의 맨 위 폴더들) |
| `back` | 백엔드 (`final` 의 `backend/`) |
| `front` | 앱 (`final` 의 `frontend/`) |

`back`, `front` 는 파일을 저장소 맨 위에 두고 있어 `final` 에는 폴더로 넣었다. 두 브랜치에 새로 올라온 내용은 아래처럼 가져온다. 작업 폴더에 커밋하지 않은 변경이 없어야 한다.

```bash
git fetch origin
git merge origin/ai
git subtree pull --prefix=backend origin back
git subtree pull --prefix=frontend origin front
```
