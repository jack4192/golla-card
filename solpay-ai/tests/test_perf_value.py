import pytest

from engine.perf_value import budget_at, month_benefit, month_plan, perf_gain, tier_gains
from tests.conftest import at, online, pay


@pytest.mark.parametrize("need,expected", [(120_000, 3_430), (30_000, 10), (300_000, 0)])
def test_설계서_예시와_같다(need, expected):
    value = perf_gain(15_000, 100_000, 22_000, [(need, 15_000)], perf=0, fixed_left=0)
    assert value == pytest.approx(expected, abs=20)


def test_이미_넘긴_구간은_계산에서_빠진다():
    tiers = [(300_000, 10_000), (500_000, 5_000)]
    upper = perf_gain(20_000, 100_000, 30_000, tiers, perf=350_000, fixed_left=0)
    assert upper == pytest.approx(perf_gain(20_000, 100_000, 30_000, [(500_000, 5_000)], 350_000, 0))


def test_구간_증분은_아래_구간과의_차이다(catalog):
    rows = [pay(101, 150_000, "CAFE", at(9, d)) for d in (1, 2)]
    # 30만 구간 한도 1만, 50만 구간 한도 2만: 월 혜택은 0 → 1만 → 2만
    assert month_benefit(catalog.cards[1], rows, 0) == 0
    assert tier_gains(catalog.cards[1], (300_000, 500_000), rows) == [(300_000, 10_000), (500_000, 10_000)]


def test_고정_결제는_필요액을_줄인다():
    without = perf_gain(10_000, 50_000, 20_000, [(100_000, 10_000)], 0, 0)
    filled = perf_gain(10_000, 50_000, 20_000, [(100_000, 10_000)], 0, 100_000)
    assert without > 0 and filled == 0


def test_월_계획은_지난달_현장결제와_고정결제를_나눈다(state):
    state.apply(pay(101, 300_000, "CAFE", at(9, 10)))
    state.apply(online(102, 90_000, at(9, 10)))
    state.roll_to("2026-10")
    plan = month_plan(state)
    assert plan.daily_place == pytest.approx(10_000)
    assert plan.daily_fixed == {102: pytest.approx(3_000)}
    budget = budget_at(plan, at(10, 30))
    assert budget.days == 1.5
    assert budget.total == pytest.approx(15_000)


def test_순가치_cost_rate_0이면_이전과_같다():
    tiers = [(120_000, 15_000), (300_000, 5_000)]
    assert perf_gain(15_000, 100_000, 22_000, tiers, 0, 0, 0.0) == perf_gain(15_000, 100_000, 22_000, tiers, 0, 0)


def test_순가치는_채우느라_포기하는_혜택을_뺀다():
    gross = perf_gain(15_000, 100_000, 22_000, [(120_000, 15_000)], 0, 0)
    net = perf_gain(15_000, 100_000, 22_000, [(120_000, 15_000)], 0, 0, cost_rate=0.05)   # 12만 × 5% = 6천
    assert net == pytest.approx(gross * 9_000 / 15_000)
    # 포기하는 혜택이 구간 혜택보다 크면 실적 가치가 없다
    assert perf_gain(15_000, 100_000, 22_000, [(120_000, 15_000)], 0, 0, cost_rate=0.2) == 0


def test_카드별_예산은_기본_카드에_나머지_몫을_준다():
    from engine.perf_value import Budget, MonthPlan, card_budget
    plan = MonthPlan(10_000, {}, {}, {}, switch_share={1: 0.0, 2: 0.2, 3: 0.1})
    budget = Budget(10.5, 100_000, 30_000)
    assert card_budget(plan, budget, 1, base=1)[0] == pytest.approx(70_000)
    assert card_budget(plan, budget, 2, base=1)[0] == pytest.approx(20_000)
    left, sigma = card_budget(plan, budget, 2, base=2)          # 2번이 기본 카드면 1·3번 몫만 빠진다
    assert left == pytest.approx(90_000) and sigma == pytest.approx(30_000 * 0.9 ** 0.5)


def test_남은_일정은_오늘_추정액을_대체하고_현재_일정은_중복하지_않는다(state):
    from datetime import timedelta
    from engine.domain import ScheduleItem
    from engine.perf_value import schedule_adjusted_budget
    state.roll_to('2026-10')
    when = at(10, 30, 12)
    from engine.perf_value import MonthPlan
    plan = MonthPlan(10000, {}, {})
    current = ScheduleItem(1, state.user.user_id, when-timedelta(minutes=10), when+timedelta(minutes=20), 'CAFE', 6000)
    future = ScheduleItem(2, state.user.user_id, when+timedelta(hours=3), when+timedelta(hours=4), 'REST', 20000)
    baseline = budget_at(plan, when, state)
    result = schedule_adjusted_budget(plan, when, state, [current, future])
    assert result.total == pytest.approx(baseline.total - 5000 + 20000)
    assert schedule_adjusted_budget(plan, when, state, [current]) == baseline


def test_다른_날과_이미_완료된_일정은_예산에_넣지_않는다(state):
    from datetime import timedelta
    from engine.domain import ScheduleItem
    from engine.perf_value import schedule_adjusted_budget, MonthPlan
    when = at(10, 30, 12)
    state.roll_to('2026-10')
    plan = MonthPlan(10000, {}, {})
    old = ScheduleItem(1, state.user.user_id, when-timedelta(hours=2), when-timedelta(hours=1), 'CAFE', 6000)
    tomorrow = ScheduleItem(2, state.user.user_id, when+timedelta(days=1), when+timedelta(days=1,hours=1), 'REST', 20000)
    assert schedule_adjusted_budget(plan, when, state, [old, tomorrow]) == budget_at(plan, when, state)
