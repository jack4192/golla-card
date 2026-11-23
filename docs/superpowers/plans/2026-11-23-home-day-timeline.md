# 홈 시간 표시줄 하루 배치 + 결제 내역 + 데이터 11/26 연장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 '내 지갑' 시간 표시줄(0~24시)에서 파란 동그라미를 옮기면 그 시각 AI 1순위 카드가 큰 카드로 보이게 한다. 오늘 결제는 점과 '최근 결제'로 보이게 하고, v2.1 가상 결제는 2026-11-26 24시까지 늘린다.

**Architecture:**
- **AI:** 하루치 배치를 한 번에 계산하는 `/internal/users/{id}/day-placement` 를 만든다. 기록은 남기지 않는다.
- **백엔드:** 그 결과를 넘기는 `/api/ai/day-placement` 와 결제 조회 `/api/payments`, `/api/payments/recent` 를 만든다. 둘 다 '기준 시각'까지만 돌려준다.
- **앱:** 순수 함수(dayTimelineCore)로 시각·위치·구간·결제 문구를 계산하고, TodaySchedulePanel 홈 화면에 끌기·'지금' 버튼·결제 점·최근 결제를 붙인다.
- **데이터:** 생성기 사본에서 기준일만 바꿔 다시 만든다. 기존 폴더와 비교해 새 행만 더한다.

**Tech Stack:** FastAPI·pytest (solpay-ai) / Spring Boot 4.1·Java 21·JUnit·MockMvc (backend) / Expo React Native·node --test (frontend) / pandas·Postgres·docker psql (data)

**Spec:** `/Users/jinwoo/Desktop/solpay-final/docs/superpowers/specs/2026-11-23-home-day-timeline-design.md`

## Global Constraints

**지켜야 할 동작**
- 하루 배치는 추천 기록을 남기지 않는다. `PlacementService.preview` 경로만 쓰고 `log_recommendation` 은 부르지 않는다.
- 기준 시각은 `ai.fixed-at`(AI_FIXED_AT)이 있으면 그 시각, 없으면 서울 현재 시각이다.
  - 결제는 `paid_at <= 기준 시각` 까지만 돌려준다.
  - 하루 배치의 '앞으로의 시각'은 기준 시각의 상태로 계산한다.
- 동그라미를 옮기면 **큰 카드만** 바뀐다. '내 카드' 목록(PaymentCardOrder)은 바꾸지 않는다.
- 표시줄은 0~24시, 눈금 글자는 0·6·12·18·24시, 10분 단위로 맞춘다. 범위는 0~1430분(23:50)이다.

**화면 문구 (그대로)**

| 자리 | 문구 |
|---|---|
| 말풍선 (현재) | `지금 HH:MM` |
| 말풍선 (옮김) | `HH:MM 미리보기` |
| 현재로 돌아가는 버튼 | `지금` |
| 큰 카드 아래 결제 | `이 시각 결제: {가게} {금액} · {카드}` |
| 하루 배치 실패 | `이 시각 AI 카드를 불러오지 못했어요` |
| 결제 버튼 막힘 | `미리보기 중에는 결제할 수 없어요` |
| 결제 섹션 | `최근 결제` · `더 보기` · `아직 결제 내역이 없어요` · `결제 내역을 불러오지 못했어요` · `다시 시도` |

**건드리지 않는 것**
- 다른 세션의 커밋 안 한 파일(`~/Desktop/solpay/data/generate/*`, `data/config/v2*`, `.gitignore`, `data/README.md`)은 수정하지 않는다. 데이터 생성은 scratchpad 사본에서만 한다.
- 사용자 서버(8031 AI·8090 백엔드·8081 앱)는 건드리지 않는다. 확인용 포트는 8231·8290·19006 이다.
- 공용 RDS 에 쓰지 않는다. 스크립트만 만들고 실행은 사용자가 한다.
- 실제 DB(solpay_v21)·팀 DB 폴더에 넣기 전에 **표별 수치를 사용자에게 보여 주고 확인받는다** (Task 7 끝에서 멈춤).
- 커밋은 worktree 브랜치에만 한다. 합치기(본 폴더 final·ai/placement-engine)와 푸시는 사용자가 요청할 때만 한다. `.env`·카드서비스_DB* 폴더·artifacts 는 커밋하지 않는다.

**시험 명령**

| 대상 | 명령 |
|---|---|
| AI | `cd <AI worktree>/solpay-ai && SOLPAY_DATABASE_URL="" SOLPAY_STORE=teamdb OPENAI_API_KEY="" ~/Desktop/solpay/solpay-ai/.venv/bin/python -m pytest -q` |
| 백엔드 | `cd <final worktree>/backend && JAVA_HOME=$(/usr/libexec/java_home -v 21) sh gradlew test` (로컬 DB solpay_v21 필요) |
| 앱 | `cd <final worktree>/frontend && node --test utils/__tests__/*.test.mjs` |

