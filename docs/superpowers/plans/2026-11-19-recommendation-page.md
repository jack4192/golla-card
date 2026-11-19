# 맞춤 추천 페이지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일정 저장(또는 건너뛰기) 뒤 뜨는 추천 페이지의 카드사 추천 탭·가맹점 추천 탭 내용을 엔진이 고르고, 문구는 OpenAI 가 쓰는 `POST /internal/users/{id}/recommendation-page` 를 solpay-ai 에 추가한다.

**Architecture:** 엔진 쪽 순수 함수(`engine/page.py`)가 오늘 볼 항목·카드날·카드·행사를 정해 `Page` 를 만들고, `engine/chat/page_copy.py` 가 그 사실로 OpenAI 문구를 받아 검사한다(실패 시 템플릿). `PlacementService.recommendation_page` 가 둘을 묶고 (사용자, 날짜)마다 결과를 메모리에 둔다.

**Tech Stack:** Python 3.12, FastAPI, openai SDK(Chat Completions, JSON 스키마 응답), pytest, uv.

**Spec:** `docs/superpowers/specs/2026-11-19-recommendation-page-design.md`

모든 경로는 `~/Desktop/solpay/solpay-ai` 기준. 테스트 실행: `cd ~/Desktop/solpay/solpay-ai && uv run pytest <파일> -q`.

## Global Constraints

- 카드날 = 오늘 이전 마지막 카드 추천에서 3일(`params.recommend_interval_days`) 이상 지났거나 기록 없음. 오늘 기록과 `page_fallback` 기록은 세지 않는다. 날짜 비교는 KST 날짜.
- 카드날: 탭 = [카드?, 가맹점?]. 카드날 아님: 행사 있으면 [가맹점], 없으면 [카드?]. 탭이 비면 페이지를 건너뛴다.
- 카드 기준: 오늘 항목에서 보유 카드보다 더 받는 금액 합 > 0 이면 추천. 순서: 더 받는 금액 큰 순 → 연회비 낮은 순 → card_id.
- 후보: 미보유 신한카드 − `recommend.RESTRICTED` − 지난 30일(`params.recommend_same_card_days`) 안에 추천한 카드(오늘 기록 제외).
- 후보 카드는 전월 실적 = `catalog.first_tier(card_id) or 0` 으로 계산한다. 보유 카드는 이번 달 실제 장부.
- 행사: 기존 `popup.promotion_offers`, 최대 `params.popup_promotions`(2)건.
- 기록 trigger: 카드날 `page_cycle`, 대신 보여 준 카드 `page_fallback`. 같은 날 같은 카드는 한 번만 기록.
- 평소 소비 항목: 최근 30일 현장 결제(`is_placement`) 건수 상위 3업종, 금액 = 중앙값을 100원 단위 반올림, 시각 = 결제 시각 중앙값의 정시(지났으면 지금) 부터 1시간, item_id = -1, -2, -3.
- 문구: `gpt-4o-mini`(`OPENAI_MODEL`), 제한 시간 8초(`PAGE_COPY_TIMEOUT_SEC`), 길이 title ≤ 22, summary ≤ 70, amount_label ≤ 28, reason ≤ 45, reasons 1~3개.
- LLM 에 사용자 번호·이름을 보내지 않는다.
- 문구·주석은 기존 코드처럼 한국어. 커밋은 사용자가 요청할 때만 (커밋 단계 없음).

## Review Focus

1. 일정은 저장했지만 지금 시각에 이미 모두 끝난 일정 → 평소 소비 항목으로 넘어가야 한다. (Task 1 `test_남은_일정이_없으면_평소_소비`)
2. 신한카드가 하나도 없는 사용자 → 행사가 없으므로 카드 탭만(카드날 아니어도). (Task 3 `test_신한카드가_없으면_카드_탭만`)
3. 사용자가 삭제한 보유 카드(`UserCard.excluded`)는 '지금 카드 최고 혜택'에 넣지 않는다. (Task 2 `test_삭제한_보유_카드는_비교에서_뺀다`)
4. DB 가 추천 시각을 UTC 로 돌려줄 때 KST 자정 근처 기록의 날짜가 틀리면 안 된다. (Task 1 `test_UTC_기록도_KST_날짜로_센다`)
5. LLM 이 JSON 은 맞지만 행사 문구 수가 다르거나 카드 문구를 빼먹음 → 템플릿. (Task 4 `test_탭_구성이_다르면_실패`)

---

### Task 1: 오늘 볼 항목과 카드날 (`engine/page.py`)

**Files:**
- Create: `engine/page.py`
- Test: `tests/test_recommendation_page.py`

**Interfaces:**
- Consumes: `engine.domain.Payment, ScheduleItem`, `engine.catalog.Catalog.brand_of`, `engine.params.Params`
- Produces:
  - 상수 `CYCLE = "page_cycle"`, `FALLBACK = "page_fallback"`, `PATTERN_DAYS = 30`, `PATTERN_TOP = 3`
  - `usual_brand(payments: list[Payment], catalog: Catalog, category: str, at: datetime) -> str | None` — 최근 30일 그 업종 결제(현장 여부 무관)에서 가장 많이 간 브랜드 코드, 같으면 이름 순
  - `pattern_items(payments: list[Payment], catalog: Catalog, at: datetime, user_id: int) -> list[ScheduleItem]`
  - `today_items(schedules: list[ScheduleItem], payments: list[Payment], catalog: Catalog, at: datetime, params: Params, user_id: int) -> tuple[str, list[ScheduleItem]]` — `("schedule", 남은 일정)` 또는 `("pattern", 평소 소비 항목)`. 남은 일정 = `end + schedule_tail_min ≥ at`
  - `is_card_day(history: list[dict], at: datetime, params: Params) -> bool`
  - `recently_recommended(history: list[dict], at: datetime, params: Params) -> set[int]` — 오늘 이전 30일 안 card_id

