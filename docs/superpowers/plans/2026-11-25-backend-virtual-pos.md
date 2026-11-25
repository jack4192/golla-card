# 백엔드 가상 POS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 배포한 백엔드에서 `/pos` 시연용 가상 POS 화면과 API 3개로 손님 앱 QR 결제를 승인한다.

**Architecture:** `PosPaymentService` 에 시연 결제(`payDemo`)와 켜짐 여부를 더하고, 목록 조회는 새 `PosDemoService`, 주소는 새 `PosDemoController`(`/api/v1/pos/demo`)가 맡는다. 화면은 `static/pos/` 정적 파일이고 같은 주소의 API 만 부른다. 만능 키는 서버 안에서만 스위치로 쓴다.

**Tech Stack:** Spring Boot(Java 21), Spring Data JPA 네이티브 쿼리, JUnit5·Mockito·MockMvc, 정적 HTML/JS.

**Spec:** `docs/superpowers/specs/2026-11-25-backend-virtual-pos-design.md`

## Global Constraints
- 켜기: `app.pos.demo-terminal-key`(환경 변수 `POS_DEMO_TERMINAL_KEY`)가 16자 이상일 때만. 꺼져 있으면 시연 API 3개는 404, 코드 `POS_DEMO_DISABLED`, 메시지 "시연용 POS 가 꺼져 있습니다."
- 키 원문은 응답·화면 코드 어디에도 넣지 않는다.
- 기존 `POST /api/v1/pos/payments` 동작·시험은 그대로.
- 시연 결제 금액 100 ~ 10,000,000원, 결제 코드는 기존 `normalizeCode` 규칙(PAYMATE: 접두·공백·- 허용).
- `/pos`, `/pos/**`(GET), 시연 API 3개는 로그인 없이(permitAll).
- 거래 목록 `limit` 기본 20, 1~50 으로 자른다.
- 화면·메시지는 한국어.

## Review Focus
1. 같은 QR 을 두 번 찍음 → 두 번째는 거절 `ALREADY_USED` (Task 1 시험 `payDemoDeclinesReusedCode`).
2. 단말기 없는/없는 가맹점 번호 → 404 `MERCHANT_NOT_FOUND`, 화면은 메시지를 보여 줌 (Task 1 `payDemoUnknownMerchant`).
3. 키가 꺼진 서버에서 `/pos` 를 엶 → 화면이 깨지지 않고 "꺼져 있어요" (Task 2 API 404 시험 + Task 4 브라우저 확인).
4. `limit=0`·`-5`·`100000` → 1~50 으로 잘림 (Task 1 `recentTransactionsClampsLimit`).
5. 시연 결제가 만능 키 없이 기존 키 경로를 열지 않음 → 꺼져 있으면 `payDemo` 도 404 (Task 1 `demoDisabledEverywhere`).

---

### Task 1: 서비스·저장소

**Files:**
- Modify: `backend/src/main/java/com/paymate/backend/payment/service/PosPaymentService.java`
- Modify: `backend/src/main/java/com/paymate/backend/payment/repository/PosRepository.java`
- Modify: `backend/src/main/java/com/paymate/backend/payment/exception/PaymentErrorCode.java`
- Create: `backend/src/main/java/com/paymate/backend/payment/repository/PosMerchantRow.java`, `PosTransactionRow.java`
- Create: `backend/src/main/java/com/paymate/backend/payment/service/PosDemoService.java`
- Create: `backend/src/main/java/com/paymate/backend/payment/dto/PosMerchantResponse.java`, `PosTransactionResponse.java`
- Test: `backend/src/test/java/com/paymate/backend/payment/PosPaymentServiceTest.java`, Create `PosDemoServiceTest.java`

