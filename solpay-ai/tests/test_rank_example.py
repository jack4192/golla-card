"""결제 화면 '이 거래의 예상 혜택' 예시 거래 (2026-11-23 설계: payment-example).

1순위 카드 문구가 가리키는 거래를 고른다: 행사 문구면 그 행사를 준 가게, 혜택 문구면 문구를 만든 시나리오,
그 밖이면 가장 가능성 높은 후보. prob 는 업종 확률 × 그 가게(브랜드) 비중이라 상자 금액 × prob ≈ 문구 금액이다.
"""

import pytest

from engine.domain import ScheduleItem
from engine.example import rank_example, schedule_example
from engine.messages import GENERAL_BENEFIT, NEUTRAL, PERFORMANCE, PROMOTION
from engine.params import Params
from engine.ranker import decide
from engine.scenarios import MODE_SCHEDULE, MODE_TIME, Scenario, ScenarioSet
from tests.conftest import at
from tests.test_popup import CARDS, HOLLYS, MEGA, PROMOS, cafe_catalog, state_of

NINE = at(10, 7, 9)
ONE = [CARDS[0]]                     # 201: 메가커피 10% (7~15시), 신한


def scen_set(*scenarios, mode=MODE_TIME):
    return ScenarioSet(list(scenarios), mode, (False, 1))


def example_of(scen, code, promotions=PROMOS, decide_promotions=PROMOS):
    state = state_of(cards=ONE)
    decision = decide(state, ONE, scen, NINE, Params(), decide_promotions)
    return rank_example(state, decision, scen, code, promotions, NINE), decision


def test_행사_문구면_그_행사를_준_가게가_예시다():
    scen = scen_set(Scenario("CAFE", 1.0, (6_000,), {}, {None: 1.0}, promo_brands={"HOLLYS": 0.5, None: 0.5}))
    ex, decision = example_of(scen, PROMOTION)
    assert ex == {"basis": "promotion", "category_code": "CAFE", "category_name": "카페",
                  "merchant_id": HOLLYS, "name": "할리스", "amount": 6_000, "prob": 0.5}
    assert ex["prob"] * 600 == pytest.approx(decision.scores[201].promotion)   # 상자 금액 × 가능성 = 문구 금액


def test_가게를_알면_그_가게_확률을_쓴다():
    scen = scen_set(Scenario("CAFE", 1.0, (6_000,), {HOLLYS: 0.4, MEGA: 0.6}, {None: 1.0}))
    ex, decision = example_of(scen, PROMOTION)
    assert decision.scores[201].promotion_label == "메가MGC커피 이벤트 500원"   # 500×0.6 > 600×0.4
    assert (ex["basis"], ex["merchant_id"], ex["name"], ex["prob"]) == ("promotion", MEGA, "메가MGC커피", 0.6)


def test_같은_행사의_여러_지점은_확률을_합친다():
    """현대백화점처럼 행사 하나가 지점 여러 곳에 걸리면 문구 금액은 지점을 모두 더한 값이다.
    예시는 비중이 가장 큰 지점을 보이고, 가능성은 행사가 걸린 지점 비중을 합친다 (상자 금액 × 가능성 = 문구 금액)."""
    from engine.catalog import Catalog
    from engine.domain import Merchant, Promotion, User
    from engine.state import UserState
    from tests.test_popup import NOV
    base = cafe_catalog()
    second = 53
    catalog = Catalog(base.cards, {**base.merchants,
                                   second: Merchant(second, "할리스 강남점", "CAFE", brand="할리스", brand_code="HOLLYS")},
                      base.category_names)
    promos = [Promotion(2, "할리스", *NOV, frozenset({HOLLYS, second}), issuer="SHINHAN", rate=0.10, kind="myshop")]
    state = UserState(User(1), ONE, catalog, Params())
    state.roll_to("2026-10")
    scen = scen_set(Scenario("CAFE", 0.5, (6_000,), {HOLLYS: 0.2, second: 0.3}, {None: 1.0}))
    decision = decide(state, ONE, scen, NINE, Params(), promos)
    ex = rank_example(state, decision, scen, PROMOTION, promos, NINE)
    assert (ex["merchant_id"], ex["name"], ex["prob"]) == (second, "할리스", 0.25)    # 0.5 × (0.2 + 0.3)
    assert ex["prob"] * 600 == pytest.approx(decision.scores[201].promotion)


