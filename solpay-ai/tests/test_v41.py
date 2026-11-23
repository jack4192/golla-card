"""설계서 v4.1: 구간 지키기 · 금액 비례 교체 기준 · 즉시 혜택 점수 · 항상 1장 · 방식 ① 구간 가치 순."""

from engine.domain import User
from engine.params import Params
from engine.perf_value import budget_at, month_plan
from engine.ranker import choose_base_card
from engine.state import UserState
from tests.conftest import USER_CARDS, at, pay


def fresh_state(catalog, params, sep_payments):
    """9월 결제(sep_payments)를 넣고 10월로 넘긴 상태."""
    state = UserState(User(1), USER_CARDS, catalog, params)
    for p in sep_payments:
        state.apply(p)
    state.roll_to("2026-10")
    return state


def base_of(state, params, when=None):
    plan = month_plan(state)
    return choose_base_card(state, state.cards, plan, budget_at(plan, when or at(10, 2)), params)


def low_first_tiers():
    """9월: 카페 20만 원(101)·음식점 28만 원(102). 두 카드 모두 첫 구간(30만) 아래라 지킬 구간이 없다.
    첫 구간 가치는 101(카페 10%, 한도 1만) < 102(음식점 10%, 한도 2만)."""
    rows = [pay(101, 10_000, "CAFE", at(9, d)) for d in range(1, 21)]
    rows += [pay(102, 20_000, "REST", at(9, d, 19)) for d in range(1, 15)]
    return rows


def test_방식1은_첫_구간_가치가_큰_카드부터_채운다(catalog):
    value = Params(base_order="first_tier")
    assert base_of(fresh_state(catalog, value, low_first_tiers()), value) == 102


def test_방식1을_사용자_순서로_두면_첫_카드부터_채운다(catalog):
    user = Params(base_order="first_tier", first_tier_order="user")
    assert base_of(fresh_state(catalog, user, low_first_tiers()), user) == 101


# ---------- Task 2: 교체 기준 = 기본 카드의 실적 가치, 점수 = 즉시 혜택, 항상 1장 ----------
import pytest

from engine.domain import Promotion, UserCard
from engine.perf_value import Budget, MonthPlan, switch_threshold
from engine.ranker import CardScore, decide, v4_swap
from engine.scenarios import MODE_TIME, Scenario, ScenarioSet


def october_state(catalog, params, perf_101=0):
    state = UserState(User(1), USER_CARDS, catalog, params)
    state.roll_to("2026-10")
    if perf_101:
        state.apply(pay(101, perf_101, "CAFE", at(10, 1)))
    return state


def test_교체_기준은_기본_카드의_실적_가치다(catalog):
    """설계서 6단계 예시: N=12만, G=9,600, B=30만, σ=10만, 6,700원 결제 → 약 515원 (p=Φ(1.8))."""
    state = october_state(catalog, Params(), perf_101=280_000)
    plan = MonthPlan(0.0, {}, {101: [(400_000, 9_600)]})
    value = switch_threshold(state, plan, Budget(15.5, 300_000, 100_000), 101, 6_700)
    assert value == pytest.approx(6_700 * 9_600 * 0.96407 / 120_000, abs=1)


def test_구간이_없거나_이미_채웠으면_교체_기준은_0원(catalog):
    state = october_state(catalog, Params(), perf_101=450_000)
    budget = Budget(15.5, 300_000, 100_000)
    assert switch_threshold(state, MonthPlan(0.0, {}, {}), budget, 101, 6_700) == 0
    assert switch_threshold(state, MonthPlan(0.0, {}, {101: [(400_000, 9_600)]}), budget, 101, 6_700) == 0


def score(uc, total, by_category):
    return CardScore(uc, total, 0.0, 0.0, total, by_category)


SCEN = ScenarioSet([Scenario("CAFE", 0.6, (5_000,)), Scenario("REST", 0.4, (12_000,))], MODE_TIME, (False, 3))


def test_v4는_이득이_교체_기준보다_크고_근거가_있으면_교체():
    scores = {101: score(101, 300, {"CAFE": 500, "REST": 0}), 102: score(102, 100, {"CAFE": 0, "REST": 250})}
    first, swapped, gain, evidence = v4_swap(scores, SCEN, [101, 102], 102, 150.0, Params(), False)
    assert (first, swapped, gain, evidence) == (101, True, 200, pytest.approx(0.6))
    first, swapped, _, _ = v4_swap(scores, SCEN, [101, 102], 102, 250.0, Params(), False)
    assert (first, swapped) == (102, False)                     # 이득 200원 ≤ 교체 기준 250원


