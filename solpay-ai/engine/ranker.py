"""3~5단계: 카드별 원화 점수, 기본 카드, 교체, 2장 표시."""

from dataclasses import dataclass
from datetime import datetime

from engine.benefit_calc import evaluate
from engine.domain import Promotion, UserCard
from engine.params import BASE_ORDER_FIRST_TIER, Params
from engine.perf_value import Budget, MonthPlan, budget_at, month_plan, perf_gain, remaining_need
from engine.scenarios import ScenarioSet
from engine.state import UserState

REASON_BENEFIT = "benefit"
REASON_PERFORMANCE = "performance"


@dataclass
class CardScore:
    user_card_id: int
    immediate: float                    # 즉시 혜택 기대값
    performance: float                  # 실적 기여 가치
    promotion: float                    # 프로모션 가치
    total: float
    by_category: dict[str, float]


@dataclass
class Decision:
    base: int
    first: int
    second: int | None
    order: list[int]
    scores: dict[int, CardScore]
    swapped: bool
    swap_reason: str | None
    repeat_applied: bool
    gain: float
    evidence: float


def choose_base_card(state: UserState, cards: list[UserCard], plan: MonthPlan, budget: Budget,
                     params: Params) -> int:
    """1차: 첫 구간을 못 채운 첫 카드. 2차: 최고 구간을 못 채운 첫 카드. 없으면 원래 1번 카드."""
    catalog = state.catalog
    limit = params.unreachable_sigma * budget.sigma
    if params.base_order == BASE_ORDER_FIRST_TIER:
        for card in cards:
            first = catalog.first_tier(card.card_id)
            if first is None or state.perf(card.user_card_id) >= first:
                continue
            if remaining_need(state, plan, card.user_card_id, first, budget.days) <= budget.total + limit:
                return card.user_card_id
    left = budget.total
    for card in cards:
        top = catalog.top_tier(card.card_id)
        if top is None:
            continue
        need = remaining_need(state, plan, card.user_card_id, top, budget.days)
        if state.perf(card.user_card_id) < top and need <= left + limit:
            return card.user_card_id
        if need > 0:
            left = max(left - need, 0)
    return cards[0].user_card_id


def _promotion_value(promotions: list[Promotion], merchants: dict[int, float], card_id: int,
                     amounts: tuple[int, ...], at: datetime) -> float:
    total = 0.0
    for promotion in promotions:
        share = merchants.get(promotion.merchant_id, 0.0)
        if share:
            total += share * sum(promotion.value(card_id, a, at) for a in amounts) / len(amounts)
    return total


def score_cards(state: UserState, cards: list[UserCard], scenarios: ScenarioSet, at: datetime, plan: MonthPlan,
                budget: Budget, params: Params, promotions: list[Promotion]) -> dict[int, CardScore]:
    """점수 = w1 × 즉시 혜택 + w2 × 실적 기여 가치 + w3 × 프로모션 가치."""
    catalog = state.catalog
    scores = {}
    left = budget.total
    for card_row in cards:
        uc, card_id = card_row.user_card_id, card_row.card_id
        card, st = catalog.cards[card_id], state.ledger[uc]
        gains = plan.gains.get(uc, [])
        fixed_left = plan.daily_fixed.get(uc, 0.0) * budget.days
        immediate = performance = promotion = 0.0
        by_category = {}
        for s in scenarios.scenarios:
            value = sum(evaluate(card, s.category, a, st, at)[0] for a in s.amounts) / len(s.amounts)
            promo = _promotion_value(promotions, s.merchants, card_id, s.amounts, at)
            by_category[s.category] = value + promo     # 근거 확률과 2장 판단은 받는 혜택 전체로 본다
            immediate += s.prob * value
            performance += s.prob * sum(perf_gain(a, left, budget.sigma, gains, st.perf, fixed_left)
                                        for a in s.amounts) / len(s.amounts)
            promotion += s.prob * promo
        scores[uc] = CardScore(uc, immediate, performance, promotion,
                               params.w1 * immediate + params.w2 * performance + params.w3 * promotion, by_category)
        top = catalog.top_tier(card_id)
        if top is not None:
            need = remaining_need(state, plan, uc, top, budget.days)
            if need > 0:
                left = max(left - need, 0)
    return scores


def _second_card(scores: dict[int, CardScore], scenarios: ScenarioSet, order: list[int], first: int,
                 params: Params) -> int | None:
    """가맹점이나 금액에 따라 1위가 갈리거나, 1·2위 차이가 작으면 2장을 보여 준다."""
    for s in scenarios.scenarios:
        if s.prob < params.scenario_min_prob:
            continue
        winner = max(order, key=lambda uc: (scores[uc].by_category[s.category], -order.index(uc)))
        loss = scores[winner].by_category[s.category] - scores[first].by_category[s.category]
        if winner != first and loss >= params.two_card_loss:
            return winner
    if len(order) > 1 and first == order[0]:
        top, runner = scores[order[0]].total, scores[order[1]].total
        if top >= params.two_card_loss and top - runner <= params.top_gap_ratio * top:
            return order[1]
    return None


def decide(state: UserState, cards: list[UserCard], scenarios: ScenarioSet, at: datetime, params: Params,
           promotions: list[Promotion]) -> Decision:
    plan = month_plan(state)
    budget = budget_at(plan, at)
    base = choose_base_card(state, cards, plan, budget, params)
    scores = score_cards(state, cards, scenarios, at, plan, budget, params, promotions)
    positions = {c.user_card_id: i for i, c in enumerate(cards)}
    order = sorted(positions, key=lambda uc: (-scores[uc].total, positions[uc]))
    top = order[0]
    gain = scores[top].total - scores[base].total
    evidence = sum(s.prob for s in scenarios.scenarios
                   if scores[top].by_category[s.category] > scores[base].by_category[s.category])
    perf_part = scores[top].performance - scores[base].performance
    repeat_applied = scenarios.repeat_category is not None
    swapped = gain >= params.switch_threshold and (
        evidence >= params.evidence_prob or perf_part >= gain / 2 or repeat_applied)
    first = top if swapped else base
    second = None if repeat_applied else _second_card(scores, scenarios, order, first, params)
    reason = None
    if swapped:
        reason = REASON_PERFORMANCE if perf_part >= gain / 2 else REASON_BENEFIT
    rest = [uc for uc in order if uc not in (first, second)]
    final_order = [first] + ([second] if second is not None else []) + rest
    return Decision(base, first, second, final_order, scores, swapped, reason, repeat_applied, gain, evidence)