커밋 메시지 끝: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **자정을 넘는 일정이나 일정 없는 날에도 구간이 끊기면 안 된다.** 구간은 00:00~24:00 을 빈틈없이 덮어야 한다. Task 1 `test_구간은_하루를_빈틈없이_덮는다` 로 확인한다.
2. **AI 가 꺼졌거나 늦어도 홈이 멈추면 안 된다.** 옮긴 시각의 큰 카드는 결제 카드와 실패 문구가 된다. Task 4 `scrubbedCard` 시험으로 확인한다.
3. **1순위가 기기 지갑에 없는 서버 카드일 수 있다.** 그 구간에서는 지갑에 있는 다음 순위 카드를 보인다. Task 4 `toDaySegments` 시험으로 확인한다.
4. **기준 시각 이후 결제와 미래 날짜는 보이면 안 되고, 남의 결제도 보이면 안 된다.** Task 2 `PaymentServiceTest`·`PaymentApiTest` 로 확인한다.
5. **동그라미를 표시줄 밖으로 끌어도 0~23:50 안에 머물러야 한다.** Task 4 `ratioToMinute` 시험으로 확인한다.

---

### Task 1: AI 하루 배치 (solpay-ai)

**작업 위치:** `~/Desktop/solpay` 에서 `git worktree add .worktrees/day-placement -b ai/day-placement ai/placement-engine`.
- 본 폴더의 `.env`·`solpay-ai/.env` 를 worktree 같은 자리에 심볼릭 링크로 둔다. 링크는 커밋하지 않는다.

**Files:**
- Create: `solpay-ai/engine/day_plan.py`
- Modify: `solpay-ai/engine/service.py` (`PlacementService.day_placement` 추가)
- Modify: `solpay-ai/engine/api.py` (`DayBody`, `POST /internal/users/{user_id}/day-placement`)
- Test: `solpay-ai/tests/test_day_placement.py` (`tests.test_service_api` 의 `FakeStore` 와 같은 `svc` fixture 를 쓴다)

**Interfaces:**
- **Produces:** `day_points(day: date, schedules: list[ScheduleItem]) -> list[datetime]`
  - KST 매시 정각 24개에 각 일정의 `start - 30분`, `end + 30분` 을 더한다.
  - `[day 00:00, 다음날 00:00)` 밖은 버리고, 정렬·중복 제거한다.
- **Produces:** `merge_segments(day: date, results: list[tuple[datetime, RankResult]]) -> list[dict]`
  - 이웃한 점의 1순위 `user_card_id` 가 같으면 한 구간으로 합친다.
  - 구간 `{start:"HH:MM", end:"HH:MM", user_card_id:int, message:str, reason_code:str, cards:[{user_card_id, rank}]}` 이다. 마지막 end 는 `"24:00"` 이다.
  - 카드가 없는 결과(`cards == []`)만 있으면 `[]` 를 돌려준다.
- **Produces:** `PlacementService.day_placement(user_id: int, day: date, now: datetime) -> dict` 는 `{"day": "YYYY-MM-DD", "segments": [...]}` 를 돌려준다.
  - `p <= now` 인 점: `self.preview(user_id, p)` 로 그 시각 상태를 쓴다.
  - `p > now` 인 점: `ctx = dataclasses.replace(self.store.context(user_id, now), schedules=self.store.schedules(user_id, day))` 를 한 번만 읽고 `self.preview(user_id, p, context=ctx)` 로 계산한다.
  - 일정은 `self.store.schedules(user_id, day)` 로 읽는다. `UnknownUser` 는 그대로 올린다.
- **Produces (HTTP):** `POST /internal/users/{user_id}/day-placement`, 본문 `{"day": "YYYY-MM-DD", "now": ISO|null}`.
  - `now` 는 `_kst()` 로 바꾼다. 없는 사용자는 404 `"없는 사용자입니다"` 이다.

