# Pay·Mate

결제할 때마다 "지금 어떤 카드를 내야 혜택이 가장 클까"를 앱이 대신 골라 주는 카드 추천 서비스입니다.
결제 화면을 열면 AI가 보유 카드 중 지금 가장 유리한 카드를 맨 앞에 두고, 결제는 고객이 직접 확정합니다.
신한 커리어넥스트 과정 금융 AI 경진대회 프로젝트입니다.

> 카드 혜택과 결제 내역은 모두 가상 데이터입니다. 실제 카드사·결제망과는 연결되어 있지 않습니다.

## 배포 주소

| 무엇 | 주소 |
|---|---|
| 웹앱 (아이폰 사파리에서 '홈 화면에 추가'하면 앱처럼 열림) | https://main.d2u8rbbfuwjf2g.amplifyapp.com |
| 백엔드 API | https://paymate.duckdns.org |
| 가상 POS (가맹점 단말 역할) | https://paymate.duckdns.org/pos |

## 주요 기능

| 기능 | 설명 |
|---|---|
| 결제 카드 자동 배치 | 시각, 소비 패턴, 하루 일정, 전월 실적, 진행 중인 행사를 따져 결제 화면 맨 앞 카드를 정합니다. AI 서버가 늦으면 내가 정한 카드 순서로 그대로 결제할 수 있습니다 |
| 하루 일정 | 오늘 갈 곳과 시간을 넣으면 그 시간대에 맞는 카드로 바뀝니다. 홈의 하루 시간 표시줄에서 카드가 바뀌는 시각을 볼 수 있습니다 |
| 일정 장소 분류 | "스벅", "헬스장"처럼 짧게 써도 업종과 브랜드로 알아듣습니다 |
| 맞춤 추천 | 일정을 저장하면 받을 수 있는 행사와, 아직 없는 신한카드 중 1년 소비 기준으로 이득이 큰 카드를 보여 줍니다 |
| AI 챗봇 | "왜 이 카드야?", "이번 달 실적 얼마 남았어?", "주말엔 이 카드 먼저 써 줘" 같은 질문에 답하고, 규칙과 일정 초안을 만들어 줍니다 |
| 이용 내역·연말 결산 | 최근 이용 내역과 카드 이용 내역, 연말 결산(올해 받은 혜택과 다른 신한카드였다면 더 받았을 혜택) |
| 아침 알림 | 매일 아침 7시에 그날 일정을 물어보는 웹 푸시 알림 |
| 가상 POS 결제 | 앱의 결제 QR·바코드를 가상 POS로 찍으면 승인되고, 받은 혜택이 내역에 쌓입니다 |

## 시스템 구성

```
앱 (Expo · React Native)
  웹: AWS Amplify / 휴대폰: Expo Go
        │  HTTPS, JWT
        ▼
Caddy (HTTPS 인증서)  ──  EC2 (Ubuntu 24.04, t3.small), Docker Compose
        │
        ▼
백엔드 (Spring Boot, 8080)  ── 회원, 카드, 일정, 결제, 알림
        │  내부 토큰 (서버 안에서만 호출)
        ▼
AI 서버 (FastAPI, 8001)  ── 카드 배치, 추천, 챗봇, 리포트
        │                    └─ OpenAI API (문장 작성·도구 호출)
        ▼
PostgreSQL (AWS RDS)
```

- 앱은 백엔드만 부르고, AI 서버는 백엔드만 부릅니다. AI 서버 포트는 밖으로 열지 않았습니다.
- 혜택·실적 같은 숫자는 모두 규칙 엔진이 계산합니다. OpenAI는 문장을 쓰고 도구를 고르는 일만 하고, 답에 나온 숫자가 계산 결과와 맞는지 한 번 더 검사합니다.
- 업종 예측(지금 어떤 업종에서 결제할지)에는 LightGBM 모델을 씁니다.

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 앱 | Expo SDK 58, React Native 0.88, react-native-web |
| 백엔드 | Java 21, Spring Boot 4, Spring Security(JWT), JPA, Web Push |
| AI 서버 | Python 3.13, FastAPI, LightGBM, OpenAI API (함수 호출) |
| DB | PostgreSQL (로컬은 Docker, 배포는 AWS RDS) |
| 배포 | AWS EC2, RDS, Amplify, Docker Compose, Caddy |