- [ ] **Step 1: 테스트 파일 머리와 Task 1 테스트를 쓴다**

테스트 카탈로그는 Task 2·3·5 가 같이 쓴다.

```python
"""맞춤 추천 페이지 (설계서 2026-11-19-recommendation-page-design.md)."""

from datetime import datetime, timedelta, timezone

from engine.benefit_calc import Benefit, Card
from engine.catalog import Catalog
from engine.domain import Merchant, Promotion, ScheduleItem, User, UserCard
from engine.params import Params
from engine.page import CYCLE, FALLBACK, is_card_day, pattern_items, today_items, usual_brand
from engine.state import UserState
from tests.conftest import KST, at, pay

MEGA, OTHER, STAR, GS = 50, 52, 53, 54
NOW = at(10, 7, 9)                                   # 2026-10-07(수) 09:00


def page_catalog() -> Catalog:
    """보유 1: 메가커피 10%(7~15시, 건당 1천 원) / 보유 3: KB 1%
    후보 9: 스타벅스·메가커피 10%(건당 1천 원, 전월 30만 원 이상), 연회비 12,000원
    후보 8: GS 주유 5%, 연회비 0원"""
    cards = {
        1: Card(1, "DP", "SHINHAN", "Discount Plan+", "credit", (), 0, {},
                (Benefit(1, "CAFE", "discount", rate=0.10, max_per_tx=1_000, hours=(7, 15), brands=frozenset({"MEGA"})),)),
        3: Card(3, "KA", "KB", "KB ALL", "credit", (), 0, {}, (Benefit(3, "*", "discount", rate=0.01),)),
        9: Card(9, "NEW_CAFE", "SHINHAN", "새 카페 카드", "credit", (), 12_000, {},
                (Benefit(9, "CAFE", "discount", rate=0.10, max_per_tx=1_000, min_prev=300_000,
                         brands=frozenset({"STAR", "MEGA"}), name="카페 10% 할인"),)),
        8: Card(8, "NEW_FUEL", "SHINHAN", "새 주유 카드", "credit", (), 0, {},
                (Benefit(8, "FUEL", "discount", rate=0.05, brands=frozenset({"GS"}), name="주유 5% 할인"),)),
    }
    merchants = {MEGA: Merchant(MEGA, "메가MGC커피 역삼점", "CAFE", brand="메가MGC커피", brand_code="MEGA"),
                 OTHER: Merchant(OTHER, "동네 카페", "CAFE"),
                 STAR: Merchant(STAR, "스타벅스 역삼점", "CAFE", brand="스타벅스", brand_code="STAR"),
                 GS: Merchant(GS, "GS칼텍스 역삼", "FUEL", brand="GS칼텍스", brand_code="GS")}
    return Catalog(cards, merchants, {"CAFE": "카페", "FUEL": "주유"})


CARDS = [UserCard(201, 1, "SHINHAN", 1), UserCard(203, 3, "KB", 2)]
OCT = (datetime(2026, 10, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))
PROMOS = [Promotion(1, "메가MGC커피", *OCT, frozenset({MEGA}), issuer="SHINHAN", amount=500, kind="event",
                    title="메가커피 500원 할인")]


def coffee(start_hour=14, amount=6_000, item_id=1):
    return ScheduleItem(item_id, 1, at(10, 7, start_hour), at(10, 7, start_hour + 1), "CAFE", amount)


def habit_payments():
    """최근 30일: 스타벅스 5번(9시, 4,000~6,000원), GS 주유 3번(19시, 5만 원). 30일 전 결제·온라인 결제는 세지 않는다."""
    rows = [pay(203, a, "CAFE", at(10, d, 9), merchant=STAR) for d, a in zip(range(1, 6), (4_000, 4_500, 5_000, 5_500, 6_000))]
    rows += [pay(203, 50_000, "FUEL", at(10, d, 19), merchant=GS) for d in (2, 4, 6)]
    rows += [pay(203, 9_000, "FUEL", at(9, 1, 19), merchant=GS) for _ in range(5)]          # 30일 전
    rows += [pay(203, 7_000, "CAFE", at(10, 3, 12), merchant=MEGA, channel="online")]       # 현장 결제 아님
    return rows


def state_of(cards=CARDS, payments=()):
    state = UserState(User(1), cards, page_catalog(), Params())
    for p in payments:
        state.apply(p)
    state.roll_to("2026-10")
    return state


def test_자주_간_브랜드():
    assert usual_brand(habit_payments(), page_catalog(), "CAFE", NOW) == "STAR"
    assert usual_brand([], page_catalog(), "CAFE", NOW) is None


def test_평소_소비_항목은_상위_업종_중앙값():
    items = pattern_items(habit_payments(), page_catalog(), NOW, 1)
    assert [(i.item_id, i.category, i.amount, i.start, i.end) for i in items] == [
        (-1, "CAFE", 5_000, at(10, 7, 9), at(10, 7, 10)),
        (-2, "FUEL", 50_000, at(10, 7, 19), at(10, 7, 20)),
    ]


def test_지난_시각이면_지금부터_1시간():
    items = pattern_items(habit_payments(), page_catalog(), at(10, 7, 10, 25), 1)
    assert (items[0].start, items[0].end) == (at(10, 7, 10, 25), at(10, 7, 11, 25))


def test_일정이_있으면_일정():
    assert today_items([coffee()], habit_payments(), page_catalog(), NOW, Params(), 1) == ("schedule", [coffee()])


def test_남은_일정이_없으면_평소_소비():
    source, items = today_items([coffee(7)], habit_payments(), page_catalog(), at(10, 7, 9), Params(), 1)
    assert source == "pattern" and [i.item_id for i in items] == [-1, -2]


def test_카드날():
    p = Params()
    assert is_card_day([], NOW, p)
    assert not is_card_day([{"at": NOW - timedelta(days=2), "card_id": 9, "trigger": CYCLE}], NOW, p)
    assert is_card_day([{"at": NOW - timedelta(days=3), "card_id": 9, "trigger": CYCLE}], NOW, p)


def test_오늘_기록과_대신_보여준_카드는_세지_않는다():
    p = Params()
    assert is_card_day([{"at": NOW - timedelta(hours=1), "card_id": 9, "trigger": CYCLE}], NOW, p)
    history = [{"at": NOW - timedelta(days=4), "card_id": 9, "trigger": CYCLE},
               {"at": NOW - timedelta(days=1), "card_id": 8, "trigger": FALLBACK}]
    assert is_card_day(history, NOW, p)


def test_UTC_기록도_KST_날짜로_센다():
    # KST 10/4 23:30 = UTC 10/4 14:30. KST 기준 3일 전이므로 카드날
    utc = datetime(2026, 10, 4, 14, 30, tzinfo=timezone.utc)
    assert is_card_day([{"at": utc, "card_id": 9, "trigger": CYCLE}], NOW, Params())
    # KST 10/5 00:30 = UTC 10/4 15:30. KST 기준 2일 전이므로 카드날 아님
    utc2 = datetime(2026, 10, 4, 15, 30, tzinfo=timezone.utc)
    assert not is_card_day([{"at": utc2, "card_id": 9, "trigger": CYCLE}], NOW, Params())
```

