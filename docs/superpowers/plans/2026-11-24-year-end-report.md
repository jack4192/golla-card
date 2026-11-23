# 연말 결산 화면 다시 만들기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연말 결산 화면이 올해 실제로 받은 혜택(결제 기록 합)과 AI 놓친 혜택(올해 1월부터, 1만 원 이상, 상위 3장)을 리포트형으로 보여 준다.

**Architecture:**
- **엔진:** `missed_benefit`이 '센 첫 달'과 '달 수'를 받을 수 있게 하고, API에 `start` 인자와 1만 원 기준을 더한다.
- **백엔드:** 기존 결제 읽기(`findBetween`)로 올해 결제를 읽어 Java에서 달별·카드별로 묶는 `/api/payments/year-summary`를 만든다. `/api/ai/missed-benefit?thisYear=true`는 엔진에 `start=올해 1월 1일`을 넘긴다.
- **앱:** 계산은 순수 함수 `yearEndCore.js`에 두고, `YearEndReport.js`는 두 API를 동시에 불러 그린다.

**Tech Stack:** Python 3 FastAPI(pytest), Spring Boot 4(JUnit5·AssertJ·MockMvc), Expo React Native web(`node --test`)

**Spec:** `/Users/jinwoo/Desktop/solpay/docs/superpowers/specs/2026-11-23-year-end-report-design.md`

## Global Constraints

**저장소와 테스트 명령**
- 엔진: `~/Desktop/solpay/solpay-ai`(브랜치 ai/placement-engine). 테스트는 `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q`.
- 백엔드: `~/Desktop/solpay-final/backend`(브랜치 final). 테스트는 `cd ~/Desktop/solpay-final/backend && ./gradlew test`. PaymentApiTest는 backend/.env의 로컬 DB(solpay_v21)가 필요하다.
- 앱: `~/Desktop/solpay-final/frontend`. 테스트는 `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs`.

**금지와 운영 규칙**
- 커밋과 푸시는 사용자가 요청할 때만 한다. `git add .`는 쓰지 않는다.
- 다른 세션이 손댄 파일은 건드리지 않는다: solpay의 `data/*`, final의 `.idea/`, `docs/superpowers/*place-classify*`.
- 공용 RDS에는 쓰지 않는다. `.env` 값은 출력하지 않는다.
- 사용자 서버 8031(AI), 8090(백엔드), 8081(앱)은 끄지 않는다. 확인용 서버는 8041(AI), 8099(백엔드), 19016(앱)으로 띄우고, 끝나면 끈다.
- 엔진 변경을 final의 `solpay-ai` 사본에 옮기는 일은 사용자가 커밋·합치기를 요청할 때 한다. 지금 두 사본의 recommend·service·api·params·tests는 같다.

**숫자 규칙**
- 놓친 혜택 숨김 기준: `Params.missed_min_gain = 10000`. gain이 이 값 **이상**이면 남긴다. 거른 뒤 상위 3장.
- 기간: 백엔드 시계(`DemoClock`, `ai.fixed-at`)가 가리키는 해의 1월 1일 00:00부터 기준 시각까지. 엔진의 `start`는 그 달 1일로 본다(백엔드는 늘 1월 1일을 넘긴다). 전달 1일부터 start 전까지의 결제는 실적만 쌓는다. months = start 달부터 at 달까지의 달 수.

**앱 문구 (그대로 쓴다)**
- 머리: '연말 결산' / '{연도}년 카드 결산' / '{M}월 {D}일 ~ {M}월 {D}일 · 결제 {N}건'
- 받은 혜택:
  - '올해 카드로 받은 혜택'
  - '카드 혜택 X원 · 가맹점 행사 Y원'(Y=0이면 '카드 혜택 X원')
  - '가장 많이 받은 달은 {M}월, {금액}원이에요'