- [ ] **Step 1: 실패하는 시험 작성** (`tests/test_day_placement.py`, `D = date(2026, 10, 7)`, 시각은 `tests.conftest.at`)
  - `test_하루_점은_매시_정각과_일정_창_경계다`
    - 일정 `ScheduleItem(1, 1, at(hour=12, minute=15), at(hour=13), "RESTAURANT", 9000)` 를 준다.
    - 기대: 점이 26개, 첫 점 `at(hour=0)`, `at(hour=11, minute=45)` 와 `at(hour=13, minute=30)` 포함, 정렬됨.
  - `test_자정을_넘는_일정_경계는_그날_안에서만_쓴다`
    - 일정 `at(hour=23, minute=50)` ~ `at(day=8, hour=0, minute=20)` 를 준다.
    - 기대: `at(hour=23, minute=20)` 은 들어가고, 다음날 시각은 하나도 없다.
  - `test_같은_1순위가_이어지면_한_구간으로_합친다`
    - `RankResult` 3개를 직접 만든다: 0시 101, 1시 101, 2시 102.
    - 기대: `[{"start":"00:00","end":"02:00","user_card_id":101,...}, {"start":"02:00","end":"24:00","user_card_id":102,...}]`.
  - `test_구간은_하루를_빈틈없이_덮는다`
    - API 로 `{"day": "2026-10-07", "now": "2026-10-07T12:20:00+09:00"}` 를 보낸다.
    - 기대: 첫 start `"00:00"`, 마지막 end `"24:00"`, 각 구간 `end == 다음 start`.
  - `test_하루_배치는_기록을_남기지_않는다`: 위 호출 뒤 `svc.store.logs == []`.
  - `test_앞으로의_시각은_기준_시각_이후_결제를_쓰지_않는다`
    - `svc.store.context` 를 감싸 받은 `when` 을 모은다.
    - 기대: `max(when) <= now` (now = 12:20).
  - `test_카드가_없는_사용자는_빈_구간이다`: `_no_cards(svc)` 처럼 하면 `segments == []`.
  - `test_없는_사용자는_404`: user_id 99 → 404.
- [ ] **Step 2: 실패 확인** — `... -m pytest tests/test_day_placement.py -q`. Expected: ImportError/404 로 FAIL.
- [ ] **Step 3: 구현**
  - `day_plan.py` 의 두 함수, `PlacementService.day_placement`, `DayBody(BaseModel): day: date; now: datetime | None = None`, 엔드포인트를 만든다.
  - 엔드포인트 docstring 에는 "앱 홈 시간 표시줄용, 기록 없음, 2026-11-23" 을 적는다.
- [ ] **Step 4: 통과 확인** — 위 파일 PASS, 그다음 AI 전체 시험. Expected: 기존 568 통과 + 새 8개, 실패 0.
- [ ] **Step 5: 커밋** — `git add solpay-ai/engine/day_plan.py solpay-ai/engine/service.py solpay-ai/engine/api.py solpay-ai/tests/test_day_placement.py && git commit -m "AI: 하루 배치를 한 번에 (홈 시간 표시줄용, 기록 없음)"`

### Task 2: 백엔드 기준 시각·결제 내역 API

**작업 위치:** `~/Desktop/solpay-final` 에서 `git worktree add .worktrees/home-timeline -b feature/home-timeline final`.
- `backend/.env` 를 심볼릭 링크로 두고, `frontend/node_modules` 는 본 폴더 것을 링크한다.

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/common/DemoClock.java`
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiService.java` (`parseDate`·`fixedDate` 대신 `DemoClock.of(fixedAt)` 사용, 공개 동작 그대로)
- Create: `backend/src/main/java/com/paymate/backend/payment/{repository/PaymentRow.java, repository/PaymentRepository.java, dto/PaymentResponse.java, service/PaymentService.java, controller/PaymentController.java}`
- Test: `backend/src/test/java/com/paymate/backend/payment/PaymentServiceTest.java`, `PaymentApiTest.java`

**Interfaces:**
- **Produces:** `DemoClock` (평범한 클래스)
  - `static DemoClock of(String fixedAt)`: 형식은 AiService 와 같다. 틀리면 `IllegalArgumentException`, 메시지도 기존 그대로다.
  - `LocalDateTime now()`: 서울 기준이다.
  - `LocalDate today()`
  - `String fixedAt()`: 없으면 null 이다.
- **Produces:** `PaymentRepository extends Repository<Card, Long>`. native 쿼리 두 개이고, 둘 다 `user_cards uc ON uc.user_card_id = p.user_card_id AND uc.user_id = :userId`, `cards c`, `categories cat` 를 잇는다.
  - `List<PaymentRow> findBetween(Long userId, LocalDateTime from, LocalDateTime until)`: `paid_at >= :from AND paid_at <= :until`, `ORDER BY paid_at, payment_id`.
  - `List<PaymentRow> findRecent(Long userId, LocalDateTime until, Long beforeId, int limit)`: `paid_at <= :until AND (:beforeId IS NULL OR payment_id < :beforeId)`, `ORDER BY payment_id DESC LIMIT :limit`.
  - 주석으로 남긴다: 결제 번호는 시간순으로 매겨서 번호가 곧 시간 커서다.
- **Produces:** `PaymentResponse(Long paymentId, String paidAt /*"yyyy-MM-ddTHH:mm:ss"*/, String merchantName, String category, String categoryName, int amount, int benefitAmount, int promotionAmount, Long userCardId, String cardName)`
- **Produces:** `PaymentService(PaymentRepository, @Value("${ai.fixed-at:}") String fixedAt)`
  - `List<PaymentResponse> ofDay(Long userId, LocalDate day)`: `day > today` 면 쿼리 없이 빈 목록이다. 아니면 `until = min(day 23:59:59.999999999, now)`.
  - `List<PaymentResponse> recent(Long userId, Long beforeId, Integer limit)`: limit 기본 5, 1~50 으로 자른다.