- [ ] **Step 2: 실패 확인**

Run: `uv run pytest tests/test_recommendation_page.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'engine.page'`

- [ ] **Step 3: `engine/page.py` 에 Interfaces 의 상수·함수 5개를 만든다**

모듈 docstring 에 설계서 4·5절 규칙을 요약한다. 기록의 `at` 은 `.astimezone(at.tzinfo).date()` 로 KST 날짜를 얻는다. 중앙값은 `statistics.median`, 시각 중앙값은 `int(median(hours))`. 업종 순서는 (건수 내림차순, 업종 코드).

- [ ] **Step 4: 통과 확인**

Run: `uv run pytest tests/test_recommendation_page.py -q`
Expected: 8 passed

---

### Task 2: 카드 고르기 (`pick_card`)

**Files:**
- Modify: `engine/page.py`
- Test: `tests/test_recommendation_page.py`

**Interfaces:**
- Consumes: Task 1 의 `usual_brand`, `recently_recommended`; `engine.recommend.candidates(state)`, `engine.recommend.monthly_gain(state, rows60, card, at, threshold) -> (int, int)`; `engine.benefit_calc.evaluate, CardMonth, SOLPAY`
- Produces:
  - `FIRST_MONTH_NOTE = "발급 첫 달은 전월 실적이 없어 이 혜택이 적거나 없을 수 있어요"`
  - `@dataclass(frozen=True) CardPickItem(item_id: int, start: datetime, end: datetime, category: str, amount: int, brand: str | None, benefit: str, min_prev: int, value: int, owned_value: int)` + `gain` 속성(`value - owned_value`)
  - `@dataclass(frozen=True) CardPick(card_id: int, card_name: str, annual_fee: int, items: tuple[CardPickItem, ...], monthly_gain: int, first_month_note: str | None)` + `gain` 속성(항목 gain 합)
  - `pick_card(state, payments: list[Payment], items: list[ScheduleItem], history: list[dict], at: datetime, params: Params) -> CardPick | None`

규칙 (설계서 6절):
- 브랜드: `usual_brand` 가 있으면 그것 하나. 없으면 후보 카드가 그 업종에서 혜택을 주는 브랜드들(혜택 `targets` 의 (업종, 브랜드) 또는 `targets` 가 없을 때 `category == 업종` 인 혜택의 `brands`) 중 더 받는 금액이 가장 큰 브랜드(같으면 이름 순). 그것도 없으면 `None`.
- 보유 최고 = `excluded` 가 아닌 보유 카드마다 `evaluate(카드, 업종, 금액, state.ledger.get(uc) or CardMonth(), 시작, 브랜드, SOLPAY)[0]` 의 최댓값.
- 후보 혜택 = `evaluate(후보, …, CardMonth(prev_perf=catalog.first_tier(id) or 0), …)`. `benefit` = 적용 혜택 `name` (비면 `"{업종 이름} 혜택"`), `min_prev` = 적용 혜택 `min_prev`.
- 항목은 gain > 0 인 것만 담는다. 카드 gain 이 0 이면 후보에서 뺀다.
- `monthly_gain` 은 고른 카드만 `monthly_gain(state, 최근 60일 결제, 카드, at, params.switch_threshold)[0]`.
- `first_month_note`: gain 이 가장 큰 항목을 `CardMonth(prev_perf=0)` 으로 다시 계산해 value 보다 작으면 `FIRST_MONTH_NOTE`.

