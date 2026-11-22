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


def test_기본_카드는_첫_구간을_못_채운_첫_카드다(state, params):
    ready(state)
    assert base_of(state, params) == 101
    state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(state, params) == 102
    state.apply(online(102, 300_000, at(10, 1)))
    assert base_of(state, params) == 103


def test_모든_첫_구간을_채우면_최고_구간_순서로_간다(state, params):
    ready(state)
    for uc, amount in ((101, 300_000), (102, 300_000), (103, 200_000)):
        state.apply(online(uc, amount, at(10, 1)))
    assert base_of(state, params) == 101
    state.apply(online(101, 200_000, at(10, 1)))
    assert base_of(state, params) == 101     # 전부 채우면 원래 1번 카드


def test_순서_규칙이면_1번_카드의_최고_구간까지_채운다(state):
    ready(state)
    params = Params(base_order=BASE_ORDER_TOP_TIER)
    state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(state, params) == 101
    state.apply(online(101, 200_000, at(10, 1)))
    assert base_of(state, params) == 102


def test_매월_1일에는_1번_카드부터_다시_시작한다(state, params):
    ready(state)
    state.apply(online(101, 300_000, at(10, 1)))
    state.roll_to("2026-11")
    assert base_of(state, params, at(11, 1)) == 101


def test_채울_수_없는_카드는_건너뛴다(state, params):
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000})   # 현장 결제 예산 0
    state.apply(online(101, 300_000, at(10, 1)))
    assert base_of(state, params, at(10, 31)) == 101


def test_이전_규칙에서는_실적_조건이_없는_카드가_기본_카드가_되지_않는다(catalog, params):
    from engine.domain import User
    from engine.state import UserState
    old = params.with_(base_value_check=False, base_fallback="first")
    cards = [UserCard(104, 4, "SHINHAN", 1), UserCard(101, 1, "SHINHAN", 2)]
    state = UserState(User(1), cards, catalog, old)
    state.apply(pay(101, 3_000_000, "CVS", at(9, 1)))
    state.roll_to("2026-10")
    assert base_of(state, old) == 101


def _two_card_state(catalog, params, last_month_category):
    """1번: 카페 10%(첫 구간 30만), 2번: 무실적 전 업종 0.5%. 지난달 현장 결제 100만 원은 모두 한 업종."""
    from engine.domain import User
    from engine.state import UserState
    cards = [UserCard(101, 1, "SHINHAN", 1), UserCard(104, 4, "SHINHAN", 2)]
    state = UserState(User(1), cards, catalog, params)
    state.apply(pay(101, 1_000_000, last_month_category, at(9, 1)))
    state.roll_to("2026-10")
    return state


def test_구간_혜택보다_포기하는_혜택이_크면_건너뛰고_혜택률_1위_카드를_기본으로(catalog, params):
    state = _two_card_state(catalog, params, "CVS")      # 카페 결제가 없어 1번 카드 구간 가치는 0
    assert base_of(state, params) == 104
    assert base_of(state, params.with_(base_value_check=False, base_fallback="first")) == 101   # 이전 규칙


def test_구간_혜택이_포기하는_혜택보다_크면_그_카드부터_채운다(catalog, params):
    state = _two_card_state(catalog, params, "CAFE")     # 카페 10% 한도 2만 원 > 무실적 0.5%
    assert base_of(state, params) == 101


def test_이득이_전환_기준보다_작으면_교체하지_않는다(state, params):
    ready(state)
    state.apply(online(102, 400_000, at(10, 1)))
    state.apply(online(101, 600_000, at(10, 1)))
    state.apply(online(103, 300_000, at(10, 1)))
    d = decide(state, state.cards, scen(("REST", 1.0, (2_900,))), at(10, 2), params, [])
    assert not d.swapped and d.first == d.base


def test_이득이_기준_이상이면_교체한다(state, params):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    d = decide(state, state.cards, scen(("REST", 1.0, (15_000,))), at(10, 2), params, [])
    assert d.swapped and d.first == 102 and d.swap_reason == "benefit"
    assert d.gain == pytest.approx(1_500)


def test_근거_확률이_낮으면_교체하지_않는다(state, params):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    d = decide(state, state.cards,
               scen(("REST", 0.25, (100_000,)), ("TRANSIT", 0.75, (1_500,))), at(10, 2), params, [])
    assert d.evidence == 0.25 and not d.swapped


def test_달성이_걸린_카드로_실적_교체한다(state, params):
    """기본 카드는 걸린 혜택이 없고, 카드 3은 이번 결제가 달성을 크게 바꾼다."""
    state = state
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state.apply(online(101, 600_000, at(10, 1)))
    state.ledger[102].perf = 120_000
    state.ledger[103].perf = 120_000
    plan = month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[102] = [(300_000, 0)]
    plan.gains[103] = [(200_000, 30_000)]
    params = params.with_(month_end_days=0)          # 교체 규칙만 본다 (월말 정리는 아래 테스트)
    d = decide(state, state.cards, scen(("CVS", 1.0, (30_000,))), at(10, 29), params, [])
    assert d.base == 102
    assert d.scores[103].performance > 300
    assert d.swapped and d.first == 103 and d.swap_reason == "performance"