- **Produces (HTTP):** `GET /api/payments?date=YYYY-MM-DD`, `GET /api/payments/recent?limit=&beforeId=`. 로그인 필요(기존 `anyRequest().authenticated()`).

- [ ] **Step 1: 실패하는 시험 작성**
  - `PaymentServiceTest` (가짜 PaymentRepository 로 인자를 기록한다)
    - `ofDayStopsAtNow`: fixedAt `2026-11-04T12:00:00`, `ofDay(1, 2026-11-04)` → until == `2026-11-04T12:00`.
    - `ofDayPastDayUsesDayEnd`: `ofDay(1, 2026-11-03)` → until == `2026-11-03T23:59:59.999999999`.
    - `futureDayIsEmptyWithoutQuery`: `ofDay(1, 2026-11-05)` → 빈 목록, 쿼리 0번.
    - `recentLimitClamped`: limit null→5, 0→1, 500→50, beforeId 그대로 전달, until == now.
    - `DemoClock` 형식: `2026-11-05T09:30:00`, `2026-11-05T09:30:00+09:00` 모두 today 2026-11-05. `"oops"` 는 IllegalArgumentException.
  - `PaymentApiTest` (`@SpringBootTest(properties = "ai.fixed-at=2026-11-04T12:00:00")`, 로컬 DB, test1 토큰은 PromotionApiTest 방식)
    - `needsLogin`: `/api/payments?date=2026-11-04` → 401.
    - `ofDay`: test1 의 2026-11-04 → 1건 이상. 모든 `paidAt` 이 `2026-11-04T` 로 시작하고 `<= "2026-11-04T12:00:00"`, 오름차순, 모든 `userCardId` ∈ {1,2,3,4}.
    - `recentPaging`: limit 5 → 5건 내림차순. 두 번째 페이지(`beforeId` = 첫 페이지 마지막 id)의 첫 id < 그 값.
    - `notOthers`: test2 토큰으로 같은 날짜 → `userCardId` ∈ {5,6,7}.
- [ ] **Step 2: 실패 확인** — `sh gradlew test --tests '*payment*'`. Expected: 컴파일 실패/404 로 FAIL.
- [ ] **Step 3: 구현** — 위 Interfaces 그대로 만든다. AiService 의 `today()` 결과와 기존 AiServiceTest(fixedAt·noFixedAt·badFixedAt)는 그대로 통과해야 한다.
- [ ] **Step 4: 통과 확인** — 백엔드 전체 시험. Expected: 기존 43 + 새 시험 모두 통과.
- [ ] **Step 5: 커밋** — `git commit -m "백엔드: 결제 내역 API (기준 시각까지, 내 결제만)와 DemoClock"`

### Task 3: 백엔드 하루 배치 중계

**Files:**
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiService.java`
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiController.java`
- Test: `backend/src/test/java/com/paymate/backend/ai/AiServiceTest.java`

**Interfaces:**
- **Consumes:** Task 1 HTTP, Task 2 `DemoClock`.
- **Produces:** `AiService.dayPlacement(Long userId) -> String`: `client.post(userPath(userId, "/day-placement"), null, {"day": today().toString(), "now": fixedAt 있을 때만})`.
- **Produces:** `GET /api/ai/day-placement` → `json(ai.dayPlacement(id))`. 날짜 인자는 받지 않는다. 오늘은 서버가 정한다 (설계서의 `?day=` 대신, Ruling).

- [ ] **Step 1: 실패하는 시험** (StubAi 사용)
  - `dayPlacement`: fixedAt 없음 → `POST /internal/users/7/day-placement`, 본문에 `"day":"<LocalDate.now(Asia/Seoul)>"`, `"now"` 없음.
  - `dayPlacementFixedAt`: fixedAt `2026-11-05T09:30:00` → 본문 `"day":"2026-11-05"`, `"now":"2026-11-05T09:30:00"`.
- [ ] **Step 2: 실패 확인** — `--tests '*AiServiceTest*'` FAIL.
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — 백엔드 전체 시험 통과.
- [ ] **Step 5: 커밋** — `git commit -m "백엔드: 하루 배치 중계 /api/ai/day-placement"`

### Task 4: 앱 순수 함수·불러오기

**Files:**
- Create: `frontend/utils/dayTimelineCore.js`, `frontend/utils/dayTimeline.js`, `frontend/utils/payments.js`
- Modify: `frontend/utils/api.js` (`aiDayPlacement`, `paymentsOfDay`, `paymentsRecent`)
- Modify: `frontend/utils/aiPlacement.js` (`walletLinks` 를 export)
- Test: `frontend/utils/__tests__/dayTimelineCore.test.mjs`

