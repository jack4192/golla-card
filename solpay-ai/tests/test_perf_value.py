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


def test_월_계획은_지난달_현장결제와_고정결제를_나눈다(consent_state):
    consent_state.apply(pay(101, 300_000, "CAFE", at(9, 10)))
    consent_state.apply(online(102, 90_000, at(9, 10)))
    consent_state.roll_to("2026-10")
    plan = month_plan(consent_state)
    assert plan.daily_place == pytest.approx(10_000)
    assert plan.daily_fixed == {102: pytest.approx(3_000)}
    budget = budget_at(plan, at(10, 30))
    assert budget.days == 1.5
    assert budget.total == pytest.approx(15_000)