**Interfaces:**
- Produces: `PaymentErrorCode.POS_DEMO_DISABLED(NOT_FOUND, "시연용 POS 가 꺼져 있습니다.")`
- Produces: `boolean PosPaymentService.isDemoEnabled()`; `PosPaymentResponse PosPaymentService.payDemo(String code, int amount, Long merchantId)` — 꺼져 있으면 `BusinessException(POS_DEMO_DISABLED)`, 켜져 있으면 `pickTerminal(merchantId, null)` → 형식 틀리면 `decline(..., "INVALID_FORMAT")`, 아니면 `process(...)`. 결제 시각은 `clock.now()`.
- Produces: `PosRepository.findDemoMerchants(): List<PosMerchantRow>` (단말기가 있는 가맹점, `categories` LEFT JOIN, 업종 이름·가맹점 이름·지점 순) / `findRecentTransactions(int limit): List<PosTransactionRow>` (`pos_transactions` 기준, terminals·merchants·categories·payments·user_cards·cards LEFT JOIN, `txn_id DESC`)
- Produces: `record PosMerchantResponse(Long merchantId, String merchantName, String branchName, String category, String categoryName)`
- Produces: `record PosTransactionResponse(Long txnId, OffsetDateTime requestedAt, boolean approved, String declineReason, String approvalNo, String merchantName, String branchName, String categoryName, int amount, String cardName, int totalDiscount)` — 카드 이름·승인번호는 거절이면 null, 혜택 합 = benefit_amount + promotion_amount (없으면 0)
- Produces: `PosDemoService.merchants(): List<PosMerchantResponse>`, `PosDemoService.recentTransactions(Integer limit): List<PosTransactionResponse>` — 둘 다 꺼져 있으면 `POS_DEMO_DISABLED`; limit null→20, 1~50 으로 자름

- [ ] **Step 1: 실패하는 시험** — `PosPaymentServiceTest` 에 `payDemoApprovesAtChosenMerchant`(만능 키 서비스, 가맹점 77 단말기로 승인, `insertApproved(eq(5L)...)`), `payDemoDeclinesReusedCode`(USED 코드 → `ALREADY_USED`), `payDemoUnknownMerchant`(빈 목록 → 404 `MERCHANT_NOT_FOUND`), `demoDisabledEverywhere`(`service(null)`·`service("short")` → `isDemoEnabled()==false`, `payDemo` 404 `POS_DEMO_DISABLED`). 새 `PosDemoServiceTest`: `merchantsMapsRows`, `recentTransactionsClampsLimit`(null→20, 0→1, -5→1, 100000→50 을 `verify(pos).findRecentTransactions(n)`), `listsDisabled`(꺼져 있으면 둘 다 404).
- [ ] **Step 2: 실행해 실패 확인** — `cd backend && bash ./gradlew test --tests '*PosPaymentServiceTest' --tests '*PosDemoServiceTest'` → 컴파일 실패(없는 메서드).
- [ ] **Step 3: 구현** — 위 Interfaces 대로. 시각은 `ZonedDateTime.of(t, Asia/Seoul).toOffsetDateTime()`.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.