**Interfaces:**
- **Produces (`dayTimelineCore.js`):** 상수 `DAY_MINUTES = 1440`, `STEP_MINUTES = 10`, `MAX_MINUTE = 1430`.
  - `ratioToMinute(ratio: number) -> number`: 10분 단위로 반올림하고 0~1430 으로 자른다.
  - `minuteToRatio(minute: number) -> number`: `minute / 1440`.
  - `minuteOfDay(date: Date) -> number`
  - `timeLabel(minute) -> "HH:MM"`
  - `toDaySegments(response, linked: {walletId: userCardId}) -> [{startMin, endMin, walletId, message}]`
    - walletId 는 구간 `cards` 를 순위대로 보아 지갑에 있는 첫 카드다.
    - message 는 그 카드가 1순위일 때만 넣고, 아니면 `''` 이다. 응답이 없거나 형식이 틀리면 `[]`.
  - `segmentAt(segments, minute) -> segment | null`: `startMin <= minute < endMin`.
  - `scrubbedCard({ segments, minute, walletCards, fallbackCard }) -> { card, note }`
    - 구간이 있고 지갑 카드가 있으면 `{card, note: message}` 이다.
    - 아니면 `{card: fallbackCard, note: '이 시각 AI 카드를 불러오지 못했어요'}` 이다.
  - `paymentDots(payments, nowMinute) -> [{key, ratio, minute, payment}]`: `minute <= nowMinute` 인 것만 넣는다.
  - `paymentAt(payments, minute) -> payment | null`: 결제 분과 차이가 10분 미만인 것 중 가장 가까운 결제다.
  - `paymentRowText(payment, today: 'YYYY-MM-DD') -> { when, merchant, amount, card, benefit }`
    - when 은 같은 날이면 `HH:MM`, 아니면 `M/D HH:MM` 이다. amount 는 `5,400원` 이다.
    - benefit 은 혜택+행사가 0보다 크면 `-540원`, 아니면 `''` 이다.
  - `paymentLine(payment) -> '이 시각 결제: 스타벅스 5,400원 · 신한 모두의카드'`
- **Produces (`dayTimeline.js`):** `loadDayPlacement(walletCards) -> Promise<segments[] | null>`. 서버 모드가 아니면 null 이다. `walletLinks()` + `api.aiDayPlacement()` + `toDaySegments` 로 만든다.
- **Produces (`payments.js`):**
  - `loadTodayPayments(day: 'YYYY-MM-DD') -> Promise<payment[]>`
  - `loadRecentPayments({ beforeId, limit }) -> Promise<payment[]>`

- [ ] **Step 1: 실패하는 시험** (`dayTimelineCore.test.mjs`)
  - `ratioToMinute`: `(-0.2)→0`, `(1.3)→1430`, `(0.5)→720`, `(0.5034)→720` (724.9분→720), `(0.5035)→730`.
  - `toDaySegments`: 1순위 13(지갑 없음), 2순위 12(지갑 KB_ALL) → walletId `KB_ALL`, message `''`. `null` → `[]`.
  - `segmentAt`: 경계 660 이면 `11:00` 에 시작하는 구간이다.
  - `scrubbedCard`: 구간이 없으면 fallbackCard 와 실패 문구다.
  - `paymentAt`: 08:12 결제에 분 490(08:10) → 그 결제, 분 510 → null.
  - `paymentDots`: nowMinute 이후 결제는 빠진다.
  - `paymentRowText`: 같은 날 `08:12`, 다른 날 `11/4 18:01`, `5,400원`, benefit `-540원` 과 `''`.
- [ ] **Step 2: 실패 확인** — `node --test utils/__tests__/dayTimelineCore.test.mjs` FAIL.
- [ ] **Step 3: 구현** — api.js 세 함수는 `auth: true` 다.
  - `paymentsRecent` 쿼리는 `limit` 과, 있을 때만 `beforeId` 를 넣는다.
- [ ] **Step 4: 통과 확인** — 앱 전체 node 시험. Expected: 51 + 새 시험 통과.
- [ ] **Step 5: 커밋** — `git commit -m "앱: 하루 배치·결제 내역 순수 함수와 불러오기"`

### Task 5: 앱 표시줄 끌기·'지금' 버튼·결제 점·큰 카드 미리보기

**Files:**
- Modify: `frontend/components/TodaySchedulePanel.js` (`HomeScheduleRibbon`, home 분기)

**Interfaces:**
- **Consumes:** Task 4 전부.
- **Produces:** `HomeScheduleRibbon` props 추가: `viewMinute: number|null`, `nowMinute: number`, `onScrub(minute)`, `onNow()`, `dots: paymentDots 결과`, `onDot(dot)`.
- **Produces:** `TodaySchedulePanel` 의 새 prop `paymentsList` (React 요소, cardList 처럼 홈에서만 쓴다). 자리는 내 카드 목록과 '오늘의 일정' 바로가기 사이다.

