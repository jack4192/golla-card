# Pay·Mate 백엔드

앱이 부르는 API 서버입니다. 회원·카드·일정·결제·알림을 DB에 저장하고, 카드 배치·추천·챗봇은 AI 서버(`solpay-ai`)에 넘겨 결과를 돌려줍니다.

- Java 21, Spring Boot 4, Spring Security(JWT), Spring Data JPA, PostgreSQL
- 배포: EC2의 Docker 컨테이너, 앞단 Caddy가 HTTPS를 붙입니다 (https://paymate.duckdns.org)

## 패키지 구성

| 패키지 | 하는 일 |
|---|---|
| `auth` | 회원가입, 로그인, 로그아웃, JWT 발급·검사 |
| `user` | 내 정보, 이메일·휴대폰 중복 확인, 약관·알림 동의, 회원 탈퇴 |
| `card` | 카드 상품 목록·상세, 내 카드 등록·삭제·순서 변경, 카드별 혜택 |
| `schedule` | 하루 일정 저장·수정·삭제 (저장하면 AI 서버에도 넘깁니다) |
| `payment` | 결제 코드 발급, 가상 POS 승인, 결제 내역·월간·연간 요약 |
| `promotion` | 진행 중인 행사 목록 |
| `push` | 웹 푸시 구독, 매일 아침 7시 일정 알림 |
| `ai` | AI 서버 호출 (카드 배치, 추천, 챗봇, 리포트, 규칙). AI가 늦으면 내 카드 순서로 대신 답합니다 |
| `common`, `config`, `util` | 오류 응답 형식, 보안·CORS 설정, 공용 도구 |

`src/main/resources/static/` 에는 카드 이미지, 행사 로고, 가상 POS 화면(`/pos`)이 있습니다.

## 주요 API

| 구분 | 주소 |
|---|---|
| 회원 | `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/users/me`, `POST /api/users/me/withdrawal` |
| 카드 | `GET /api/card-products`, `GET /api/cards/user-cards`, `POST /api/cards/register`, `PUT /api/cards/order`, `DELETE /api/cards/{userCardId}` |
| 일정 | `GET·POST /api/schedules`, `PUT·DELETE /api/schedules/{scheduleId}` |
| 결제 | `POST /api/v1/payment-tokens`, `POST /api/v1/pos/payments`, `GET /api/payments/recent`, `GET /api/payments/month-summary`, `GET /api/payments/year-summary` |
| 행사·알림 | `GET /api/promotions`, `GET /api/push/public-key`, `POST·DELETE /api/push/subscriptions` |
| AI | `POST /api/ai/rank`, `POST /api/ai/chat`, `POST /api/ai/recommendation-page`, `GET /api/ai/monthly-report`, `GET /api/ai/missed-benefit` 등 |

AI 쪽 주소와 AI 서버 API의 대응, 오류 응답은 [docs/AI_연동.md](docs/AI_연동.md) 에 정리했습니다.

## 실행

`.env.example` 을 `.env` 로 복사해 값을 채웁니다. 서버가 뜰 때 이 파일을 읽습니다 (환경 변수로 넣어도 됩니다).

| 변수 | 뜻 |
|---|---|
| `DB_URL`, `DB_USERNAME`, `DB_PASSWORD` | DB 접속 정보 (`jdbc:postgresql://주소:5432/DB이름`) |
| `JWT_SECRET` | 로그인 토큰 서명 키 |
| `AI_BASE_URL`, `AI_INTERNAL_TOKEN` | AI 서버 주소와 내부 호출 토큰 |
| `CORS_ALLOWED_ORIGINS` | 웹에서 부를 수 있는 주소 (쉼표로 구분) |
| `POS_DEMO_TERMINAL_KEY` | 가상 POS 승인용 키 (16자 이상) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | 웹 푸시 알림 키 |

```bash
sh gradlew bootRun     # Windows 는 gradlew.bat bootRun
```

- `Started PaymateBackendApplication` 이 보이면 http://localhost:8080 에서 받습니다.
- 표가 이미 있는 DB여야 합니다 (`ddl-auto: validate`). 표를 만드는 SQL은 저장소의 `db/` 와 `backend/shared-db/` 에 있습니다.
- IntelliJ로 열 때는 저장소 전체가 아니라 `backend/` 폴더를 엽니다.

## DB 변경 SQL

| 폴더 | 내용 |
|---|---|
| `shared-db/` | 공용 RDS에 적용한 변경 (일정·결제·행사 표시·푸시 구독 등) |
| `local-db/` | 로컬 시험 DB를 같은 모양으로 맞추는 SQL |

## 테스트

```bash
sh gradlew test
```