- [ ] **Step 1: 테스트를 더한다**

```python
from engine.page import FIRST_MONTH_NOTE, pick_card


def test_일정에서_더_주는_카드를_고른다():
    pick = pick_card(state_of(), habit_payments(), [coffee()], [], NOW, Params())
    assert (pick.card_id, pick.card_name, pick.annual_fee, pick.gain) == (9, "새 카페 카드", 12_000, 540)
    item = pick.items[0]
    assert (item.brand, item.benefit, item.min_prev, item.value, item.owned_value) == ("STAR", "카페 10% 할인", 300_000, 600, 60)
    assert pick.first_month_note == FIRST_MONTH_NOTE


def test_평소_소비_항목이면_주유_카드():
    items = pattern_items(habit_payments(), page_catalog(), NOW, 1)
    pick = pick_card(state_of(), habit_payments(), items, [], NOW, Params())
    assert (pick.card_id, pick.gain, pick.first_month_note) == (8, 2_000, None)       # 2,500 − KB 500
    assert [i.category for i in pick.items] == ["FUEL"]


def test_이력이_없으면_카드가_주는_브랜드_중_더_받는_곳():
    pick = pick_card(state_of(), [], [coffee()], [], NOW, Params())
    assert (pick.card_id, pick.items[0].brand, pick.gain) == (9, "STAR", 540)        # 메가커피는 보유 카드도 600원


def test_더_주는_카드가_없으면_None():
    # 카페 카드 9 는 5일 전에 추천해 빠지고, 남은 후보 8 은 카페 혜택이 없다
    assert pick_card(state_of(), [], [coffee()], [{"at": NOW - timedelta(days=5), "card_id": 9}], NOW, Params()) is None


def test_30일_안에_추천한_카드는_빼고_오늘_기록은_막지_않는다():
    old = [{"at": NOW - timedelta(days=5), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], old, NOW, Params()) is None
    today = [{"at": NOW - timedelta(hours=1), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], today, NOW, Params()).card_id == 9


def test_삭제한_보유_카드는_비교에서_뺀다():
    cards = [UserCard(201, 1, "SHINHAN", 1), UserCard(203, 3, "KB", 2, excluded=True)]
    pick = pick_card(state_of(cards), habit_payments(), [coffee()], [], NOW, Params())
    assert (pick.items[0].owned_value, pick.gain) == (0, 600)
```

- [ ] **Step 2: 실패 확인** — Run: `uv run pytest tests/test_recommendation_page.py -q` / Expected: FAIL `ImportError: cannot import name 'pick_card'`
- [ ] **Step 3: Interfaces 대로 `CardPickItem`, `CardPick`, `pick_card`, `FIRST_MONTH_NOTE` 를 만든다**
- [ ] **Step 4: 통과 확인** — Run: `uv run pytest tests/test_recommendation_page.py -q` / Expected: 14 passed

---

### Task 3: 표시 규칙과 페이지 (`build_page`, `Page.to_dict`)

**Files:**
- Modify: `engine/page.py`
- Test: `tests/test_recommendation_page.py`

**Interfaces:**
- Consumes: Task 1·2; `engine.popup.promotion_offers(state, items, promotions, at, params, excluded) -> list[PromotionOffer]`, `PromotionOffer.to_dict(params)`
- Produces:
  - `@dataclass(frozen=True) Page(source: str, card_day: bool, card: CardPick | None, offers: tuple[PromotionOffer, ...], trigger: str | None)`
    - `tabs -> list[str]`: `"card"`(card 가 있으면) 다음 `"merchant"`(offers 가 있으면)
    - `to_dict(catalog: Catalog, params: Params) -> dict`: 키 `source, card_day, tabs, card, merchant`. `card` 는 `None` 또는 `{card_id, card_name, annual_fee, gain, monthly_gain, first_month_note, items: [{item_id, start, end(ISO), category, category_name, amount, brand, benefit, min_prev, value, owned_value, gain}]}`. `merchant` 는 `None` 또는 `{"offers": [PromotionOffer.to_dict(params) + "category_name"]}`
  - `build_page(state, payments, schedules, history, promotions, at, params, excluded=None) -> Page`

규칙: 설계서 4절. 행사는 `promotion_offers` 결과에서 (item_id, brand, title) 가 같은 것은 첫 번째(받을 금액이 가장 큰 것)만 남기고 `params.popup_promotions` 건으로 자른다 (팀 DB 행사와 promotions.yml 이 같은 행사를 두 번 가질 수 있음). 카드가 있으면 trigger = 카드날 `CYCLE`, 아니면 `FALLBACK`. 카드가 없으면 `None`.

- [ ] **Step 1: 테스트를 더한다**

