"""실적 채우기 전략 B(주력 카드 높은 구간 먼저)·C(예산 배분)와 사용자 맞춤 자동 선택."""

from engine.domain import User, UserCard
from engine.params import STRATEGIES, Params
from engine.perf_value import budget_at, month_plan
from engine.ranker import choose_base_card, tier_targets
from engine.state import UserState
from engine.strategy import TIE_ORDER, choose, features, self_scores, simulate
from tests.conftest import at, fill_previous_month, online, pay


def state_with(catalog, params, place_category="CAFE", place=1_000_000):
    """1번: 카페 10%(30만 1만 원, 50만 2만 원), 2번: 음식점 10%(30만 2만 원), 3번: 교통 5%(20만 5천 원)."""
    cards = [UserCard(101, 1, "SHINHAN", 1), UserCard(102, 2, "SHINHAN", 2), UserCard(103, 3, "KB", 3)]
    state = UserState(User(1), cards, catalog, params)
    state.apply(pay(101, place, place_category, at(9, 1)))
    state.apply(pay(102, 500_000, "REST", at(9, 2), merchant=11))
    state.roll_to("2026-10")
    return state


def base(state, params, when=None):
    plan = month_plan(state)
    return choose_base_card(state, state.cards, plan, budget_at(plan, when or at(10, 2)), params)


def test_B는_구간_혜택이_큰_카드의_높은_구간부터_채운다(catalog):
    params = Params(base_order="main_top", hold_tiers=False)   # 전략만 본다 (구간 지키기 끔)
    state = state_with(catalog, params)
    plan = month_plan(state)
    gains = {uc: sum(g for _, g in plan.gains.get(uc, [])) for uc in (101, 102, 103)}
    assert base(state, params) == max(gains, key=gains.get)


def test_C는_예산_안에서_가치가_가장_큰_구간_조합을_고른다(catalog):
    params = Params(base_order="value", hold_tiers=False)
    state = state_with(catalog, params)
    plan = month_plan(state)
    budget = budget_at(plan, at(10, 2))
    targets = tier_targets(state, state.cards, plan, budget, params)
    assert sum(need for _, _, need in targets) <= budget.total + params.unreachable_sigma * budget.sigma
    assert all(low > state.perf(card.user_card_id) for card, low, _ in targets)


def test_본인_시뮬레이션은_지난달_결제로_세_전략_점수를_낸다(catalog):
    params = Params(base_order="auto")
    state = state_with(catalog, params)
    plan = month_plan(state)
    scores = self_scores(state, plan)
    assert set(scores) == set(STRATEGIES) and all(v >= 0 for v in scores.values())
    assert plan.strategy == max(TIE_ORDER, key=lambda s: (scores[s], -TIE_ORDER.index(s)))


def test_시뮬레이션은_현장_결제만_다시_고르고_나머지는_실제_카드다(catalog):
    params = Params(base_order="auto")
    state = state_with(catalog, params)
    rows = [online(103, 400_000, at(10, 3)), pay(101, 20_000, "CAFE", at(10, 4))]
    score = simulate(state, "first_tier", rows, {101: 1_000_000, 102: 500_000, 103: 0}, month_plan(state), params)
    assert score >= 2_000                          # 카페 2만 원은 카페 10% 카드로


def test_지난달_결제가_없으면_B를_쓴다(catalog):
    params = Params(base_order="auto")
    state = UserState(User(1), [UserCard(101, 1, "SHINHAN", 1)], catalog, params)
    state.roll_to("2026-10")
    assert month_plan(state).strategy == TIE_ORDER[0] == "main_top"


def test_전략은_사용자와_달마다_한_번만_계산한다(catalog):
    params = Params(base_order="auto")
    state = state_with(catalog, params)
    state.strategy_cache = {}
    first = choose(state, month_plan(state))
    assert len(state.strategy_cache) == 1
    state.strategy_cache[next(iter(state.strategy_cache))] = ("value", {})
    assert choose(state, month_plan(state)) == ("value", {})
    assert first[0] in STRATEGIES


def test_전략_선택_입력은_고정_길이다(catalog):
    from engine.strategy import FEATURES
    state = state_with(catalog, Params(base_order="auto"))
    plan = month_plan(state)
    assert len(features(state, plan, self_scores(state, plan))) == len(FEATURES)


def test_구간_가치는_다른_카드로도_받는_혜택을_빼고_센다(catalog):
    """카페 10% 카드(1번)의 30만 구간 가치: 혼자 쓸 때보다, 전 업종 0.5% 카드(4번)가 있을 때 작다."""
    from engine.perf_value import marginal_tier_gains, tier_gains
    params = Params(base_order="first_tier", tier_gain_mode="marginal")
    cards = [UserCard(101, 1, "SHINHAN", 1), UserCard(104, 4, "SHINHAN", 2)]
    state = UserState(User(1), cards, catalog, params)
    for day in range(1, 21):
        state.apply(pay(101, 30_000, "CAFE", at(9, day)))
    state.roll_to("2026-10")
    standalone = dict(tier_gains(catalog.cards[1], catalog.tiers[1], state.prev_rows, catalog))
    marginal = dict(marginal_tier_gains(state, state.prev_rows)[101])
    assert 0 < marginal[300_000] < standalone[300_000]