- [ ] **Step 1: 표시줄**
  - 0~24시 축으로 바꾼다. 눈금은 `[0, 6, 12, 18, 24]` 다.
  - 축 `onLayout` 으로 폭을 잰다. `PanResponder` 의 grant·move 에서 `ratioToMinute(locationX / width)` 로 `onScrub` 한다. 축을 누르기만 해도 옮겨진다.
  - 말풍선: viewMinute 가 null 이면 `지금 HH:MM`, 아니면 `timeLabel(viewMinute) 미리보기`.
  - viewMinute 가 null 이 아닐 때만 말풍선 옆에 작은 `지금` 버튼을 둔다(refresh-outline 14). 접근성 이름은 `현재 시각으로 돌아가기` 다.
  - 결제 점은 축 위 작은 점(6px)이고, 누르면 `onDot` 이다.
  - 일정 띠는 오늘 시간이 있는 일정을 시작순으로 하루 축 위에 그린다. 3줄까지 보이고 나머지는 '+N개' 다.
- [ ] **Step 2: home 분기 상태**
  - `viewMinute` 상태를 둔다. 날짜가 바뀌면 null 로 돌린다.
  - 서버 모드면 `loadDayPlacement(cards)` 를 부른다. 열쇠는 `[day, walletKey, 그날 일정 key 목록, aiRefresh]` 이고, 실패하면 `[]` 를 둔다.
  - 서버 모드면 `loadTodayPayments(day)` 를 부른다. 열쇠는 `[day, clockTime]` 이고 1분마다 다시 읽는다. 실패하면 점을 숨긴다.
- [ ] **Step 3: 큰 카드**
  - viewMinute 가 null 이면 지금 동작 그대로다.
  - 아니면 서버 모드에서는 `scrubbedCard({segments, minute: viewMinute, walletCards: cards, fallbackCard: selectedCard})` 를 쓴다.
  - 데모 모드에서는 그 시각을 덮는 timeline 행 중 match 가 있는 첫 행의 카드를 쓰고, 없으면 selectedCard 다.
  - note 는 큰 카드 이름 아래에 보인다. `paymentAt(todayPayments, viewMinute)` 가 있으면 그 아래에 `paymentLine` 을 보인다.
- [ ] **Step 4: 결제 버튼**
  - viewMinute 가 null 이 아니면 `disabled` 로 두고, 버튼 아래에 `미리보기 중에는 결제할 수 없어요` 를 보인다.
  - '내 카드' 목록(cardList)은 그대로 둔다.
- [ ] **Step 5: 확인** — 앱 node 시험 전체 통과. 확인용 앱(19006)에서 화면 미리보기 모드로 표시줄 끌기·'지금' 버튼이 동작하는지 스크린샷으로 본다. 그 뒤 커밋: `git commit -m "앱: 홈 시간 표시줄을 하루로, 끌면 그 시각 AI 카드 미리보기"`

### Task 6: 앱 최근 결제

**Files:**
- Create: `frontend/components/RecentPayments.js`
- Modify: `frontend/screens/MainScreen.js` (`renderSchedule(true)` 에 `paymentsList={SERVER_MODE ? <RecentPayments today={...} refreshKey={aiRefresh} /> : null}`)

**Interfaces:**
- **Consumes:** `loadRecentPayments`, `paymentRowText`.
- **Produces:** `RecentPayments({ today: 'YYYY-MM-DD', refreshKey })`

- [ ] **Step 1: 구현**
  - 제목 `최근 결제` 와 오른쪽 `더 보기 ›` 를 둔다.
  - 처음에 5건을 읽어 한 줄씩 보인다: when · 가게 · 금액 · 카드 · benefit(파란 글씨).
  - 상태 문구: 읽는 중엔 작은 표시, 실패하면 `결제 내역을 불러오지 못했어요` + `다시 시도`, 0건이면 `아직 결제 내역이 없어요`.
  - `더 보기` 는 `Modal`(아래에서 올라오는 시트)로 연다. 20건씩 `beforeId` = 마지막 id 로 더 읽고, 더 없으면 버튼을 숨긴다.
  - 홈에 돌아오거나(`refreshKey`) 앱이 다시 활성화되면 다시 읽는다.
- [ ] **Step 2: 확인** — 앱 node 시험 통과. 확인용 서버에서 Task 9 로 화면을 본다. 그 뒤 커밋: `git commit -m "앱: 홈 최근 결제와 더 보기"`

### Task 7: 데이터 11/26 연장 — 생성·비교 (사용자 확인 전까지)

**Files:**
- Create: `~/Desktop/solpay/db/extend_compare.py`, `~/Desktop/solpay/db/test_extend_compare.py` (git 밖, replace_rds.sh 와 같은 자리)
- 작업 폴더: `$W=<scratchpad>/extend_1126` (`data/` 사본, 새 팀 DB 폴더, 비교 결과)