```python
from engine.page import build_page

YESTERDAY = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE}]   # 어제 카드날 → 오늘은 카드날 아님


def test_카드날은_두_탭():
    page = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params())
    assert (page.card_day, page.tabs, page.trigger, page.card.card_id) == (True, ["card", "merchant"], CYCLE, 9)
    assert [(o.brand, o.user_card_id, o.total) for o in page.offers] == [("메가MGC커피", 201, 1_100)]


def test_카드날_아니면_가맹점_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, Params())
    assert (page.card_day, page.tabs, page.card, page.trigger) == (False, ["merchant"], None, None)


def test_프로모션이_없으면_카드_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, [], NOW, Params())
    assert (page.tabs, page.trigger, page.card.card_id) == (["card"], FALLBACK, 9)


def test_둘_다_없으면_빈_탭():
    blocked = YESTERDAY + [{"at": NOW - timedelta(days=2), "card_id": 9, "trigger": FALLBACK}]
    page = build_page(state_of(), [], [coffee()], blocked, [], NOW, Params())
    assert page.tabs == [] and page.card is None


def test_같은_행사가_두_번_있어도_한_번():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS + PROMOS, NOW, Params())
    assert len(page.offers) == 1


def test_신한카드가_없으면_카드_탭만():
    kb_only = [UserCard(203, 3, "KB", 1)]
    page = build_page(state_of(kb_only), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, Params())
    assert page.tabs == ["card"]


def test_일정이_없으면_평소_소비로_행사와_카드():
    # 평소 소비 카페 항목(09~10시, 5,000원)에 메가커피 행사: 500 + 보유 1 메가 10% 500 = 1,000원
    page = build_page(state_of(), habit_payments(), [], [], PROMOS, NOW, Params())
    assert page.source == "pattern" and page.card.card_id == 8
    assert [(o.item_id, o.brand, o.total) for o in page.offers] == [(-1, "메가MGC커피", 1_000)]


def test_to_dict_형식():
    d = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params()).to_dict(page_catalog(), Params())
    assert d["tabs"] == ["card", "merchant"] and d["source"] == "schedule"
    assert d["card"]["items"][0]["category_name"] == "카페" and d["card"]["items"][0]["gain"] == 540
    assert d["card"]["items"][0]["start"] == "2026-10-07T14:00:00+09:00"
    assert d["merchant"]["offers"][0]["category_name"] == "카페" and d["merchant"]["offers"][0]["total"] == 1_100
```

- [ ] **Step 2: 실패 확인** — Run: `uv run pytest tests/test_recommendation_page.py -q` / Expected: FAIL `ImportError: cannot import name 'build_page'`
- [ ] **Step 3: `Page`, `build_page` 를 만든다**
- [ ] **Step 4: 통과 확인** — Run: `uv run pytest tests/test_recommendation_page.py -q` / Expected: 22 passed

---

### Task 4: OpenAI 문구 (`engine/chat/page_copy.py`)

**Files:**
- Create: `engine/chat/page_copy.py`
- Test: `tests/test_page_copy.py`

**Interfaces:**
- Consumes: `engine.chat.guard.collect_facts, unknown_numbers, SPEND_PUSH`; `engine.chat.tools._josa`; Task 3 `Page.to_dict` 의 dict
- Produces:
  - `@dataclass(frozen=True) CopySettings(model: str = "gpt-4o-mini", timeout_sec: float = 8.0, temperature: float = 0.4)` + `from_env()` (`OPENAI_MODEL`, `PAGE_COPY_TIMEOUT_SEC`)
  - `LIMITS = {"title": 22, "summary": 70, "amount_label": 28, "reason": 45}`
  - `facts_of(page: dict) -> dict` — LLM 에 보낼 사실. 키: `basis`("오늘 일정"/"평소 소비(최근 30일)"), `card`(None 또는 `{card_name, annual_fee, extra_today, monthly_gain_30d?(>0일 때만), first_month_note, items:[{time:"HH:MM~HH:MM", category, amount, brand(브랜드 코드. 실제 데이터에서는 '스타벅스' 같은 이름), benefit, min_prev_perf, new_card_benefit, current_best_benefit, extra}]}`), `merchant`(None 또는 `{offers:[{time, category, amount, brand, promotion, kind:"이벤트"/"마이샵", promotion_benefit, card_name, card_benefit, total}]}`)
  - `template_copy(facts: dict) -> dict` — 형식은 아래 COPY 형식, 항상 `check_copy` 통과
  - `check_copy(copy: dict, facts: dict) -> list[str]` — 문제 목록(비면 통과)
  - `class PageCopyWriter(client, settings: CopySettings | None = None)` + `write(facts: dict) -> tuple[dict, str, dict]` = (copy, `"llm"`/`"template"`, log `{ms, model, tokens_in, tokens_out, retries, reason?}`)
  - `attach_copy(page: dict, copy: dict) -> dict` — `page["card"]["copy"] = copy["card"]`, `page["merchant"]["copy"] = {title, summary}`, `page["merchant"]["offers"][i]["copy"] = copy["merchant"]["offers"][i]`

COPY 형식: `{"card": None | {"title", "summary", "amount_label", "reasons": [str]}, "merchant": None | {"title", "summary", "offers": [{"amount_label", "reasons": [str]}]}}`

`check_copy` 규칙: (1) `card`/`merchant` 가 facts 와 같이 있거나 없고, 행사 문구 수 = 행사 수 (2) 길이 한도·reasons 1~3개 (3) 모든 문자열을 합친 글에 `unknown_numbers(글, collect_facts(facts))` 가 비어야 함 (4) `SPEND_PUSH` 단어 없음 (5) 카드 문구에 '연회비' 포함, 항목 중 `min_prev_perf > 0` 이 있으면 '실적' 포함.

`write` 흐름: client 없음 → 템플릿(reason `no_api_key`). 있으면 system 프롬프트 + user(facts JSON) 로 `client.chat.completions.create(model, messages, temperature, timeout=남은 시간, response_format={"type": "json_schema", "json_schema": {"name": "page_copy", "strict": True, "schema": COPY 스키마}})`. `json.loads` → `check_copy`. 문제가 있고 남은 시간 ≥ 1초면 assistant 응답 + `"[문구 검사] 다음 문제를 고쳐 다시 쓰세요.\n- …"` 를 붙여 한 번 더. 그래도 문제 → 템플릿(reason `guard`). 예외 → 템플릿(reason 예외 클래스 이름). COPY 스키마는 strict 규칙대로 모든 키 required, `card`·`merchant` 는 `anyOf [object, null]`, `additionalProperties: false`.