def test_v4는_건당_500원_이상_더_주면_실적_가치를_넘지_않아도_교체():
    """2026-11-23 사용자 결정: 실적 가치(교체 기준)가 커도 점수 차이가 500원 이상이면 바꾼다. 근거 확률 조건은 그대로."""
    scores = {101: score(101, 650, {"CAFE": 900, "REST": 200}), 102: score(102, 100, {"CAFE": 0, "REST": 250})}
    first, swapped, gain, _ = v4_swap(scores, SCEN, [101, 102], 102, 2_000.0, Params(), False)
    assert (first, swapped, gain) == (101, True, 550)              # 교체 기준 2,000원이어도 550원 ≥ 500원
    scores[101] = score(101, 590, {"CAFE": 800, "REST": 200})
    first, swapped, gain, _ = v4_swap(scores, SCEN, [101, 102], 102, 2_000.0, Params(), False)
    assert (first, swapped, gain) == (102, False, 490)             # 490원은 예외가 아니다
    off = Params(big_gain_swap=0)
    scores[101] = score(101, 650, {"CAFE": 900, "REST": 200})
    assert v4_swap(scores, SCEN, [101, 102], 102, 2_000.0, off, False)[:2] == (102, False)   # 0 이면 끈다 (v4.2)


def test_v4는_500원_예외도_근거_확률이_낮으면_교체하지_않는다():
    scores = {101: score(101, 700, {"CAFE": 0, "REST": 3_500}), 102: score(102, 100, {"CAFE": 170, "REST": 0})}
    scen = ScenarioSet([Scenario("CAFE", 0.8, (5_000,)), Scenario("REST", 0.2, (12_000,))], MODE_TIME, (False, 3))
    assert v4_swap(scores, scen, [101, 102], 102, 2_000.0, Params(), False)[:2] == (102, False)


def test_v4는_근거_확률이_낮으면_교체하지_않는다():
    scores = {101: score(101, 300, {"CAFE": 0, "REST": 750}), 102: score(102, 100, {"CAFE": 170, "REST": 0})}
    scen = ScenarioSet([Scenario("CAFE", 0.8, (5_000,)), Scenario("REST", 0.2, (12_000,))], MODE_TIME, (False, 3))
    first, swapped, _, evidence = v4_swap(scores, scen, [101, 102], 102, 0.0, Params(), False)
    assert (first, swapped, evidence) == (102, False, pytest.approx(0.2))


def test_v4는_항상_1장이고_점수에는_실적_가치가_없다(catalog):
    """v4.2: 점수 = 즉시 혜택 + 프로모션. promo_in_score=False 면 v4.1 처럼 프로모션도 뺀다."""
    promo = Promotion(1, "카페", at(10, 1), at(10, 31), frozenset({10}), issuer="SHINHAN", amount=3_000)
    scen = ScenarioSet([Scenario("CAFE", 0.5, (5_000,), {10: 1.0}), Scenario("REST", 0.5, (20_000,))],
                       MODE_TIME, (False, 3))
    params = Params(base_order="first_tier")
    d = decide(fresh_state(catalog, params, low_first_tiers()), USER_CARDS, scen, at(10, 2), params, [promo])
    assert d.second is None
    assert all(s.total == pytest.approx(s.immediate + s.promotion) for s in d.scores.values())
    assert [d.scores[uc].promotion for uc in (101, 102, 103)] == pytest.approx([1_500, 1_500, 0])   # 0.5 × 3,000원
    off = Params(base_order="first_tier", promo_in_score=False)
    d = decide(fresh_state(catalog, off, low_first_tiers()), USER_CARDS, scen, at(10, 2), off, [promo])
    assert all(s.total == pytest.approx(s.immediate) and s.promotion == 0 for s in d.scores.values())


# ---------- Task 3: 안내 문구 ----------
from engine.messages import HOLD, card_message


def test_구간_지키기면_지키기_문구(catalog):
    """9월 101 카페 60만 원(50만 원 구간을 받는 중), 10월은 10만 원 → 구간 지키기로 101이 기본 카드."""
    params = Params(base_order="first_tier")
    state = fresh_state(catalog, params, [pay(101, 20_000, "CAFE", at(9, d)) for d in range(1, 31)])
    state.apply(pay(101, 100_000, "CAFE", at(10, 1)))
    scen = ScenarioSet([Scenario("CAFE", 1.0, (5_000,))], MODE_TIME, (False, 3))
    d = decide(state, state.cards, scen, at(10, 2), params, [])
    assert d.hold and d.first == 101 and not d.swapped
    message = card_message(state, catalog, d, scen, 101, at(10, 2), params, False)
    assert message.code == HOLD
    assert "50만 원 구간까지 400,000원 남았어요" in message.text
