"""설계서 v4.2: 프로모션을 5단계 원화 점수에 다시 넣는다.

가게를 모를 때 = Σ 브랜드 P(브랜드|업종) × (그 브랜드 행사 중 이 카드로 받는 가장 큰 금액).
P(브랜드|업종) 은 내 카드 혜택과 무관한 브랜드도 묶지 않는다 (행사는 그런 브랜드에도 걸린다).
"""


import pytest

from engine.domain import Promotion, RankRequest
from engine.messages import PROMOTION, _dominant, card_message
from engine.params import Params
from engine.priors import Priors
from engine.ranker import CardScore, decide, promotion_value
from engine.scenarios import MODE_TIME, Scenario, ScenarioSet, build, promo_brand_mix
from engine.service import PlacementEngine, PlacementService
from tests.conftest import V3, at, pay
from tests.test_popup import CARDS, HOLLYS, MEGA, NOV, PROMOS, PopupStore, cafe_catalog, state_of

NINE = at(10, 7, 9)


def hollys_scenario(brands=None, merchants=None):
    return ScenarioSet([Scenario("CAFE", 1.0, (6_000,), merchants or {}, {None: 1.0},
                                 promo_brands=brands if brands is not None else {"HOLLYS": 1.0})], MODE_TIME, (False, 1))


def test_프로모션용_브랜드_비중은_내_카드와_무관한_브랜드도_남긴다():
    rows = [pay(201, 6_000, "CAFE", at(9, d, 9), merchant=HOLLYS) for d in (1, 2, 3)]
    rows.append(pay(201, 6_000, "CAFE", at(9, 4, 9), merchant=MEGA))
    state = state_of(payments=rows)
    mix = promo_brand_mix(state, "CAFE", Priors({}, {}), Params())
    assert mix == pytest.approx({"HOLLYS": 3 / 20, "MEGA": 1 / 20, None: 16 / 20})


def test_시나리오에_프로모션용_브랜드_비중이_들어간다(priors):
    rows = [pay(201, 6_000, "CAFE", at(9, d, 9), merchant=HOLLYS) for d in range(1, 21)]
    state = state_of(payments=rows)
    scenarios = build(state, RankRequest(1, NINE), state.catalog, priors, Params())
    cafe = next(s for s in scenarios.scenarios if s.category == "CAFE")
    assert cafe.promo_brands == {"HOLLYS": 1.0}
    assert cafe.brands == {None: 1.0}                  # 카드 혜택 계산용은 그대로 묶는다


def test_가게를_모르면_브랜드_비중으로_프로모션을_센다():
    scen = hollys_scenario({"HOLLYS": 0.5, None: 0.5}).scenarios[0]
    catalog = cafe_catalog()
    value, label = promotion_value(PROMOS, scen, CARDS[0], catalog, NINE)
    assert value == pytest.approx(300)                 # 0.5 × 할리스 10% 600원
    assert label == "할리스 마이샵 10%"
    assert promotion_value(PROMOS, scen, CARDS[2], catalog, NINE)[0] == 0     # KB 카드는 신한 행사 대상 아님


def test_가게를_알면_그_가게의_가장_큰_행사_하나만_센다():
    extra = Promotion(9, "메가MGC커피", *NOV, frozenset({MEGA}), issuer="SHINHAN", amount=300)
    scen = hollys_scenario(merchants={MEGA: 1.0}).scenarios[0]
    value, label = promotion_value(PROMOS + [extra], scen, CARDS[0], cafe_catalog(), NINE)
    assert value == pytest.approx(500)                 # 500 + 300 이 아니라 큰 것 하나 (실제 결제도 하나만 받는다)
    assert label == "메가MGC커피 이벤트 500원"


def test_프로모션이_점수에_들어가_행사_카드가_1순위가_된다():
    state = state_of()
    on = decide(state, CARDS, hollys_scenario(), NINE, Params(), PROMOS)
    assert on.first == 201 and on.scores[201].promotion == pytest.approx(600)
    off = decide(state_of(), CARDS, hollys_scenario(), NINE, Params(promo_in_score=False), PROMOS)
    assert off.first == 203 and off.scores[201].promotion == 0     # 끄면 즉시 혜택(KB 1%)만 본다


def test_행사_때문에_고른_카드는_행사_이름으로_안내한다():
    state, scen = state_of(), hollys_scenario()
    decision = decide(state, CARDS, scen, NINE, Params(), PROMOS)
    message = card_message(state, state.catalog, decision, scen, decision.first, NINE, Params(), False)
    assert message.code == PROMOTION and "할리스" in message.text


def test_v4_교체_이유는_실적_가치를_빼고_본다():
    top, base = CardScore(1, 10.0, 900.0, 300.0, 310.0, {}), CardScore(2, 0.0, 0.0, 0.0, 0.0, {})
    assert _dominant(top, base, Params()) == "promotion"
    assert _dominant(top, base, Params(**V3)) == "performance"


def test_서비스는_팝업용_프로모션도_점수에_쓴다(priors):
    store = PopupStore()
    for d in range(1, 21):
        store.add_payment(pay(201, 6_000, "CAFE", at(9, d, 9), merchant=HOLLYS))
    service = PlacementService(store, PlacementEngine(cafe_catalog(), priors, Params(base_order="first_tier")))
    service.popup_promotions = PROMOS
    _, result = service.rank(RankRequest(1, NINE))
    assert result.card_scores[201]["promotion"] > 0
    assert result.card_scores[201]["promotion_label"] == "할리스 마이샵 10%"


def test_결제_결과에도_팝업용_프로모션을_센다(priors):
    service = PlacementService(PopupStore(), PlacementEngine(cafe_catalog(), priors, Params(base_order="first_tier")))
    service.popup_promotions = PROMOS
    out = service.evaluate_payment(1, NINE, "CAFE", 6_000, used_card=201, merchant_id=HOLLYS)
    assert out["used_promotion"] == 600