**Interfaces:**
- **Produces:** `python extend_compare.py OLD_DIR NEW_DIR OUT_DIR`. 종료 코드는 0(넣을 수 있음) 또는 2(충돌, 멈춤)이다.
  - 표마다 키를 정한다.
    - `payments`·`payment_details`: payment_id
    - `payment_codes`: code_id
    - `pos_transactions`: txn_id
    - `merchants`: merchant_id
    - `terminals`: terminal_id
    - `card_month_status`: (user_card_id, year_month)
    - 나머지 표: 바이트 비교
  - **append** 표(앞의 다섯 표): 옛 키의 행은 모두 같아야 한다. 새 키의 행은 `OUT_DIR/<표>.csv` 로 쓴다.
  - **card_month_status:** `year_month < 2026-11` 행은 모두 같아야 한다. `2026-11` 의 바뀐 행과 새 행은 `OUT_DIR/card_month_status.csv` 로 쓴다(덮어쓸 행).
  - 바이트 비교 표는 `promotions` 만 예외로 무시한다(공식 폴더 것을 유지).
  - 결과는 `OUT_DIR/report.json` 에 표마다 `{same, added, changed, conflicts}` 와 결제 합계·데모 1~5 결제 수를 쓴다.

- [ ] **Step 1: 실패하는 시험** (`test_extend_compare.py`, tmp 폴더에 작은 CSV)
  - 같은 키·같은 내용 + 새 키 → 종료 0, 새 행만 출력.
  - 옛 키 내용이 다름 → 종료 2, conflicts 1.
  - card_month_status 2026-10 이 다름 → 종료 2. 2026-11 만 다름 → 0, 그 행 출력.
- [ ] **Step 2: 실패 확인** — `~/Desktop/solpay/data/.venv/bin/python -m pytest ~/Desktop/solpay/db/test_extend_compare.py -q` FAIL.
- [ ] **Step 3: 구현** 후 시험 PASS.
- [ ] **Step 4: 사본에서 생성**
  - `rsync -a --exclude 'out*' --exclude '.venv' ~/Desktop/solpay/data/ $W/data/` 로 복사한다.
  - 사본의 `config/settings.yml` 의 `as_of` 만 `2026-11-27T00:00:00+09:00` 로 바꾼다.
  - `cd $W/data && SOLPAY_DATA_VERSION=v2.1 ~/Desktop/solpay/data/.venv/bin/python -m generate.main` 로 생성한다.
  - 공식 v2.1 폴더의 `schema.sql`·`load_all.sql`·`테이블_명세서.csv`·`테스트_가이드.md` 를 `$W/카드서비스_DB_1년_v2.1` 에 먼저 복사한다.
  - `... -m generate.export_db ~/Desktop/solpay/카드서비스_DB $W/카드서비스_DB_1년_v2.1` 로 내보낸다.
  - Expected: 결제 약 112.8만 건(1,066,005 + 약 6.2만), 마지막 결제 2026-11-26.
- [ ] **Step 5: 비교** — `python extend_compare.py ~/Desktop/solpay/카드서비스_DB_1년_v2.1 $W/카드서비스_DB_1년_v2.1 $W/append`.
  - 종료 2 면 충돌 표·행 수를 정리해 **멈추고 사용자에게 묻는다**.
- [ ] **Step 6: 멈춤 — 사용자 확인**
  - 보여 줄 것: 표별 추가·덮어쓸 행 수, 결제 건수·합계 전후, 데모 1~5 결제 수 전후, 마지막 결제 시각.
  - 다음 Task 는 사용자의 "넣어도 돼"(같은 뜻) 뒤에만 한다.

### Task 8: 데이터 넣기 — 로컬 사본 시험 → solpay_v21 → 폴더 → RDS 안내

**Files:**
- Create: `~/Desktop/solpay/db/append_period.sh` (git 밖)
- Create: `~/Desktop/solpay/db/v2.1_11월26일_추가_안내.md`

**Interfaces:**
- **Consumes:** Task 7 의 `$W/append/*.csv`.
- **Produces:** `db/append_period.sh <호스트> <append 폴더> [계정 postgres] [DB solpay]`. 쓰는 방식은 replace_rds.sh 와 같다(docker postgres:16 psql, PGPASSWORD 묻기).
  - 한 트랜잭션에서 `SET lock_timeout='15s'` 를 건다.
  - **검사:** payments 최대 번호가 1,066,005 가 아니면 멈춘다(이미 넣었거나 다른 데이터). 칸 이름이 append CSV 머리줄과 같은지 본다.
  - **넣기:** merchants → terminals → payments → payment_details → payment_codes → pos_transactions 를 `\copy` 한다. card_month_status 는 임시 표로 받아 `INSERT … ON CONFLICT (user_card_id, year_month) DO UPDATE` 한다.
  - **자동 번호:** 표마다 `setval(pg_get_serial_sequence(...), max(...))` 로 맞춘다.
  - **실행 확인:** `CONFIRM=추가` 가 없으면 묻는다.