def test_월말에는_남은_금액이_가장_적은_구간을_먼저_채운다(state, params):
    """10/29(남은 3일): 카드 2는 30만 원까지 18만 원, 카드 3은 20만 원까지 8만 원 남음 → 카드 3을 기본 카드로."""
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state.ledger[102].perf = 120_000
    state.ledger[103].perf = 120_000
    params = params.with_(month_end_days=7)          # 기본은 꺼져 있다
    plan = month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[101] = []
    plan.gains[102] = [(300_000, 20_000)]
    plan.gains[103] = [(200_000, 5_000)]
    d = decide(state, state.cards, scen(("CVS", 1.0, (30_000,))), at(10, 29), params, [])
    assert d.base == 103
    d = decide(state, state.cards, scen(("CVS", 1.0, (30_000,))), at(10, 29), params.with_(month_end_days=0), [])
    assert d.base == 102                                # 끄면 원래 전략(모든 첫 구간 먼저, 기본 순서)


def test_월말에는_예상_소비로_못_닿는_구간을_포기한다(state, params):
    """남은 2.5일 예상 소비가 약 3.3만 원인데 구간까지 5만 원이면, 평소(2σ 여유)와 달리 월말에는 채우지 않는다."""
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=400_000)
    state.ledger[102].perf = 250_000
    params = params.with_(month_end_days=7)          # 기본은 꺼져 있다
    plan = month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[101], plan.gains[103] = [], []
    plan.gains[102] = [(300_000, 20_000)]
    budget = budget_at(plan, at(10, 29), state)
    assert budget.total < 50_000 <= budget.total + params.unreachable_sigma * budget.sigma
    assert choose_base_card(state, state.cards, plan, budget, params.with_(month_end_days=0)) == 102
    assert choose_base_card(state, state.cards, plan, budget, params) != 102


def test_손해_방지가_켜지면_실적을_채우지_않고_혜택률_1위_카드를_기본_카드로(state, params):
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state.ledger[102].perf = 120_000
    plan = month_plan(state)
    plan.gains[102] = [(300_000, 20_000)]
    plan.rates = {101: 0.001, 102: 0.002, 103: 0.009, 104: 0.005}
    budget = budget_at(plan, at(10, 7), state)
    assert choose_base_card(state, state.cards, plan, budget, params) != 103
    state.loss_guard = True
    assert choose_base_card(state, state.cards, plan, budget, params) == 103


def test_시나리오에_따라_1위가_갈리면_2장을_보여준다(state, params):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    d = decide(state, state.cards,
               scen(("REST", 0.6, (15_000,)), ("CAFE", 0.4, (5_000,))), at(10, 2), params, [])
    assert d.first == 102 and d.second == 101
    assert d.order[:2] == [102, 101]


def test_손실이_기준보다_작으면_2장을_보여주지_않는다(state, params):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    d = decide(state, state.cards,
               scen(("REST", 0.7, (15_000,)), ("CAFE", 0.3, (2_500,))), at(10, 2), params, [])
    assert d.first == 102 and d.second is None


def test_반복_구간은_1위_업종으로_1장만_보여준다(state, params):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    d = decide(state, state.cards,
               scen(("REST", 1.0, (15_000,)), mode=MODE_REPEAT, repeat="REST"), at(10, 2), params, [])
    assert d.repeat_applied and d.first == 102 and d.second is None


def promo(**kw):
    base = dict(promotion_id=1, brand="카페", starts_at=at(10, 1), ends_at=at(10, 31, 23, 59), merchant_ids=frozenset({10}),
                issuer="KB", amount=2_000, min_amount=5_000, kind="myshop")
    return Promotion(**{**base, **kw})


def all_filled(state):
    ready(state)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    return ScenarioSet([Scenario("CVS", 1.0, (5_000,), {10: 1.0})], MODE_TIME, SLOT)


def test_프로모션_가치를_점수에_더하고_교체한다(state, params):
    set_ = all_filled(state)
    d = decide(state, state.cards, set_, at(10, 2), params, [promo()])
    assert d.scores[103].promotion == 2_000 and d.scores[103].promotion_label == "카페 마이샵 2,000원"
    assert d.first == 103 and d.swapped


def test_프로모션은_지정_카드사에만_적용된다(state, params):
    set_ = all_filled(state)
    d = decide(state, state.cards, set_, at(10, 2), params, [promo(issuer="SHINHAN")])
    assert d.scores[103].promotion == 0 and d.scores[101].promotion == 2_000 and d.scores[102].promotion == 2_000
    everyone = decide(state, state.cards, set_, at(10, 2), params, [promo(issuer=None)])
    assert all(everyone.scores[uc].promotion == 2_000 for uc in (101, 102, 103))