def test_행사_목록에_같은_행사가_두_번_있어도_가능성은_한_번만_센다():
    """실제 DB 에서 같은 행사(번호 18)가 두 번 읽혔다. 예시 가능성이 두 배가 되면 안 된다."""
    scen = scen_set(Scenario("CAFE", 1.0, (6_000,), {}, {None: 1.0}, promo_brands={"HOLLYS": 0.5, None: 0.5}))
    once, _ = example_of(scen, PROMOTION)
    twice, _ = example_of(scen, PROMOTION, promotions=PROMOS + PROMOS, decide_promotions=PROMOS + PROMOS)
    assert twice == once


def test_혜택_문구면_문구를_만든_시나리오가_예시다():
    scen = scen_set(Scenario("CAFE", 0.6, (6_000,), {}, {"MEGA": 1.0}),
                    Scenario("REST", 0.4, (10_000,), {}, {None: 1.0}))
    ex, _ = example_of(scen, GENERAL_BENEFIT, promotions=[], decide_promotions=[])
    assert ex == {"basis": "benefit", "category_code": "CAFE", "category_name": "카페",
                  "merchant_id": MEGA, "name": "메가MGC커피", "amount": 6_000, "prob": 0.6}


def test_그_밖의_문구는_가장_가능성_높은_후보다():
    scen = scen_set(Scenario("CAFE", 0.3, (4_000,), {}, {None: 1.0}),
                    Scenario("REST", 0.7, (10_000,), {}, {None: 1.0}))
    ex, _ = example_of(scen, PERFORMANCE)
    assert ex == {"basis": "likely", "category_code": "REST", "category_name": "음식점",
                  "merchant_id": None, "name": "음식점", "amount": 10_000, "prob": 0.7}


def test_일정_모드에서_그_밖의_문구면_basis_가_schedule():
    scen = scen_set(Scenario("REST", 1.0, (10_000,), {}, {None: 1.0}), mode=MODE_SCHEDULE)
    ex, _ = example_of(scen, NEUTRAL)
    assert ex["basis"] == "schedule" and ex["category_code"] == "REST"


def test_행사를_못_찾으면_가장_가능성_높은_후보다():
    scen = scen_set(Scenario("CAFE", 1.0, (6_000,), {}, {None: 1.0}, promo_brands={"HOLLYS": 0.5, None: 0.5}))
    ex, _ = example_of(scen, PROMOTION, promotions=[])
    assert ex["basis"] == "likely" and ex["merchant_id"] is None and ex["name"] == "카페"


def test_금액은_가운데_값이다():
    three = scen_set(Scenario("CAFE", 1.0, (3_000, 6_000, 9_000), {}, {None: 1.0}))
    two = scen_set(Scenario("CAFE", 1.0, (9_000, 3_000), {}, {None: 1.0}))
    assert example_of(three, PERFORMANCE)[0]["amount"] == 6_000
    assert example_of(two, PERFORMANCE)[0]["amount"] == 3_000


def test_일정_프로모션_카드_예시():
    item = ScheduleItem(1, 1, at(10, 7, 14), at(10, 7, 15), "CAFE", 6_000, brand="MEGA")
    assert schedule_example(cafe_catalog(), item, "메가MGC커피") == {
        "basis": "schedule", "category_code": "CAFE", "category_name": "카페",
        "merchant_id": MEGA, "name": "메가MGC커피", "amount": 6_000, "prob": 1.0}


def test_일정_프로모션_카드는_브랜드_코드가_없어도_행사_가게를_찾는다():
    item = ScheduleItem(1, 1, at(10, 7, 14), at(10, 7, 15), "CAFE", 6_000)          # 백엔드 일정에는 brand 가 없다
    ex = schedule_example(cafe_catalog(), item, "메가MGC커피")
    assert (ex["merchant_id"], ex["name"]) == (MEGA, "메가MGC커피")
    assert schedule_example(cafe_catalog(), item)["merchant_id"] is None            # 행사 이름도 없으면 업종만


def test_merchant_for_는_브랜드가_없으면_None():
    catalog = cafe_catalog()
    assert catalog.merchant_for("CAFE", None) is None
    assert catalog.merchant_for("CAFE", "MEGA") == MEGA
    assert catalog.merchant_for("REST", "MEGA") is None