system 프롬프트에 넣을 것: SOL페이 추천 페이지 문구 작성자, 해요체, 사실에 있는 숫자만, 금액은 '1,000원' 형식, 카드 탭은 연회비와 실적 조건(있으면)을 reasons 에 밝힘, basis 가 평소 소비면 '평소 자주 가시는 …' 처럼 쓰고 '오늘 일정' 이라 하지 않음, brand 가 있으면 그 가맹점에서 결제할 때라고 밝힘, 소비 권유 금지, 길이 한도.

- [ ] **Step 1: 테스트를 쓴다**

```python
"""추천 페이지 문구: OpenAI 응답 검사와 템플릿."""

import json
from types import SimpleNamespace

from engine.chat.page_copy import CopySettings, PageCopyWriter, attach_copy, check_copy, facts_of, template_copy
from engine.params import Params
from tests.test_recommendation_page import NOW, PROMOS, build_page, coffee, habit_payments, page_catalog, state_of


class FakeClient:
    """미리 정한 응답(문자열 또는 예외)을 차례로 돌려주고 요청을 기록한다."""

    def __init__(self, script):
        self.script, self.requests = list(script), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=step))],
                               usage=SimpleNamespace(prompt_tokens=300, completion_tokens=80))


def page_dict():
    return build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params()).to_dict(page_catalog(), Params())


GOOD = {"card": {"title": "카페 일정엔 새 카페 카드", "summary": "스타벅스에서 결제하면 지금 카드보다 540원 더 받아요.",
                 "amount_label": "오늘 일정에서 더 받는 혜택",
                 "reasons": ["스타벅스 6,000원 결제 시 카페 10% 할인 600원", "연회비 12,000원, 전월 실적 30만 원 이상일 때"]},
        "merchant": {"title": "메가커피 행사가 있어요", "summary": "메가MGC커피에서 Discount Plan+로 내면 1,100원 혜택이에요.",
                     "offers": [{"amount_label": "행사 500원 + 카드 할인 600원", "reasons": ["메가커피 500원 할인 행사"]}]}}


def test_사실에는_개인정보가_없다():
    facts = facts_of(page_dict())
    text = json.dumps(facts, ensure_ascii=False)
    assert "user_id" not in text and "user_card_id" not in text
    assert facts["card"]["extra_today"] == 540 and facts["card"]["items"][0]["time"] == "14:00~15:00"
    assert "monthly_gain_30d" not in facts["card"] or facts["card"]["monthly_gain_30d"] > 0


def test_정상_문구는_통과():
    assert check_copy(GOOD, facts_of(page_dict())) == []


def test_지어낸_숫자는_실패():
    bad = json.loads(json.dumps(GOOD))
    bad["card"]["summary"] = "지금 카드보다 9,999원 더 받아요."
    assert any("9,999원" in p for p in check_copy(bad, facts_of(page_dict())))


def test_연회비_언급이_없으면_실패():
    bad = json.loads(json.dumps(GOOD))
    bad["card"]["reasons"] = ["스타벅스 6,000원 결제 시 카페 10% 할인 600원 · 실적 조건 있음"]
    assert any("연회비" in p for p in check_copy(bad, facts_of(page_dict())))


def test_탭_구성이_다르면_실패():
    facts = facts_of(page_dict())
    assert check_copy({**GOOD, "card": None}, facts)
    assert check_copy({**GOOD, "merchant": {**GOOD["merchant"], "offers": []}}, facts)


def test_템플릿은_항상_통과():
    facts = facts_of(page_dict())
    assert check_copy(template_copy(facts), facts) == []


def test_LLM_문구를_쓴다():
    client = FakeClient([json.dumps(GOOD, ensure_ascii=False)])
    copy, source, log = PageCopyWriter(client, CopySettings()).write(facts_of(page_dict()))
    assert (source, copy, log["retries"]) == ("llm", GOOD, 0)
    req = client.requests[0]
    assert req["model"] == "gpt-4o-mini" and req["response_format"]["type"] == "json_schema"


def test_검사에_걸리면_한_번_다시():
    bad = {**GOOD, "card": {**GOOD["card"], "summary": "9,999원 더 받아요."}}
    client = FakeClient([json.dumps(bad, ensure_ascii=False), json.dumps(GOOD, ensure_ascii=False)])
    copy, source, log = PageCopyWriter(client).write(facts_of(page_dict()))
    assert (source, log["retries"]) == ("llm", 1)
    assert "[문구 검사]" in client.requests[1]["messages"][-1]["content"]


def test_두_번_다_틀리면_템플릿():
    bad = json.dumps({**GOOD, "card": {**GOOD["card"], "summary": "9,999원"}}, ensure_ascii=False)
    copy, source, log = PageCopyWriter(FakeClient([bad, bad])).write(facts_of(page_dict()))
    assert (source, log["reason"]) == ("template", "guard")


def test_키가_없거나_장애면_템플릿():
    facts = facts_of(page_dict())
    assert PageCopyWriter(None).write(facts)[1] == "template"
    copy, source, log = PageCopyWriter(FakeClient([TimeoutError("느림")])).write(facts)
    assert (source, log["reason"]) == ("template", "TimeoutError")


def test_문구를_붙인다():
    page = attach_copy(page_dict(), GOOD)
    assert page["card"]["copy"] == GOOD["card"]
    assert page["merchant"]["copy"] == {"title": GOOD["merchant"]["title"], "summary": GOOD["merchant"]["summary"]}
    assert page["merchant"]["offers"][0]["copy"] == GOOD["merchant"]["offers"][0]
```