- 올해 결제 없음: '올해 결제가 아직 없어요'
- 받은 혜택 실패: '결산을 불러오지 못했어요' + '다시 시도'
- 카드 목록: '혜택을 많이 준 카드'
- 놓친 혜택:
  - 머리: '이 카드였다면 더 받았어요' + 'AI 분석'
  - 꼬리표: '{replaces} 대신' / '지금 카드에 더해서' / '연회비 {금액}원 빼고 계산'
  - 버튼: '카드 보러 가기'
  - 불러오는 중: 'AI가 올해 결제를 다시 계산하고 있어요'
  - 실패: '놓친 혜택을 불러오지 못했어요' + '다시 시도'
  - 비었을 때: '지금 카드 조합이 잘 맞아요' / '올해 결제로 계산해 보니 1만 원 넘게 더 주는 신한카드가 없었어요.'
- 서버 모드가 아닐 때: '서버에 연결하면 결산을 볼 수 있어요'
- 계산 기준(접었다 펴기) 세 문장: 설계서 '계산 기준' 절 그대로.
- 홈 타일 설명과 설정 메뉴 설명: '올해 받은 혜택과 놓친 혜택을 확인해요'

## Review Focus

- **1월 초(start 달 = 이번 달)** → months 1, 막대 1개, 가장 많이 받은 달 1월. Task 5 `peakAndBarsWithOneMonth`.
- **결제는 있는데 받은 혜택이 모두 0원** → '가장 많이 받은 달' 줄을 숨긴다('0원이에요'를 쓰지 않음). Task 5 `peakLineHiddenWhenAllZero`.
- **AI가 배열이 아닌 JSON을 줌**(엔진 오류가 그대로 넘어옴) → 놓친 혜택만 실패 상태가 되고 화면은 멈추지 않는다. Task 5 `missedViewNonArrayIsError`.
- **카드 이름이 앱 카드 목록에 없음** → 그림과 '카드 보러 가기' 없이 이름과 금액만 보인다. Task 5 `findCatalogCardMissing`.
- **기준 시각 이후의 가상 결제(11/24~11/26)** → 합에서 빠진다. Task 3 `yearSummaryRange`(읽는 끝이 기준 시각)와 PaymentApiTest `yearSummary`(until).

---

### Task 1: 엔진 — `missed_benefit`의 센 첫 달·달 수

**Files:**
- Modify: `~/Desktop/solpay/solpay-ai/engine/recommend.py:235-276`
- Test: `~/Desktop/solpay/solpay-ai/tests/test_mentoring.py` (파일 끝에 추가)

**Interfaces:**
- Produces: `missed_benefit(state, rows, threshold=300, swap=True, only=None, count_from: tuple[int, int] | None = None, months: int | None = None) -> list[dict]`
  - count_from=None: 지금 동작(첫 결제 달은 준비 달, months = 결제 달 수 − 1).
  - count_from=(연, 월): 그 달 이상의 결제만 혜택을 센다(앞 달 결제는 실적만). months가 None이면 count_from 달부터 마지막 결제 달까지의 달 수.
  - count_from 이상인 결제 달이 없으면 [].
  - 연회비 몫과 문장은 이 months를 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_mentoring.py` 위쪽 import에 `datetime`과 `from tests.conftest import KST`를 더하고, 끝에 아래를 붙인다.

```python
# 2026-11-24 연말 결산: 센 첫 달을 정하면 앞 달 결제는 실적만 쌓고 그 달부터 센다
def _cvs(months, amount=100_000):
    return [pay(101, amount, "CVS", datetime(y, m, d, 12, tzinfo=KST)) for (y, m) in months for d in (10, 11, 12, 13)]


def test_센_첫_달을_주면_앞_달은_실적만_쌓는다(state):
    rows = _cvs([(2026, m) for m in (6, 7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7)) if m["card_id"] == 4)
    assert card4["months"] == 4 and card4["gain"] == 4 * 500


def test_센_첫_달_앞에_결제가_없어도_그_달부터_센다(state):
    rows = _cvs([(2026, m) for m in (7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7)) if m["card_id"] == 4)
    assert card4["months"] == 4 and card4["gain"] == 4 * 500         # 기본(첫 달은 준비)이면 3개월 1,500원


def test_달_수를_주면_그_달_수로_말한다(state):
    rows = _cvs([(2026, m) for m in (7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7), months=5) if m["card_id"] == 4)
    assert card4["months"] == 5
    assert card4["message"] == "그때 이 카드를 발급받으셨다면 5개월 동안 2,000원을 더 받으셨어요"