## 폴더 구성

| 폴더 | 내용 |
|---|---|
| [`frontend/`](frontend/README.md) | 앱 (로그인, 일정 관리, 홈, 혜택, 결제, 카드 화면) |
| [`backend/`](backend/README.md) | Spring Boot 백엔드 |
| [`solpay-ai/`](solpay-ai/README.md) | AI 서버 (카드 배치 엔진, 추천, 챗봇, 평가 코드) |
| [`data/`](data/README.md) | 가상 사용자·결제 데이터 생성기와 카드·행사 설정 |
| [`demo/`](demo/README.md) | 휴대폰 시연용 가상 POS (로컬 실행용) |
| `db/` | DB 스키마와 RDS 적재 스크립트 |
| `docs/설계/` | 기능별 설계 문서 (배치 알고리즘, 추천, 리포트, 챗봇 등) |
| `run_phone_demo.sh` | 휴대폰 시연에 필요한 서버를 한 번에 켜는 스크립트 |

## 로컬에서 실행하기

켜는 순서는 DB → AI 서버 → 백엔드 → 앱입니다.

### 필요한 프로그램

| 프로그램 | 쓰는 곳 |
|---|---|
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | AI 서버, 데이터 생성기, 가상 POS |
| Java 21 | 백엔드 |
| Node.js 24 | 앱 |
| Docker | 로컬 DB |

### 1. DB

저장소 맨 위의 `.env.example` 을 `.env` 로 복사해 `POSTGRES_PASSWORD` 를 채우고 켭니다.

```bash
docker compose up -d db
```

팀에서 받은 `카드서비스_DB_1년_v2.1/` 폴더(가상 사용자 1,005명, 배포 서버와 같은 데이터)를 저장소 맨 위에 두고 표와 데이터를 넣습니다.

```bash
cd solpay-ai && uv sync
uv run python -m scripts.setup_local_db --team-dir ../카드서비스_DB_1년_v2.1   # DB 이름은 루트 .env 의 POSTGRES_DB
```

백엔드가 쓰는 추가 표는 `backend/local-db/` 의 SQL 로 맞춥니다. 자세한 내용은 [solpay-ai/docs/상세_기록.md](solpay-ai/docs/상세_기록.md) 9장에 있습니다.

### 2. AI 서버 (8001)

학습 결과는 저장소에 없어서 처음 한 번 만듭니다.

```bash
cd data && uv sync && SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.main
cd ../solpay-ai && uv sync
export SOLPAY_DATA_DIR=../data/out_v2.1/parquet SOLPAY_ARTIFACTS=artifacts/v2.1
uv run python -m training.build_priors
uv run python -m training.train_category
SOLPAY_STORE=db uv run uvicorn engine.api:app --port 8001
```

- 백엔드와 같은 DB를 봐야 새로 가입한 사용자도 알아봅니다 (`SOLPAY_STORE=db`).
- 챗봇과 추천 문구를 쓰려면 `solpay-ai/.env` 에 `OPENAI_API_KEY` 를 넣습니다. 키가 없으면 정해진 문구로 동작합니다.

### 3. 백엔드 (8080)

`backend/.env.example` 을 `backend/.env` 로 복사해 채운 뒤 켭니다. 자세한 설정은 [backend/README.md](backend/README.md) 에 있습니다.

```bash
cd backend
sh gradlew bootRun
```

### 4. 앱 (8081)

```bash
cd frontend
npm ci
EXPO_PUBLIC_API_URL=http://localhost:8080 npx expo start --go
```

- 휴대폰은 Expo Go로 QR 코드를 찍고, 웹은 http://localhost:8081 을 엽니다. 휴대폰에서는 `localhost` 대신 PC의 IP를 씁니다.
- `EXPO_PUBLIC_API_URL` 없이 켜면 서버 없이 앱 안의 예시 데이터로 동작합니다.