- [ ] **Step 1: 로컬 사본 시험**
  - `createdb -T solpay_v21 v21_append_test` 로 사본을 만든다. 사용자 서버가 붙어 있으면 템플릿 복사가 막히니, 그때는 `pg_dump | psql` 로 복사한다.
  - `PGSSLMODE=disable CONFIRM=추가 db/append_period.sh host.docker.internal $W/append solpay_app v21_append_test` 를 실행한다.
  - Expected: 결제 수 = report.json 의 새 합계, 최대 번호 = 새 최대, card_month_status 2026-11 값 = 새 폴더 값.
- [ ] **Step 2: 실패·중복 시험**
  - 같은 명령을 한 번 더 실행하면 '이미 넣음'으로 멈추고 행 수가 그대로여야 한다.
  - CSV 하나를 일부러 깨뜨려 실행하면 전체가 취소되고 행 수가 그대로여야 한다.
- [ ] **Step 3: 확인용 서버로 사본 검증**
  - 백엔드 8290 을 `DB_URL` 사본으로, AI 8231 을 `POSTGRES_DB=v21_append_test SOLPAY_ARTIFACTS=artifacts/v2.1` 로 띄운다.
  - Expected: 백엔드 validate 통과, `GET /api/payments?date=2026-11-23`(test1) 에 기준 시각까지의 결제가 나온다. AI 하루 배치 200.
- [ ] **Step 4: solpay_v21 에 넣기** — 사본과 같은 명령을 DB 이름만 바꿔 실행한다. 사용자 서버가 켜져 있어도 된다(INSERT 만). 끝나면 AI 를 다시 켜라고 안내한다.
- [ ] **Step 5: 팀 DB 폴더**
  - `~/Desktop/solpay/카드서비스_DB_1년_v2.1` 을 scratchpad 로 백업한다.
  - append 표들은 공식 CSV 에 새 행을 붙이고, card_month_status 는 2026-11 행을 바꾼다. 나머지 파일은 그대로다.
  - 붙인 결과가 `$W/카드서비스_DB_1년_v2.1` 의 같은 표와 행 집합이 같은지 확인한다.
- [ ] **Step 6: RDS 안내서**
  - 실행 명령, 실행 전 확인(`app_ai` 로 최대 번호 1,066,005), 실행 뒤 확인 쿼리(행 수·합계·최대 번호), 되돌리기를 적는다.
  - 되돌리기: `DELETE … WHERE payment_id > 1066005` 등 역순 쿼리 + card_month_status 백업 CSV 를 쓴다. 스크립트가 실행 전에 2026-11 행을 백업 폴더에 남기게 한다.

### Task 9: 합치기·전체 시험·화면 확인

- [ ] **Step 1: AI 브랜치 합치기** — final worktree 에서 `git fetch ~/Desktop/solpay ai/day-placement && git merge --no-ff FETCH_HEAD -m "ai/day-placement 를 합침: 하루 배치"`. Expected: 충돌 없음(solpay-ai 만 바뀜).
- [ ] **Step 2: 전체 시험**
  - final worktree 의 AI·백엔드·앱 전체 시험이 모두 통과해야 한다.
  - AI worktree 도 다시 한다.
- [ ] **Step 3: 확인용 서버** — AI 8231 은 `SOLPAY_STORE=db SOLPAY_DATABASE_URL= POSTGRES_DB=solpay_v21 SOLPAY_ARTIFACTS=artifacts/v2.1`, 토큰은 backend/.env 의 값으로 띄운다. 백엔드 8290(`AI_BASE_URL=http://localhost:8231`), 앱 19006(`EXPO_PUBLIC_API_URL=http://localhost:8290`)도 띄운다.
- [ ] **Step 4: 화면**
  - 데모 3·5 계정으로 로그인한다(사용자에게 패널에서 로그인해 달라고 한다).
  - 볼 것: 동그라미를 11시·14시로 끌면 큰 카드가 바뀌는지, `지금` 버튼, 결제 점을 누르면 `이 시각 결제`, 결제 버튼 막힘, 최근 결제 5건과 더 보기.
  - 모바일 폭(375)에서 스크린샷을 찍는다.
- [ ] **Step 5: 정리** — 확인용 서버를 끄고 worktree 는 그대로 둔다(합치기·푸시는 요청 때). 메모리를 갱신한다.

## 실행 순서 메모

- Task 1~6(코드)과 Task 7(데이터 생성·비교)은 서로 무관하다. Task 7 의 생성은 시간이 걸리므로 백그라운드로 먼저 돌려도 된다.
- Task 8 은 Task 7 의 사용자 확인 뒤에만 한다. Task 9 의 화면 확인은 Task 8 Step 4 뒤가 좋다(오늘 결제가 보인다). Task 8 이 늦어지면 기준 시각 고정(`AI_FIXED_AT=2026-11-04T...`) 없이 결제 점이 비는 것만 확인한다.