def test_센_첫_달부터_결제가_없으면_빈_목록이다(state):
    assert missed_benefit(state, _cvs([(2026, 7)]), count_from=(2026, 8)) == []
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q tests/test_mentoring.py -k "센_첫_달 or 달_수를"`
Expected: 4 failed, `TypeError: missed_benefit() got an unexpected keyword argument 'count_from'`

- [ ] **Step 3: 구현** — `engine/recommend.py`의 `missed_benefit`에 두 키워드 인자를 더한다.
  - count_from이 있으면 기존 `count_from, months = keys[1], len(keys) - 1` 대신 주어진 count_from을 쓴다.
  - months가 None이면 `(마지막 키 연*12+월) − (count_from 연*12+월) + 1`로 구한다.
  - `max(keys) < count_from`이면 []를 돌려준다.
  - `len(keys) < 2` 검사는 count_from이 None일 때만 한다.
  - docstring에 '2026-11-24 연말 결산: count_from·months' 한 줄을 더한다.

- [ ] **Step 4: 통과 확인**

Run: `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q tests/test_mentoring.py tests/test_recommendation_page.py`
Expected: 모두 통과(새 4개 포함, 기존 연말정산·추천 페이지 테스트 그대로)

---

### Task 2: 엔진 — 서비스 `start`·1만 원 기준·API 인자

**Files:**
- Modify: `~/Desktop/solpay/solpay-ai/engine/params.py` (Params 필드), `engine/service.py:615-622`, `engine/api.py:410-416`
- Test: `~/Desktop/solpay/solpay-ai/tests/test_service_api.py` (파일 끝에 추가)

**Interfaces:**
- Consumes: Task 1의 `missed_benefit(..., count_from, months)`
- Produces:
  - `Params.missed_min_gain: int = 10000`
  - `PlacementService.missed_benefit(user_id: int, at: datetime, days: int = 365, start: date | None = None) -> list[dict]`
  - `GET /internal/users/{user_id}/missed-benefit?at=&days=&start=YYYY-MM-DD`
- 동작:
  - start가 있으면 결제 범위는 [start 달의 전달 1일 00:00 KST, at), count_from=(start.year, start.month), months=(at 연*12+월) − (start 연*12+월) + 1.
  - start가 없으면 지금처럼 [at − days, at)이다.
  - 둘 다 결과에서 `gain >= missed_min_gain`만 남기고 상위 3장.

- [ ] **Step 1: 실패하는 테스트 작성** — import에 `from dataclasses import replace`, `from datetime import date, datetime`, `from engine.params import Params`, `KST`(conftest)를 더하고, 끝에 붙인다.

```python
# 2026-11-24 연말 결산: 시작일(올해 1월 1일)부터, 1만 원 미만은 숨긴다
NOV_MAR = [(2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3)]
AT = "2026-03-20T12:00:00+09:00"


def _cvs(months, amount):
    return [pay(101, amount, "CVS", datetime(y, m, d, 12, tzinfo=KST)) for (y, m) in months for d in (10, 11, 12, 13)]


def test_놓친_혜택은_시작일을_주면_그_달부터_센다(svc):
    svc.store.payments = _cvs(NOV_MAR, 1_000_000)
    with client(svc) as c:
        r = c.get("/internal/users/1/missed-benefit", params={"at": AT, "start": "2026-01-01"}).json()
    assert [(m["card_id"], m["months"], m["gain"]) for m in r] == [(4, 3, 60_000)]
    assert r[0]["message"] == "그때 이 카드를 발급받으셨다면 3개월 동안 60,000원을 더 받으셨어요"


def test_놓친_혜택은_시작일이_없으면_지금처럼_days_로_센다(svc):
    svc.store.payments = _cvs(NOV_MAR, 1_000_000)
    with client(svc) as c:
        r = c.get("/internal/users/1/missed-benefit", params={"at": AT}).json()
    assert [(m["card_id"], m["months"], m["gain"]) for m in r] == [(4, 4, 80_000)]


def test_놓친_혜택은_기준_금액_이상만_남긴다(catalog, priors, params):
    for min_gain, expected in ((60_000, [4]), (60_001, [])):
        store = FakeStore(User(1))
        store.payments = _cvs(NOV_MAR, 1_000_000)
        s = PlacementService(store, PlacementEngine(catalog, priors, replace(params, missed_min_gain=min_gain)))
        got = s.missed_benefit(1, datetime(2026, 3, 20, 12, tzinfo=KST), start=date(2026, 1, 1))
        assert [m["card_id"] for m in got] == expected