- [ ] **Step 2: 실패 확인** — Run: `uv run pytest tests/test_page_copy.py -q` / Expected: FAIL `ModuleNotFoundError: No module named 'engine.chat.page_copy'`
- [ ] **Step 3: Interfaces 대로 `engine/chat/page_copy.py` 를 만든다**
- [ ] **Step 4: 통과 확인** — Run: `uv run pytest tests/test_page_copy.py -q` / Expected: 11 passed

---

### Task 5: 서비스·API 연결

**Files:**
- Modify: `engine/service.py` (`PlacementService.__init__`, `put_schedule`, 새 `forget_day`, 새 `recommendation_page`)
- Modify: `engine/api.py` (lifespan, 새 엔드포인트, `delete_schedule`, `reset`)
- Test: `tests/test_recommendation_page.py`

**Interfaces:**
- Consumes: Task 3 `build_page`, `Page.to_dict`; Task 4 `facts_of`, `template_copy`, `PageCopyWriter`, `attach_copy`; `engine.popup.offers_by_item`
- Produces:
  - `PlacementService.pages: dict[(user_id, date), dict]`
  - `PlacementService.forget_day(user_id: int, day: date) -> None` — `popups`·`pages` 의 그날 값을 지운다. `put_schedule` 이 부른다.
  - `PlacementService.recommendation_page(user_id: int, at: datetime, writer: PageCopyWriter | None = None) -> dict` — 응답 = `Page.to_dict` + `attach_copy` + `{"day": "YYYY-MM-DD", "copy_source", "cached"}`. writer 가 None 이면 템플릿.
  - `POST /internal/users/{user_id}/recommendation-page` (본문 `AtBody`, 내부 토큰, 없는 사용자 404). `app.state.page_writer = PageCopyWriter(client, CopySettings.from_env())`, client 는 챗봇과 같은 것(`chat_client` 인자 또는 `openai_client()`).

`recommendation_page` 흐름: 캐시에 있으면 `{**저장분, "cached": True}`. 없으면 `schedule_popup` 과 같은 방식으로 state·제외 규칙을 만들고, 행사 목록 = `self._all_promotions(context)`, `build_page` → `to_dict` → 문구 → 카드가 있고 오늘 같은 card_id 기록이 없으면 `log_card_recommendation({"user_id", "at", "card_id", "trigger": page.trigger, "gain": card.gain})` → item_id > 0 인 행사만 `self.popups[key] = offers_by_item(...)`(없으면 pop) → 저장 후 `cached: False`. 문구 로그(`log`)는 응답 `copy_log` 키로 준다.

API 의 `delete_schedule` 은 `svc.store.put_schedule(...)` 뒤 `svc.forget_day(user_id, day)` 를, `reset` 은 `svc.pages.clear()` 를 더한다.

- [ ] **Step 1: 테스트를 더한다**

```python
from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from engine.api import create_app
from engine.priors import Priors
from engine.rules import parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import UnknownUser, UserContext


class PageStore:
    def __init__(self):
        self.payments, self.rules, self.days, self.recommended, self.logs = habit_payments(), [], {}, [], []

    def user(self, user_id):
        if user_id != 1:
            raise UnknownUser(user_id)
        return User(1)

    def context(self, user_id, when):
        return UserContext(self.user(user_id), CARDS, [p for p in self.payments if p.visible_at <= when], self.rules,
                           schedules=list(self.days.get(when.date(), [])))

    def put_schedule(self, user_id, day, items):
        self.days[day] = list(items)

    def schedules(self, user_id, day):
        return list(self.days.get(day, []))

    def recommendation_history(self, user_id):
        return list(self.recommended)

    def log_card_recommendation(self, record):
        self.recommended.append(record)

    def log_recommendation(self, record):
        self.logs.append(record)
        return len(self.logs)


@pytest.fixture
def page_svc():
    service = PlacementService(PageStore(), PlacementEngine(page_catalog(), Priors({}, {}), Params(base_order="first_tier")))
    service.popup_promotions = PROMOS
    return service


def _save_coffee(svc, hour=14):
    svc.put_schedule(1, date(2026, 10, 7), [{"start": time(hour), "end": time(hour + 1), "category": "CAFE",
                                             "amount": 6_000}], NOW)


def test_서비스_카드날_두_탭과_기록(page_svc):
    _save_coffee(page_svc)
    page = page_svc.recommendation_page(1, NOW)
    assert page["tabs"] == ["card", "merchant"] and page["copy_source"] == "template" and page["cached"] is False
    assert page["day"] == "2026-10-07" and page["card"]["copy"]["title"]
    assert [(r["card_id"], r["trigger"]) for r in page_svc.store.recommended] == [(9, CYCLE)]
    assert (1, date(2026, 10, 7)) in page_svc.popups                      # 일정 행사는 결제 화면 1순위에 쓴다


def test_같은_날_다시_부르면_그대로(page_svc):
    from tests.test_page_copy import GOOD, FakeClient
    from engine.chat.page_copy import PageCopyWriter
    import json
    _save_coffee(page_svc)
    client = FakeClient([json.dumps(GOOD, ensure_ascii=False)])
    first = page_svc.recommendation_page(1, NOW, PageCopyWriter(client))
    second = page_svc.recommendation_page(1, NOW + timedelta(hours=2), PageCopyWriter(client))
    assert second["cached"] is True and second["card"] == first["card"] and len(client.requests) == 1
    assert len(page_svc.store.recommended) == 1


def test_일정을_바꾸면_다시_계산하고_같은_카드는_한_번만_기록(page_svc):
    _save_coffee(page_svc)
    page_svc.recommendation_page(1, NOW)
    _save_coffee(page_svc, 10)
    again = page_svc.recommendation_page(1, NOW)
    assert again["cached"] is False and again["card_day"] is True and again["card"]["card_id"] == 9
    assert len(page_svc.store.recommended) == 1


def test_평소_소비_행사는_결제_화면에_쓰지_않는다(page_svc):
    page = page_svc.recommendation_page(1, NOW)
    assert page["source"] == "pattern" and page["merchant"]["offers"][0]["item_id"] == -1
    assert (1, date(2026, 10, 7)) not in page_svc.popups


def test_대신_보여준_카드_기록(page_svc):
    page_svc.store.recommended = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE}]
    page_svc.popup_promotions = []
    _save_coffee(page_svc)
    page = page_svc.recommendation_page(1, NOW)
    assert page["tabs"] == ["card"] and page_svc.store.recommended[-1]["trigger"] == FALLBACK


def test_추천_페이지_API(page_svc):
    from tests.test_page_copy import GOOD, FakeClient
    import json
    _save_coffee(page_svc)
    with TestClient(create_app(page_svc, chat_client=FakeClient([json.dumps(GOOD, ensure_ascii=False)]))) as c:
        r = c.post("/internal/users/1/recommendation-page", json={"at": NOW.isoformat()})
        missing = c.post("/internal/users/2/recommendation-page", json={"at": NOW.isoformat()})
        c.delete("/internal/users/1/schedules/2026-10-07")
        after = c.post("/internal/users/1/recommendation-page", json={"at": NOW.isoformat()}).json()
    body = r.json()
    assert r.status_code == 200 and body["copy_source"] == "llm" and body["card"]["copy"] == GOOD["card"]
    assert body["merchant"]["offers"][0]["copy"] == GOOD["merchant"]["offers"][0]
    assert missing.status_code == 404
    assert after["cached"] is False and after["source"] == "pattern"
```