### Task 2: 컨트롤러·보안·주소

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/payment/controller/PosDemoController.java`
- Create: `backend/src/main/java/com/paymate/backend/payment/dto/PosDemoPaymentRequest.java`
- Create: `backend/src/main/java/com/paymate/backend/config/PosPageConfig.java`
- Modify: `backend/src/main/java/com/paymate/backend/config/SecurityConfig.java`
- Test: Create `backend/src/test/java/com/paymate/backend/payment/PosDemoApiTest.java`

**Interfaces:**
- Consumes: Task 1 의 `payDemo`, `PosDemoService.merchants/recentTransactions`
- Produces: `GET /api/v1/pos/demo/merchants`, `POST /api/v1/pos/demo/payments` 본문 `PosDemoPaymentRequest{ @NotBlank code, @NotNull @Min(100) @Max(10000000) Integer amount, @NotNull Long merchantId }` → `PosPaymentResponse`, `GET /api/v1/pos/demo/transactions?limit=`
- Produces: `GET /pos` → `forward:/pos/index.html` (WebMvcConfigurer `addViewControllers`)

- [ ] **Step 1: 실패하는 시험** — `PosDemoApiTest`(@SpringBootTest @AutoConfigureMockMvc, 로컬 DB, DB 에 쓰지 않음): `@Nested` 꺼짐(`@TestPropertySource(properties = "app.pos.demo-terminal-key=")`): 로그인 없이 3개 API → 404 `$.code == "POS_DEMO_DISABLED"`. 켜짐(`app.pos.demo-terminal-key=test-demo-key-0123456789`): `merchants` 200·길이 > 0·`$[0].categoryName` 있음, `transactions?limit=3` 200·길이 ≤ 3, `payments` 금액 50 → 400, 코드 빈칸 → 400. 공통: `GET /pos` 200, 본문에 "가상 POS".
- [ ] **Step 2: 실패 확인** — `bash ./gradlew test --tests '*PosDemoApiTest'` → 401/404 로 실패.
- [ ] **Step 3: 구현** — SecurityConfig 에 `GET "/pos", "/pos/**", "/api/v1/pos/demo/merchants", "/api/v1/pos/demo/transactions"`, `POST "/api/v1/pos/demo/payments"` permitAll. 컨트롤러는 서비스 호출만.
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS (Task 3 전이라 `/pos` 시험은 Task 3 에서 통과해도 된다: 이 단계에선 `/pos` 시험만 실패 허용).

### Task 3: POS 화면

**Files:**
- Create: `backend/src/main/resources/static/pos/index.html`, `backend/src/main/resources/static/pos/pos.css`
- Source: `demo/static/pos.html`, `demo/static/style.css` (POS 에 쓰는 규칙만)

**Interfaces:**
- Consumes: Task 2 API (같은 주소, 상대 경로 `/api/v1/pos/demo/...`)

- [ ] **Step 1:** demo 화면을 옮겨 고친다 — 가맹점 `<select>` 는 업종 이름별 `<optgroup>`(지점 이름 붙여 표시), 업종 칸 자동, 금액·18자리 번호, 승인 결과(승인번호·혜택 이름/금액·프로모션·합계, 거절은 사유 한국어: INVALID_FORMAT 코드 형식이 올바르지 않아요 / NOT_ISSUED 발급되지 않은 코드예요 / ALREADY_USED 이미 사용된 코드예요 / VOIDED 새 코드가 발급됐거나 결제 창이 닫혀 무효가 된 코드예요 / EXPIRED 유효시간이 지난 코드예요), 오류 응답은 `message` 표시, 최근 거래 표(시각·결과·가맹점·업종·금액·카드·혜택·승인번호/거절 사유) 3초마다. 가맹점 API 가 404 면 폼을 막고 "시연용 POS 가 꺼져 있어요. 서버의 POS_DEMO_TERMINAL_KEY 를 확인해 주세요." 카메라 찍기 코드는 그대로 둔다. 시연 사용자·시연 시각·'가장 유리했던 카드'는 뺀다.
- [ ] **Step 2: 통과 확인** — `bash ./gradlew test --tests '*PosDemoApiTest'` → `/pos` 시험 포함 PASS.

### Task 4: 브라우저 확인 (사본 DB `v21_append_test`)

- [ ] **Step 1:** worktree 백엔드를 `DB_URL` 만 사본 DB 로 바꿔 8095 에서 켠다(`CORS_ALLOWED_ORIGINS=http://localhost:8086 SERVER_PORT=8095`, 키는 .env 값). 앱 웹을 `EXPO_PUBLIC_API_URL=http://localhost:8095` 8086 으로 켠다.
- [ ] **Step 2:** 시험 계정으로 앱 결제 창 QR 번호를 읽고 `http://localhost:8095/pos` 에서 가맹점·금액 넣어 승인 → 앱이 '결제 완료', 최근 이용내역 반영, POS 표에 승인 행. 같은 번호 다시 → '이미 사용된 코드예요'. 키 없이 켠 서버에서 `/pos` → 꺼짐 안내.
- [ ] **Step 3:** 사본 DB 에서 시험으로 생긴 payments·payment_details·pos_transactions·payment_codes 사용 표시·월 실적(user_card_month_status 등 `addToMonthStatus` 가 바꾼 칸)을 되돌린다. 켠 서버를 끈다.

### Task 5: 전체 시험·검토
- [ ] `cd backend && bash ./gradlew test` 전체 통과(기존 119 + 새 시험), 실패는 이름째 보고.
- [ ] 브랜치 전체를 스스로 검토(서브에이전트는 사용자 요청 없이는 쓰지 않음) — 키 노출, permitAll 범위, 기존 POS 경로 회귀.
- [ ] 커밋·합치기·푸시·EC2 배포는 사용자가 요청할 때만.