### 휴대폰 시연 한 번에 켜기

DB, AI 서버, 백엔드, 가상 POS, 앱 서버를 순서대로 켜고 휴대폰용 QR 코드를 띄웁니다.

```bash
./run_phone_demo.sh            # 개발 메뉴 포함
./run_phone_demo.sh --no-dev   # 사용자 화면 그대로
```

## 테스트

```bash
cd solpay-ai && uv run pytest                      # AI 서버
cd backend && sh gradlew test                       # 백엔드
cd frontend && node --test utils/__tests__/*.mjs   # 앱 로직
```

## 평가 결과

가상 사용자 1,005명의 2026.07.01~11.05 결제 202,288건을 하루씩 다시 돌려, 그 시점까지의 정보로만 카드를 고르게 했습니다.

| 항목 | 결과 |
|---|---|
| 혜택률 (받은 혜택 ÷ 결제액) | 평소 쓰던 카드 0.811% → Pay·Mate 1순위 카드 **1.326%** (+0.515%p, 1인 월평균 8,205원 더 받음) |
| 상한 대비 확보율 | 결제를 모두 미리 알 때의 최대치(1.536%) 대비 71.1% |
| 규칙 점검 | 배치 9,361건에서 내 카드가 아닌 카드·중복·누락 등 문제 0건 |
| 배치 속도 | 엔진 계산 중앙 4.5ms, 95% 11.4ms (백엔드 제한 2초) |
| AI 챗봇 | 질문 500개(시연 계정 5명, 13가지 유형) 중 495개 정답 (99.0%) |
| 일정 장소 분류 | 업종 95.7%, 브랜드 100% |

행사 29건이 평가 기간 내내 진행되고, 마이샵은 30%만 켰으며, 사용자가 늘 1순위 카드로 결제한다고 가정한 결과입니다. 1,005명 중 37명(3.7%)은 혜택이 줄었습니다.
평가 방법과 자세한 결과는 아래 설계 문서에 있고, 평가 코드는 `solpay-ai/evaluation/` 에 있습니다.

## 설계 문서

| 문서 | 내용 |
|---|---|
| [카드 배치 알고리즘 설계서](docs/설계/카드배치_알고리즘_설계서.md) | 업종 예측 → 카드별 기대 혜택 → 실적 가치 → 교체 판단, 설정 값, 실패 처리, 검증 |
| [LLM 챗봇 설계서](docs/설계/LLM_챗봇_설계서.md) | Tool Calling 구조, 도구 17개, 숫자 검사·다시 쓰기, 모델 설정, 검증 |
| [챗봇 500문항 검증 보고서](docs/설계/챗봇_500문항_검증_보고서.md) | 문항 구성, 채점 방법, 유형별 결과, 틀린 문항 |
| [AI 서버 상세 기록](solpay-ai/docs/상세_기록.md) | 실행·학습·평가·API·환경 변수 |
| [백엔드 AI 연동](backend/docs/AI_연동.md) | 백엔드 주소와 AI 서버 API 의 대응 |

`docs/설계/` 의 날짜가 붙은 문서는 기능별로 만들 때의 설계 기록입니다.

## 저장소에 없는 것

비밀값이거나 용량이 커서 올리지 않았습니다.

| 무엇 | 만드는 법 |
|---|---|
| `.env` 파일들 | `.env.example` 을 복사해 채웁니다 (DB 비밀번호, JWT 키, OpenAI 키 등) |
| `카드서비스_DB_1년_v2.1/` | 팀 공유 폴더에서 받아 저장소 맨 위에 둡니다 (`data` 에서 `generate.export_db` 로 다시 만들 수도 있습니다) |
| `data/out_v2.1/` | `data` 폴더에서 `SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.main` |
| `solpay-ai/artifacts/` | `solpay-ai` 폴더에서 `training.build_priors`, `training.train_category` (위 '2. AI 서버') |

## 브랜치

| 브랜치 | 내용 |
|---|---|
| `main` | 최종본. 배포(Amplify)도 이 브랜치 기준입니다 |
| `ai`, `back`, `front` | 파트별로 작업하던 브랜치 |