def test_놓친_혜택은_기본_1만_원_미만이면_빈_목록이다(svc):
    svc.store.payments = _cvs(NOV_MAR, 100_000)                      # 3개월 6,000원
    with client(svc) as c:
        assert c.get("/internal/users/1/missed-benefit", params={"at": AT, "start": "2026-01-01"}).json() == []
    assert Params().missed_min_gain == 10_000
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q tests/test_service_api.py -k "놓친_혜택"`
Expected: 실패한다. 시작일 테스트는 start가 무시되어 (4, 4, 80_000)이 나오고, replace/Params는 `missed_min_gain` 없음 오류가 난다.

- [ ] **Step 3: 구현** — Params에 `missed_min_gain: int = 10000`을 더한다(주석: 연말 결산 놓친 혜택 숨김 기준, 2026-11-24 사용자 결정). 그다음 `service.missed_benefit`에 start를 더하고, 필터를 `>= self.engine.params.missed_min_gain`으로 바꾼다. 마지막으로 `api.py`의 `missed`에 `start: date | None = None`을 더해 넘긴다(`from datetime import date`).

- [ ] **Step 4: 엔진 전체 통과 확인**

Run: `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q`
Expected: 모두 통과. 실패가 있으면 이 변경과 관계있는지 이름별로 적는다. DB가 필요한 test_db_store·test_pg_store는 로컬 solpay_test 상태에 달려 있다.

---

### Task 3: 백엔드 — `/api/payments/year-summary`

**Files:**
- Create: `backend/src/main/java/com/paymate/backend/payment/dto/YearSummaryResponse.java`
- Modify: `backend/src/main/java/com/paymate/backend/payment/service/PaymentService.java`, `payment/controller/PaymentController.java`
- Test: `backend/src/test/java/com/paymate/backend/payment/PaymentServiceTest.java`, `PaymentApiTest.java`

**Interfaces:**
- Produces:
  - `record YearSummaryResponse(int year, String from, String until, int count, long benefit, long promotion, long total, List<MonthSum> months, List<CardSum> cards)`
  - 안에 둔 `record MonthSum(String month, int count, long benefit, long promotion, long total)`
  - 안에 둔 `record CardSum(Long userCardId, String cardName, int count, long benefit, long promotion, long total)`
  - `PaymentService.yearSummary(Long userId) -> YearSummaryResponse`
  - `GET /api/payments/year-summary` (로그인 필요)
- 동작:
  - now = clock.now()를 초 단위로 자른다.
  - `payments.findBetween(userId, now의 해 1월 1일 00:00, now)`로 읽는다(홈과 같은 쿼리).
  - months는 1월부터 now의 달까지 빠짐없이 'YYYY-MM'으로 넣는다(paidAt 앞 7자로 묶음).
  - cards는 total 내림차순, 같으면 userCardId 오름차순이다.
  - null 혜택·행사는 0으로 센다.
  - until 형식은 `yyyy-MM-dd'T'HH:mm:ss`이다.

- [ ] **Step 1: 실패하는 단위 테스트 작성** — `FakeRepository.rows`의 `final`을 떼어 테스트가 바꿀 수 있게 하고, 아래를 더한다.

```java
@Test
@DisplayName("올해 결산: 1월 1일부터 기준 시각까지 읽는다")
void yearSummaryRange() {
    YearSummaryResponse s = service("2026-03-05T10:15:30").yearSummary(1L);
    assertThat(repository.between.get(0)).containsExactly(1L, LocalDateTime.of(2026, 1, 1, 0, 0),
            LocalDateTime.of(2026, 3, 5, 10, 15, 30));
    assertThat(s.year()).isEqualTo(2026);
    assertThat(s.from()).isEqualTo("2026-01-01");
    assertThat(s.until()).isEqualTo("2026-03-05T10:15:30");
}