`test_추천_페이지_API` 의 마지막 호출은 FakeClient 응답이 떨어져 예외(IndexError) → 템플릿이 된다. 그래도 통과해야 한다(`after` 는 문구 출처를 보지 않는다).

- [ ] **Step 2: 실패 확인** — Run: `uv run pytest tests/test_recommendation_page.py -q` / Expected: FAIL `AttributeError: 'PlacementService' object has no attribute 'recommendation_page'`
- [ ] **Step 3: Interfaces 대로 서비스·API 를 고친다**
- [ ] **Step 4: 통과 확인** — Run: `uv run pytest tests/test_recommendation_page.py tests/test_page_copy.py tests/test_popup.py -q` / Expected: 모두 통과
- [ ] **Step 5: 전체 회귀** — Run: `uv run pytest -q` / Expected: 기존 219개 + 새 테스트 통과 (pg 테스트는 DB 꺼져 있으면 건너뜀)

---

### Task 6: 문서·Postman·실제 OpenAI 확인

**Files:**
- Create: `evaluation/page_eval.py`
- Modify: `postman/solpay-ai.postman_collection.json` ('2. 하루 일정과 팝업' 폴더에 '추천 페이지' 요청 추가, `at` 2026-11-03T08:00:00+09:00)
- Modify: `openapi.json` (`uv run python -m scripts.export_openapi`)
- Modify: `README.md` (API 표 219~224행 근처에 새 주소 한 줄)

**Interfaces:**
- Consumes: Task 5 `PlacementService.recommendation_page`, Task 4 `PageCopyWriter`, `engine.chat.agent.openai_client`
- Produces: `uv run python -m evaluation.page_eval [--at ISO]` — `SOLPAY_STORE` 기본 `teamdb`(개인 DB 에 추천 기록을 남기지 않게), 시연 사용자 1~5 각각 (a) 일정 없음 (b) 일정 `12:00~13:00 RESTAURANT 13,000원` + `15:00~16:00 CAFE 5,000원` 두 경우 페이지를 만든다. 사례마다 탭·카드·행사·문구 출처·걸린 시간·문구를 출력하고 `artifacts/reports/page_copy_eval.json` 에 저장. 마지막에 LLM 통과 수 / 전체, 시간 중앙값·최대.

- [ ] **Step 1: `evaluation/page_eval.py` 작성**
- [ ] **Step 2: 실제 OpenAI 로 실행** — Run: `uv run python -m evaluation.page_eval --at 2026-11-05T08:00:00+09:00` / Expected: 10개 사례 출력, 키가 있으면 대부분 `llm`. 템플릿으로 떨어진 사례는 검사 문제를 출력에서 확인하고 사용자에게 보고한다(프롬프트 수정은 사용자에게 물어본 뒤).
- [ ] **Step 3: Postman·openapi·README 갱신** — Run: `uv run python -m scripts.export_openapi && python3 -c "import json;json.load(open('postman/solpay-ai.postman_collection.json'))"` / Expected: `저장: …/openapi.json`, JSON 오류 없음. `grep -c recommendation-page openapi.json README.md` 각 1 이상.
- [ ] **Step 4: 전체 테스트** — Run: `uv run pytest -q` / Expected: 모두 통과
