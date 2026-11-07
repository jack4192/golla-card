import pytest

from engine.domain import Promotion, RankRequest, UserCard
from engine.params import BASE_ORDER_TOP_TIER, Params
from engine.perf_value import budget_at, month_plan
from engine.ranker import choose_base_card, decide
from engine.scenarios import MODE_REPEAT, MODE_TIME, Scenario, ScenarioSet
from tests.conftest import at, fill_previous_month, online, pay

SLOT = (False, 3)


def scen(*items, mode=MODE_TIME, repeat=None):
    return ScenarioSet([Scenario(c, p, a) for c, p, a in items], mode, SLOT, repeat_category=repeat)


def ready(state, place=3_000_000):
    """세 카드 모두 전월 실적을 채운 상태."""
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=place)
    return state


def base_of(state, params, when=None):
    plan = month_plan(state)
    return choose_base_card(state, state.cards, plan, budget_at(plan, when or at(10, 2)), params)


def test_기본_카드는_첫_구간을_못_채운_첫_카드다(consent_state, params):
    ready(consent_state)
    assert base_of(consent_state, params) == 101
    consent_state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(consent_state, params) == 102
    consent_state.apply(online(102, 300_000, at(10, 1)))
    assert base_of(consent_state, params) == 103


def test_모든_첫_구간을_채우면_최고_구간_순서로_간다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 300_000), (102, 300_000), (103, 200_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    assert base_of(consent_state, params) == 101
    consent_state.apply(online(101, 200_000, at(10, 1)))
    assert base_of(consent_state, params) == 101     # 전부 채우면 원래 1번 카드


def test_순서_규칙이면_1번_카드의_최고_구간까지_채운다(consent_state):
    ready(consent_state)
    params = Params(base_order=BASE_ORDER_TOP_TIER)
    consent_state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(consent_state, params) == 101
    consent_state.apply(online(101, 200_000, at(10, 1)))
    assert base_of(consent_state, params) == 102


def test_매월_1일에는_1번_카드부터_다시_시작한다(consent_state, params):
    ready(consent_state)
    consent_state.apply(online(101, 300_000, at(10, 1)))
    consent_state.roll_to("2026-11")
    assert base_of(consent_state, params, at(11, 1)) == 101


def test_채울_수_없는_카드는_건너뛴다(consent_state, params):
    fill_previous_month(consent_state, {101: 600_000, 102: 400_000, 103: 300_000})   # 현장 결제 예산 0
    consent_state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(consent_state, params, at(10, 31)) == 101


def test_실적_조건이_없는_카드는_기본_카드가_되지_않는다(catalog, params):
    from engine.domain import User
    from engine.state import UserState
    cards = [UserCard(104, 4, "SHINHAN", 1), UserCard(101, 1, "SHINHAN", 2)]
    state = UserState(User(1), cards, catalog, params)
    state.apply(pay(101, 3_000_000, "CVS", at(9, 1)))
    state.roll_to("2026-10")
    assert base_of(state, params) == 101


def test_이득이_전환_기준보다_작으면_교체하지_않는다(consent_state, params):
    ready(consent_state)
    consent_state.apply(online(102, 400_000, at(10, 1)))
    consent_state.apply(online(101, 600_000, at(10, 1)))
    consent_state.apply(online(103, 300_000, at(10, 1)))
    d = decide(consent_state, consent_state.cards, scen(("REST", 1.0, (2_900,))), at(10, 2), params, [])
    assert not d.swapped and d.first == d.base


def test_이득이_기준_이상이면_교체한다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    d = decide(consent_state, consent_state.cards, scen(("REST", 1.0, (15_000,))), at(10, 2), params, [])
    assert d.swapped and d.first == 102 and d.swap_reason == "benefit"
    assert d.gain == pytest.approx(1_500)


def test_근거_확률이_낮으면_교체하지_않는다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    d = decide(consent_state, consent_state.cards,
               scen(("REST", 0.25, (100_000,)), ("TRANSIT", 0.75, (1_500,))), at(10, 2), params, [])
    assert d.evidence == 0.25 and not d.swapped


def test_달성이_걸린_카드로_실적_교체한다(consent_state, params):
    """기본 카드는 걸린 혜택이 없고, 카드 3은 이번 결제가 달성을 크게 바꾼다."""
    state = consent_state
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state.apply(online(101, 600_000, at(10, 1)))
    state.ledger[102].perf = 120_000
    state.ledger[103].perf = 120_000
    plan = month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[102] = [(300_000, 0)]
    plan.gains[103] = [(200_000, 30_000)]
    d = decide(state, state.cards, scen(("CVS", 1.0, (30_000,))), at(10, 29), params, [])
    assert d.base == 102
    assert d.scores[103].performance > 300
    assert d.swapped and d.first == 103 and d.swap_reason == "performance"


def test_시나리오에_따라_1위가_갈리면_2장을_보여준다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    d = decide(consent_state, consent_state.cards,
               scen(("REST", 0.6, (15_000,)), ("CAFE", 0.4, (5_000,))), at(10, 2), params, [])
    assert d.first == 102 and d.second == 101
    assert d.order[:2] == [102, 101]


def test_손실이_기준보다_작으면_2장을_보여주지_않는다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    d = decide(consent_state, consent_state.cards,
               scen(("REST", 0.7, (15_000,)), ("CAFE", 0.3, (2_500,))), at(10, 2), params, [])
    assert d.first == 102 and d.second is None


def test_반복_구간은_1위_업종으로_1장만_보여준다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    d = decide(consent_state, consent_state.cards,
               scen(("REST", 1.0, (15_000,)), mode=MODE_REPEAT, repeat="REST"), at(10, 2), params, [])
    assert d.repeat_applied and d.first == 102 and d.second is None


def test_프로모션_가치를_점수에_더한다(consent_state, params):
    ready(consent_state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        consent_state.apply(online(uc, amount, at(10, 1)))
    promo = Promotion(1, 10, at(10, 1), at(10, 31), card_id=3, amount=2_000, min_amount=5_000)
    set_ = ScenarioSet([Scenario("CVS", 1.0, (5_000,), {10: 1.0})], MODE_TIME, SLOT)
    d = decide(consent_state, consent_state.cards, set_, at(10, 2), params, [promo])
    assert d.scores[103].promotion == 2_000 and d.first == 103 and d.swapped
    expired = Promotion(1, 10, at(9, 1), at(9, 30), card_id=3, amount=2_000)
    assert decide(consent_state, consent_state.cards, set_, at(10, 2), params, [expired]).scores[103].promotion == 0


def test_요청_객체는_위치_없이도_만든다():
    assert RankRequest(1, at()).lat is None