@Test
@DisplayName("올해 결산: 합계, 빈 달은 0, 카드는 받은 혜택 큰 순, 빈 혜택은 0")
void yearSummarySums() {
    repository.rows = List.of(
            new Row(1L, "2026-01-03T09:00:00", "스타벅스", "CAFE", "카페", 5400, 540, 0, 3L, "신한 모두의카드"),
            new Row(2L, "2026-01-20T12:00:00", "이마트", "MART", "마트", 50000, 1000, 500, 2L, "KB ALL 카드"),
            new Row(3L, "2026-03-01T08:00:00", "GS25", "CVS", "편의점", 3000, null, null, 3L, "신한 모두의카드"));
    YearSummaryResponse s = service("2026-03-05T10:15:30").yearSummary(1L);
    assertThat(s.count()).isEqualTo(3);
    assertThat(s.benefit()).isEqualTo(1540L);
    assertThat(s.promotion()).isEqualTo(500L);
    assertThat(s.total()).isEqualTo(2040L);
    assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::month).containsExactly("2026-01", "2026-02", "2026-03");
    assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::total).containsExactly(2040L, 0L, 0L);
    assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::count).containsExactly(2, 0, 1);
    assertThat(s.cards()).extracting(YearSummaryResponse.CardSum::userCardId).containsExactly(2L, 3L);
    assertThat(s.cards()).extracting(YearSummaryResponse.CardSum::total).containsExactly(1500L, 540L);
    assertThat(s.cards().get(1).count()).isEqualTo(2);
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay-final/backend && ./gradlew test --tests 'com.paymate.backend.payment.PaymentServiceTest'`
Expected: 컴파일 실패(`YearSummaryResponse`·`yearSummary` 없음)

- [ ] **Step 3: 구현** — DTO 파일, `PaymentService.yearSummary`, 컨트롤러 `@GetMapping("/year-summary")`(설명 주석: 연말 결산 받은 혜택, 2026-11-24)를 만든다.

- [ ] **Step 4: 단위 테스트 통과 확인** — 같은 명령. Expected: PASS

- [ ] **Step 5: API 테스트 추가(로컬 DB)** — `PaymentApiTest`(기준 시각 2026-11-04T12:00:00)에 더한다.
  - `yearSummaryNeedsLogin`: 토큰 없이 `/api/payments/year-summary` → 401.
  - `yearSummary`: token(1)로 → 200. 다음을 확인한다.
    - `$.year`=2026, `$.from`="2026-01-01", `$.until`="2026-11-04T12:00:00"
    - `$.months.length()`=11, `$.count`>0
    - `$.cards[*].userCardId` 모두 [1,2,3,4] 안
    - JsonNode로 읽어 total == benefit + promotion, months의 total 합 == total, cards의 total 합 == total.

Run: `cd ~/Desktop/solpay-final/backend && ./gradlew test --tests 'com.paymate.backend.payment.*'`
Expected: PASS

---

### Task 4: 백엔드 — `/api/ai/missed-benefit?thisYear=true`

**Files:**
- Modify: `backend/src/main/java/com/paymate/backend/ai/AiService.java:119-123`, `ai/AiController.java:134-139`
- Test: `backend/src/test/java/com/paymate/backend/ai/AiServiceTest.java`

**Interfaces:**
- Produces: `AiService.missedBenefit(Long userId, Integer days, boolean thisYear) -> String`.
  - thisYear이면 쿼리에 `start=today()의 해-01-01`을 넣고 days는 넣지 않는다.
  - 아니면 지금처럼 days를 넣는다.
- 컨트롤러는 `@RequestParam(value = "thisYear", defaultValue = "false") boolean thisYear`를 받는다. 기존 2인자 호출부는 모두 3인자로 바꾼다(`grep -rn "missedBenefit(" backend/src`).

- [ ] **Step 1: 실패하는 테스트 작성**

```java
@Test
@DisplayName("연말 결산: thisYear 면 올해 1월 1일을 start 로 넘기고 days 는 넘기지 않는다")
void missedBenefitThisYear() {
    service = service("2026-11-05T09:30:00");
    ai.reply("/internal/users/7/missed-benefit", 200, "[]");

    assertThat(service.missedBenefit(7L, null, true)).isEqualTo("[]");
    assertThat(ai.last().path()).isEqualTo("/internal/users/7/missed-benefit");
    assertThat(ai.last().query()).contains("at=2026-11-05T09:30:00").contains("start=2026-01-01").doesNotContain("days");

    service.missedBenefit(7L, 30, false);
    assertThat(ai.last().query()).contains("days=30").doesNotContain("start");
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay-final/backend && ./gradlew test --tests 'com.paymate.backend.ai.AiServiceTest'`
Expected: 컴파일 실패(3인자 메서드 없음)

- [ ] **Step 3: 구현** — AiService와 AiController를 바꾼다. 컨트롤러 주석을 '연말 결산: 놓친 혜택 상위 3장 (thisYear=true 면 올해 1월 1일부터)'으로 고친다.

- [ ] **Step 4: 백엔드 전체 통과 확인**

Run: `cd ~/Desktop/solpay-final/backend && ./gradlew test`
Expected: BUILD SUCCESSFUL. 실패가 있으면 이름별로 적는다.

---

### Task 5: 앱 — `utils/yearEndCore.js`

**Files:**
- Create: `frontend/utils/yearEndCore.js`, `frontend/utils/__tests__/yearEndCore.test.mjs`

**Interfaces (모두 named export, React Native import 없음):**
- `won(n: number) -> string` — `540440 → '540,440원'`
- `periodLine(summary) -> string` — from·until·count로 기간 줄을 만든다.
- `splitLine(summary) -> string`
- `peakLine(months) -> string | null` — 가장 큰 total의 달. 같으면 앞 달. 모두 0이거나 비었으면 null.
- `barRatios(months) -> number[]` — total / 최댓값. 최댓값이 0이면 모두 0.
- `monthLabel(month: 'YYYY-MM') -> string` — '6월'.
- `topCards(cards, n = 3) -> cards` — total > 0만 앞에서 n장.
- `missedTags(item) -> string[]`
- `missedView(result) -> { state: 'ready' | 'empty' | 'error', items: object[] }` — 배열이 아니면 error.
- `findCatalogCard(catalog, name) -> product | null` — 앞뒤 공백을 뗀 이름이 같은 것.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { barRatios, findCatalogCard, missedTags, missedView, monthLabel, peakLine, periodLine, splitLine, topCards, won } from '../yearEndCore.js';

const summary = { year: 2026, from: '2026-01-01', until: '2026-11-23T14:05:00', count: 1633, benefit: 533440, promotion: 7000, total: 540440 };
const months = [{ month: '2026-05', total: 60140 }, { month: '2026-06', total: 64110 }, { month: '2026-07', total: 64110 }];

test('wonAndPeriod', () => {
  assert.equal(won(540440), '540,440원');
  assert.equal(periodLine(summary), '1월 1일 ~ 11월 23일 · 결제 1,633건');
  assert.equal(monthLabel('2026-06'), '6월');
});

test('splitLineHidesZeroPromotion', () => {
  assert.equal(splitLine(summary), '카드 혜택 533,440원 · 가맹점 행사 7,000원');
  assert.equal(splitLine({ ...summary, promotion: 0 }), '카드 혜택 533,440원');
});

test('peakLinePicksEarliestLargest', () => {
  assert.equal(peakLine(months), '가장 많이 받은 달은 6월, 64,110원이에요');
});

test('peakLineHiddenWhenAllZero', () => {
  assert.equal(peakLine([{ month: '2026-01', total: 0 }, { month: '2026-02', total: 0 }]), null);
  assert.equal(peakLine([]), null);
  assert.deepEqual(barRatios([{ month: '2026-01', total: 0 }]), [0]);
});

test('peakAndBarsWithOneMonth', () => {
  assert.equal(peakLine([{ month: '2026-01', total: 1200 }]), '가장 많이 받은 달은 1월, 1,200원이에요');
  assert.deepEqual(barRatios([{ month: '2026-01', total: 1200 }]), [1]);
  assert.deepEqual(barRatios([{ month: '2026-01', total: 50 }, { month: '2026-02', total: 100 }]), [0.5, 1]);
});

test('topCardsDropsZero', () => {
  const cards = [{ userCardId: 2, total: 900 }, { userCardId: 3, total: 500 }, { userCardId: 4, total: 0 }, { userCardId: 5, total: 100 }, { userCardId: 6, total: 50 }];
  assert.deepEqual(topCards(cards).map(c => c.userCardId), [2, 3, 5]);
});

test('missedTagsSwapAndAdd', () => {
  assert.deepEqual(missedTags({ basis: 'swap', replaces: 'KB ALL 카드', annual_fee: 15000, months: 11 }),
    ['KB ALL 카드 대신', '연회비 13,750원 빼고 계산']);
  assert.deepEqual(missedTags({ basis: 'add', replaces: null, annual_fee: 0, months: 11 }), ['지금 카드에 더해서']);
  assert.deepEqual(missedTags({ basis: 'add', replaces: null, annual_fee: 47000, months: 7 }),
    ['지금 카드에 더해서', '연회비 27,417원 빼고 계산']);
});

test('missedViewNonArrayIsError', () => {
  assert.deepEqual(missedView({ detail: '없는 사용자입니다' }), { state: 'error', items: [] });
  assert.deepEqual(missedView(null), { state: 'error', items: [] });
  assert.deepEqual(missedView([]), { state: 'empty', items: [] });
  assert.equal(missedView([{ card_id: 1 }]).state, 'ready');
});

test('findCatalogCardMissing', () => {
  const catalog = [{ name: '신한카드 Discount Plan', code: 'SH_DISCOUNT_PLAN' }];
  assert.equal(findCatalogCard(catalog, ' 신한카드 Discount Plan ').code, 'SH_DISCOUNT_PLAN');
  assert.equal(findCatalogCard(catalog, '없는 카드'), null);
  assert.equal(findCatalogCard(catalog, undefined), null);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/yearEndCore.test.mjs`
Expected: FAIL(`Cannot find module '../yearEndCore.js'`)

- [ ] **Step 3: 구현** — 위 시그니처대로 쓴다. 연회비는 `Math.round(annual_fee * months / 12)`. 날짜는 문자열을 잘라 쓴다(시간대 변환 없음).

- [ ] **Step 4: 통과 확인**

Run: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs`
Expected: 모두 통과(기존 파일 포함)

---

### Task 6: 앱 — 화면 `YearEndReport.js`, API 호출, 문구

**Files:**
- Modify: `frontend/utils/api.js` (api 객체에 두 함수)
- Rewrite: `frontend/components/YearEndReport.js` (기존 210줄: savingsRecords·MissedSheet 제거)
- Modify: `frontend/screens/MainScreen.js:567`(홈 타일 설명), `:759`(설정 메뉴 설명)

**Interfaces:**
- Consumes: Task 3·4의 API, Task 5의 함수, `CARD_CATALOG_40`(`../data/cardCatalog40`), `officialProduct(code)`(`../screens/RoutinePatternRecommendationScreen`), `SERVER_MODE`.
- Produces:
  - `api.paymentsYearSummary()` → `request('/api/payments/year-summary', { auth: true, timeout: AI_CHAT_TIMEOUT_MS })`
  - `api.aiMissedBenefit()` → `request('/api/ai/missed-benefit?thisYear=true', { auth: true, timeout: AI_CHAT_TIMEOUT_MS })`
  - `<YearEndReport visible onClose />`는 props를 그대로 둔다(MainScreen 호출 그대로).

- [ ] **Step 1: api.js에 두 함수 추가**(`paymentsRecent` 아래).
- [ ] **Step 2: YearEndReport.js 새로 짜기** — 설계서 'A안' 순서와 Global Constraints 문구를 따른다.
  - **불러오기:** visible이 true가 될 때마다 두 호출을 `Promise.allSettled`처럼 따로 시작한다. 상태는 `summary: {state:'loading'|'ready'|'error', data}`와 `missed: {state:'loading'|'ready'|'empty'|'error', items}`를 따로 둔다. 각 '다시 시도'는 자기 호출만 다시 한다. 닫힌 뒤 도착한 응답은 버린다.
  - **서버 모드가 아닐 때:** 안내 문구만 보여 준다.
  - **올해 결제가 없을 때:** summary.count === 0이면 '올해 결제가 아직 없어요'를 보여 주고, 카드 목록과 놓친 혜택을 숨긴다.
  - **막대:** View 높이(최대 56px) × barRatios. 가장 큰 달은 진한 파랑(#1459F5), 나머지는 옅은 파랑(#C9D8FB). 아래에 첫 달과 마지막 달 이름을 쓴다.
  - **놓친 혜택:**
    - 1위는 큰 카드다. 카드 그림(findCatalogCard → image, 없으면 Ionicons card-outline), 이름, '+{gain}원', message, missedTags 꼬리표, '카드 보러 가기'(officialProduct(code)가 있을 때만, `Linking.openURL(product.url)`).
    - 2·3위는 한 줄씩이고, 누르면 펼쳐져 같은 내용을 보여 준다.
  - **계산 기준:** 접었다 펴기, 처음에는 접힘.
  - **스타일:** 기존 색 계열(배경 #F6F8FC, 남색 #1B2C47·#16305A, 흰 카드 radius 20)을 따른다. 받은 혜택 카드는 남색 바탕(#16305A)에 흰 글씨. 최대 너비 640.
- [ ] **Step 3: MainScreen 두 설명을 '올해 받은 혜택과 놓친 혜택을 확인해요'로 바꾸기.**
- [ ] **Step 4: 정적 확인**

Run: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs && grep -n "savingsRecords\|MissedSheet" components/YearEndReport.js`
Expected: 테스트 통과, grep 결과 없음

---

### Task 7: 화면 확인 (확인용 포트)

**Files:** 없음(확인만)

- [ ] **Step 1: 확인용 서버 띄우기** — 백그라운드로 띄우고, 사용자 서버는 그대로 둔다.
  - AI 8041: `cd ~/Desktop/solpay/solpay-ai && SOLPAY_STORE=db SOLPAY_DATABASE_URL= POSTGRES_DB=solpay_v21 SOLPAY_ARTIFACTS=artifacts/v2.1 SOLPAY_INTERNAL_TOKEN="$(grep '^AI_INTERNAL_TOKEN=' ~/Desktop/solpay-final/backend/.env | cut -d= -f2-)" .venv/bin/python -m uvicorn engine.api:app --port 8041`
  - 백엔드 8099: `cd ~/Desktop/solpay-final/backend && SERVER_PORT=8099 AI_BASE_URL=http://localhost:8041 CORS_ALLOWED_ORIGINS=http://localhost:19016 ./gradlew bootRun`
  - 앱 19016: `cd ~/Desktop/solpay-final/frontend && EXPO_PUBLIC_API_URL=http://localhost:8099 npx expo start --web --port 19016`
- [ ] **Step 2: API 숫자 대조** — test1 로그인 토큰으로 두 API를 부르고 아래를 확인한다.
  - year-summary의 total이 로컬 DB 합(`benefit_amount + promotion_amount`, 2026-01-01 ~ 기준 시각)과 같다.
  - missed-benefit은 months=11이다.
  - test4는 1장(Simple Plan)만 나온다.
- [ ] **Step 3: 브라우저 확인(내장 브라우저, 19016)** — test1로 들어가 홈 '올해 카드 결산'을 연다.
  - 받은 혜택·막대·카드 목록·놓친 혜택 1위 크게, 2·3위 펼치기, 계산 기준 펼치기, '카드 보러 가기'가 보이는지 본다.
  - 콘솔 오류가 없는지 본다.
  - 휴대폰 너비(375)에서도 본다.
- [ ] **Step 4: 실패 상태 확인** — AI 8041을 끄고 화면을 다시 연다. 받은 혜택은 보이고, 놓친 혜택만 '불러오지 못했어요'와 '다시 시도'가 나와야 한다. AI를 다시 켜고 '다시 시도'를 누르면 결과가 나와야 한다.
- [ ] **Step 5: 확인용 서버 끄기**(8041·8099·19016만). 스크린샷을 사용자에게 보낸다.

## 끝난 뒤 (사용자가 요청할 때)

- 엔진(solpay ai/placement-engine)과 final(백엔드·앱·solpay-ai 사본)을 각각 커밋한다. 파일을 하나씩 `git add`한다.
- final로 엔진을 옮기는 일과 푸시는 사용자 요청에 따른다.
- 사용자 서버(8031·8090)는 새 코드로 다시 켜야 반영된다. 명령은 `cd <폴더> &&` 형식으로 안내한다.