def test_프로모션_기간_가맹점_최소금액_확인불가(state, params):
    set_ = all_filled(state)
    score = lambda promotions: decide(state, state.cards, set_, at(10, 2), params, promotions).scores[103].promotion
    assert score([promo(starts_at=at(9, 1), ends_at=at(9, 30))]) == 0
    assert score([promo(merchant_ids=frozenset({11}))]) == 0
    assert score([promo(min_amount=10_000)]) == 0
    assert score([promo(needs_check=True)]) == 0


def test_비율_프로모션은_건당_한도를_넘지_않는다(state, params):
    set_ = all_filled(state)
    big = ScenarioSet([Scenario("CVS", 1.0, (100_000,), {10: 1.0})], MODE_TIME, SLOT)
    d = decide(state, state.cards, big, at(10, 2), params, [promo(amount=None, rate=0.25, max_amount=20_000)])
    assert d.scores[103].promotion == 20_000
    d = decide(state, state.cards, set_, at(10, 2), params, [promo(amount=None, rate=0.25, max_amount=20_000)])
    assert d.scores[103].promotion == 1_250


def test_가맹점_후보_확률만큼_프로모션을_나눈다(state, params):
    all_filled(state)
    half = ScenarioSet([Scenario("CVS", 1.0, (5_000,), {10: 0.5, 11: 0.5})], MODE_TIME, SLOT)
    d = decide(state, state.cards, half, at(10, 2), params, [promo()])
    assert d.scores[103].promotion == 1_000


def test_요청_객체에는_위치가_없다():
    assert not hasattr(RankRequest(1, at()), "lat")          # GPS 는 받지 않는다


def test_일정이_향후_실적_가치에_반영된다(catalog, params):
    from datetime import timedelta
    from engine.domain import User, ScheduleItem
    from engine.state import UserState
    from engine.perf_value import MonthPlan
    settings = params.with_(base_order='none', base_fallback='first', tier_gain_mode='standalone')
    cards = [UserCard(101, 1, 'SHINHAN', 1), UserCard(104, 4, 'SHINHAN', 2)]
    state = UserState(User(1), cards, catalog, settings)
    state.roll_to('2026-10')
    state.apply(online(101, 270000, at(10, 1)))
    state.plan = MonthPlan(10000, {}, {101: [(300000, 10000)]}, {101: .02, 104: .005})
    when = at(10, 30, 12)
    scenarios = scen(('CAFE', 1.0, (10000,)))
    later = ScheduleItem(1, 1, when+timedelta(hours=3), when+timedelta(hours=4), 'REST', 10000)
    without = decide(state, cards, scenarios, when, settings, [])
    with_schedule = decide(state, cards, scenarios, when, settings, [], [later])
    assert with_schedule.scores[101].performance > without.scores[101].performance


# ---------- 기본 카드를 정한 단계 (월간 리포트의 전략 문장이 엔진이 하는 일과 맞도록) ----------
from engine.ranker import choose_base


def test_choose_base_는_choose_base_card_와_같은_카드와_정한_단계를_준다(state, params, catalog):
    from engine.params import BASE_ORDER_NONE
    from tests.test_v41 import fresh_state
    ready(state)
    plan = month_plan(state)
    budget = budget_at(plan, at(10, 2))
    assert choose_base(state, state.cards, plan, budget, params) == (base_of(state, params), "strategy")
    # 실적 안 채움: 방식이 고르는 카드가 없어 혜택률 1위(없으면 1번) 카드 = 채우지 않는다
    none = params.with_(base_order=BASE_ORDER_NONE)
    assert choose_base(state, state.cards, plan, budget, none) == (choose_base_card(state, state.cards, plan, budget, none),
                                                                     "nothing")
    # 손해 방지: 실적 채우기를 멈춘다
    state.loss_guard = True
    assert choose_base(state, state.cards, plan, budget, params)[1] == "loss_guard"
    # 구간 지키기는 어느 방식보다 먼저 (실적 안 채움이어도)
    v4_none = Params(base_order=BASE_ORDER_NONE)
    held = fresh_state(catalog, v4_none, [pay(101, 20_000, "CAFE", at(9, d)) for d in range(1, 31)])
    held.apply(pay(101, 100_000, "CAFE", at(10, 1)))
    plan = month_plan(held)
    assert choose_base(held, held.cards, plan, budget_at(plan, at(10, 2)), v4_none) == (101, "hold")


def test_decide_는_기본_카드를_정한_단계를_남긴다(state, params):
    ready(state)
    s = scen(("CAFE", 1.0, (5_000,)))
    assert decide(state, state.cards, s, at(10, 2), params, []).base_source == "strategy"
    v4 = Params(base_order="first_tier")
    assert decide(state, state.cards, s, at(10, 2), v4, [], no_fill={101, 102, 103}).base_source == "no_fill"
