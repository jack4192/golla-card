"""4~6단계: 기본 카드, 카드별 원화 점수, 교체 판단.

engine=v4 (설계서 v4.2): 기본 카드 = 구간 지키기 → 방식 → 혜택률 1위, 점수 = 즉시 혜택 + 프로모션
(가게를 모르면 업종 안 브랜드 비중으로), 교체 기준 = 기본 카드의 실적 가치(금액 비례), 항상 1장.
engine=v3 은 이전 결정(아래 _decide_v3)."""

import itertools
from dataclasses import dataclass
from datetime import datetime

from engine.benefit_calc import SOLPAY, evaluate
from engine.domain import Promotion, UserCard
from engine.params import (BASE_ORDER_AUTO, BASE_ORDER_FIRST_TIER, BASE_ORDER_MAIN_TOP, BASE_ORDER_NONE,
                           BASE_ORDER_TOP_TIER, BASE_ORDER_VALUE, Params)
from engine.perf_value import (Budget, MonthPlan, budget_at, card_budget, month_plan, perf_gain, remaining_need,
                               schedule_adjusted_budget, switch_threshold)
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
    promotion_label: str | None = None  # 가장 크게 기여한 프로모션


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
    threshold: float = 0.0              # v4 교체 기준 (기본 카드의 실적 가치, 원)
    hold: bool = False                  # v4 기본 카드가 구간 지키기로 정해졌는지


def month_end(budget: Budget, params: Params) -> bool:
    """달의 마지막 며칠인지 (월말 정리 구간)."""
    return params.month_end_days > 0 and budget.days <= params.month_end_days


def reach_limit(budget: Budget, params: Params) -> float:
    """예상 소비에 더해 줄 여유. 월말에는 줄여서 못 닿는 구간을 일찍 포기한다."""
    sigma = params.month_end_sigma if month_end(budget, params) else params.unreachable_sigma
    return sigma * budget.sigma


def _closest_tier(state, cards, plan, budget, params) -> int | None:
    """월말 우선 채우기: 예상 소비로 닿고 채울 가치가 있는 다음 구간 중 남은 금액이 가장 적은 카드."""
    limit = reach_limit(budget, params)
    best = None
    for card in cards:
        uc, perf = card.user_card_id, state.perf(card.user_card_id)
        nxt = min((lo for lo, _ in plan.gains.get(uc, []) if lo > perf), default=None)
        if nxt is None:
            continue
        need = remaining_need(state, plan, uc, nxt, budget.days)
        if 0 < need <= budget.total + limit and _worth_filling(state, plan, card, nxt, need, params):
            if best is None or need < best[0]:
                best = (need, uc)
    return best[1] if best else None


def _worth_filling(state: UserState, plan: MonthPlan, card: UserCard, target: int, need: float,
                   params: Params) -> bool:
    """구간 증분 혜택(이번 실적 → target) ≥ 남은 필요액 × (혜택률 1위 카드 − 이 카드의 혜택률)."""
    if not params.base_value_check or not plan.rates:
        return True
    perf = state.perf(card.user_card_id)
    gain = sum(g for low, g in plan.gains.get(card.user_card_id, []) if perf < low <= target)
    best = max(plan.rates.values())
    forgone = max(need, 0.0) * max(best - plan.rates.get(card.user_card_id, 0.0), 0.0)
    return gain >= forgone


def _hold_tier(state, cards, plan, budget, params) -> int | None:
    """구간 지키기: 지난달 실적으로 이미 받고 있는 구간을 이번 달에 놓칠 카드가 있으면, 남은 필요액이 가장 적은 카드부터 채운다.
    남은 필요액이 예상 현장 결제(여유 σ 없이) 안일 때만. hold_worth_check 면 채울 가치 확인도 거친다."""
    best = None
    for card in cards:
        uc, tiers = card.user_card_id, state.catalog.tiers[card.card_id]
        if not tiers or uc not in state.ledger:
            continue
        held = max((t for t in tiers if t <= state.ledger[uc].prev_perf), default=None)
        if held is None or state.perf(uc) >= held:
            continue
        need = remaining_need(state, plan, uc, held, budget.days)
        if 0 < need <= budget.total and (not params.hold_worth_check
                                         or _worth_filling(state, plan, card, held, need, params)):
            if best is None or need < best[0]:
                best = (need, uc)
    return best[1] if best else None


def _fallback(cards: list[UserCard], plan: MonthPlan, params: Params) -> int:
    if params.base_fallback == "best_rate" and plan.rates:
        return max(cards, key=lambda c: (plan.rates.get(c.user_card_id, 0.0), -c.display_order)).user_card_id
    return cards[0].user_card_id


def tier_targets(state: UserState, cards: list[UserCard], plan: MonthPlan, budget: Budget,
                 params: Params) -> list[tuple[UserCard, int, float]]:
    """전략 C. 카드마다 목표 구간을 하나씩(목표 없음 포함) 골라 남은 예산(+여유 σ) 안에서
    Σ(구간 증분 혜택 − 남은 필요액 × (혜택률 1위 − 이 카드 혜택률)) 이 가장 큰 조합. (카드, 목표, 필요액)"""
    limit = reach_limit(budget, params)
    rates = plan.rates or {}
    best_rate = max(rates.values(), default=0.0)
    options = []
    for card in cards:
        uc, perf = card.user_card_id, state.perf(card.user_card_id)
        opts, gained = [(card, None, 0.0, 0.0)], 0.0
        for low, gain in plan.gains.get(uc, []):
            if low <= perf:
                continue
            gained += gain
            need = max(remaining_need(state, plan, uc, low, budget.days), 0.0)
            opts.append((card, low, need, gained - need * max(best_rate - rates.get(uc, 0.0), 0.0)))
        options.append(opts)
    best, best_value = (), 0.0
    for combo in itertools.product(*options):
        if sum(o[2] for o in combo) > budget.total + limit:
            continue
        value = sum(o[3] for o in combo)
        if value > best_value:
            best, best_value = combo, value
    return [(o[0], o[1], o[2]) for o in best if o[1] is not None]


def _fill_order(cards, plan: MonthPlan, params: Params) -> tuple[list, list]:
    """방식 ①의 (첫 구간 단계 순서, 최고 구간 단계 순서).
    first_tier_order=value: 첫 구간의 구간 가치가 큰 카드부터 / 구간 가치 합이 큰 카드부터 (같으면 카드 순서).
    user: 둘 다 사용자 카드 순서. 순서 규칙(top_tier)은 1번 카드부터라 늘 사용자 순서다."""
    if params.first_tier_order != "value" or params.base_order == BASE_ORDER_TOP_TIER:
        return list(cards), list(cards)
    pos = {c.user_card_id: i for i, c in enumerate(cards)}
    gains = lambda c: plan.gains.get(c.user_card_id, [])
    first = sorted(cards, key=lambda c: (-(gains(c)[0][1] if gains(c) else 0), pos[c.user_card_id]))
    top = sorted(cards, key=lambda c: (-sum(g for _, g in gains(c)), pos[c.user_card_id]))
    return first, top


def _first_tier(state, cards, plan, budget, params) -> int | None:
    """전략 A: 첫 구간을 못 채운 카드 → 최고 구간을 못 채운 카드. 순서는 _fill_order."""
    catalog = state.catalog
    limit = reach_limit(budget, params)
    first_order, top_order = _fill_order(cards, plan, params)
    if params.base_order != BASE_ORDER_TOP_TIER:
        for card in first_order:
            first = catalog.first_tier(card.card_id)
            if first is None or state.perf(card.user_card_id) >= first:
                continue
            need = remaining_need(state, plan, card.user_card_id, first, budget.days)
            if need <= budget.total + limit and _worth_filling(state, plan, card, first, need, params):
                return card.user_card_id
    left = budget.total
    for card in top_order:
        top = catalog.top_tier(card.card_id)
        if top is None:
            continue
        need = remaining_need(state, plan, card.user_card_id, top, budget.days)
        if (state.perf(card.user_card_id) < top and need <= left + limit
                and _worth_filling(state, plan, card, top, need, params)):
            return card.user_card_id
        if need > 0:
            left = max(left - need, 0)
    return None


def _main_top(state, cards, plan, budget, params) -> int | None:
    """전략 B: 구간 혜택 합이 큰 카드부터, 남은 예산으로 닿는 가장 높은 '채울 가치가 있는' 구간을 채운다."""
    limit = reach_limit(budget, params)
    ranked = sorted(cards, key=lambda c: (-sum(g for _, g in plan.gains.get(c.user_card_id, [])), c.display_order))
    left = budget.total
    for card in ranked:
        uc, perf = card.user_card_id, state.perf(card.user_card_id)
        for low in sorted((lo for lo, _ in plan.gains.get(uc, []) if lo > perf), reverse=True):
            need = remaining_need(state, plan, uc, low, budget.days)
            if need <= left + limit and _worth_filling(state, plan, card, low, need, params):
                if need > 0:
                    return uc
                break
        else:
            continue
    return None


def _value(state, cards, plan, budget, params) -> int | None:
    targets = [t for t in tier_targets(state, cards, plan, budget, params) if t[2] > 0]
    return targets[0][0].user_card_id if targets else None


STRATEGY_FUNCS = {BASE_ORDER_FIRST_TIER: _first_tier, BASE_ORDER_TOP_TIER: _first_tier,
                  BASE_ORDER_MAIN_TOP: _main_top, BASE_ORDER_VALUE: _value,
                  BASE_ORDER_NONE: lambda *args: None}


def strategy_of(plan: MonthPlan, params: Params) -> str:
    if params.base_order == BASE_ORDER_AUTO:
        return plan.strategy or BASE_ORDER_FIRST_TIER
    return params.base_order


def choose_base_card(state: UserState, cards: list[UserCard], plan: MonthPlan, budget: Budget,
                     params: Params) -> int:
    """실적을 채울 기본 카드. 전략(A 첫 구간 / B 주력 카드 높은 구간 / C 예산 배분)은 params.base_order 로 정하고,
    auto 면 이번 달 사용자 맞춤 전략(plan.strategy)을 쓴다. 채울 가치가 없는 구간(구간 증분 혜택 < 포기하는 혜택)은 건너뛴다.
    채울 카드가 없으면 지난달 현장 결제 기준 혜택률 1위 카드 (base_fallback=first 면 원래 1번 카드)."""
    if getattr(state, "loss_guard", False) and params.loss_guard_stop_filling:
        return _fallback(cards, plan, params)          # 손해 방지: 실적 채우기를 멈추고 혜택률 1위 카드
    chosen = (_closest_tier(state, cards, plan, budget, params)
              if month_end(budget, params) and params.month_end_closest else None)
    if chosen is None and params.hold_tiers:
        chosen = _hold_tier(state, cards, plan, budget, params)
    if chosen is None:
        chosen = STRATEGY_FUNCS[strategy_of(plan, params)](state, cards, plan, budget, params)
    return chosen if chosen is not None else _fallback(cards, plan, params)


def _promotion_value(promotions: list[Promotion], merchants: dict[int, float], card: UserCard,
                     amounts: tuple[int, ...], at: datetime) -> tuple[float, str | None]:
    """시나리오의 가맹점별 확률 × 그 가맹점에서 이 카드가 받는 프로모션 혜택. (합계, 가장 큰 프로모션 이름)"""
    total, best = 0.0, (0.0, None)
    for promotion in promotions:
        got = 0.0
        for merchant_id, share in merchants.items():
            got += share * sum(promotion.value(merchant_id, card.issuer, card.card_id, a, at) for a in amounts) / len(amounts)
        total += got
        if got > best[0]:
            best = (got, promotion.label())
    return total, best[1]


def promotion_value(promotions: list[Promotion], scenario, card: UserCard, catalog, at: datetime) -> tuple[float, str | None]:
    """설계서 v4.2 5단계의 프로모션 몫. 한 결제는 행사 하나만 받으므로 행사 중 가장 큰 금액을 센다.
    가게를 알면   Σ 가맹점 P(가맹점) × max 행사 금액(가맹점),
    가게를 모르면 Σ 브랜드 P(브랜드|업종) × max 행사 금액(그 업종·브랜드의 행사 가맹점).
    (기대 금액, 가장 크게 기여한 행사 이름)"""
    if not promotions:
        return 0.0, None
    amounts = scenario.amounts
    contrib: dict[str, float] = {}

    def best_at(merchant_of, weight: float) -> float:
        top, label = 0.0, None
        for promotion in promotions:
            merchant_id = merchant_of(promotion)
            if merchant_id is None:
                continue
            got = sum(promotion.value(merchant_id, card.issuer, card.card_id, a, at) for a in amounts) / len(amounts)
            if got > top:
                top, label = got, promotion.label()
        if label is not None:
            contrib[label] = contrib.get(label, 0.0) + weight * top
        return weight * top

    if scenario.merchants:
        total = sum(best_at(lambda p, m=m: m if m in p.merchant_ids else None, share)
                    for m, share in scenario.merchants.items())
    else:
        brands = scenario.promo_brands if scenario.promo_brands is not None else scenario.brands
        total = sum(best_at(lambda p, b=b: catalog.promo_merchants(p.merchant_ids).get((scenario.category, b)), share)
                    for b, share in brands.items())
    return total, (max(contrib, key=contrib.get) if contrib else None)


def score_cards(state: UserState, cards: list[UserCard], scenarios: ScenarioSet, at: datetime, plan: MonthPlan,
                budget: Budget, params: Params, promotions: list[Promotion],
                base: int | None = None) -> dict[int, CardScore]:
    """점수 = w1 × 즉시 혜택 + w2 × 실적 기여 가치 + w3 × 프로모션 가치.
    perf_budget_share 면 카드마다 실제로 들어올 남은 예산 몫으로, perf_net_value 면 구간 순가치로 실적 가치를 센다."""
    catalog = state.catalog
    scores = {}
    left = budget.total
    by_share = params.perf_budget_share and plan.switch_share is not None and base is not None
    best_rate = max((plan.rates or {}).values(), default=0.0)
    for card_row in cards:
        uc, card_id = card_row.user_card_id, card_row.card_id
        card, st = catalog.cards[card_id], state.ledger[uc]
        gains = plan.gains.get(uc, [])
        fixed_left = plan.daily_fixed.get(uc, 0.0) * budget.days
        card_left, card_sigma = card_budget(plan, budget, uc, base) if by_share else (left, budget.sigma)
        cost_rate = (max(best_rate - plan.rates.get(uc, 0.0), 0.0)
                     if params.perf_net_value and plan.rates else 0.0)
        immediate = performance = promotion = 0.0
        by_category, best_label = {}, (0.0, None)
        for s in scenarios.scenarios:
            value = sum(w * evaluate(card, s.category, a, st, at, brand, SOLPAY)[0]
                        for brand, w in s.brands.items() for a in s.amounts) / len(s.amounts)
            promo, label = (_promotion_value(promotions, s.merchants, card_row, s.amounts, at) if params.engine == "v3"
                            else promotion_value(promotions, s, card_row, catalog, at))
            by_category[s.category] = value + promo     # 근거 확률과 2장 판단은 받는 혜택 전체로 본다
            immediate += s.prob * value
            performance += s.prob * sum(perf_gain(a, card_left, card_sigma, gains, st.perf, fixed_left, cost_rate)
                                        for a in s.amounts) / len(s.amounts)
            promotion += s.prob * promo
            if s.prob * promo > best_label[0]:
                best_label = (s.prob * promo, label)
        scores[uc] = CardScore(uc, immediate, performance, promotion,
                               params.w1 * immediate + params.w2 * performance + params.w3 * promotion, by_category,
                               best_label[1])
        top = catalog.top_tier(card_id)
        if top is not None and not by_share:
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


def _expected_amount(scenarios: ScenarioSet) -> float:
    return sum(s.prob * sum(s.amounts) / len(s.amounts) for s in scenarios.scenarios if s.amounts)


def v4_swap(scores: dict[int, CardScore], scenarios: ScenarioSet, order: list[int], base: int, threshold: float,
            params: Params, repeat_applied: bool) -> tuple[int, bool, float, float]:
    """6단계 교체 판단 (v4). 이득 = 점수 1위 − 기본 카드, 교체 = 이득 > 교체 기준 이고
    (근거 확률 ≥ evidence_prob 또는 반복 구간). (1순위, 교체했는지, 이득, 근거 확률)"""
    top = order[0]
    gain = scores[top].total - scores[base].total
    evidence = sum(s.prob for s in scenarios.scenarios
                   if scores[top].by_category[s.category] > scores[base].by_category[s.category])
    swapped = top != base and gain > threshold and (evidence >= params.evidence_prob or repeat_applied)
    return (top if swapped else base), swapped, gain, evidence


def decide(state: UserState, cards: list[UserCard], scenarios: ScenarioSet, at: datetime, params: Params,
           promotions: list[Promotion], schedules=(), no_fill: set[int] | frozenset = frozenset()) -> Decision:
    """no_fill: 실적을 채우지 않을 카드 (사용자 규칙). 기본 카드 후보에서만 빼고, 점수(즉시 혜택 + 프로모션)로는 그대로 경쟁한다.
    모든 카드가 빠지면 실적을 채우지 않는 것과 같으므로 혜택률 1위 카드가 기본 카드다."""
    if params.engine == "v3":
        return _decide_v3(state, cards, scenarios, at, params, promotions, schedules)
    plan = month_plan(state)
    budget = schedule_adjusted_budget(plan, at, state, schedules)
    fill_cards = [c for c in cards if c.user_card_id not in no_fill]
    if fill_cards:
        base = choose_base_card(state, fill_cards, plan, budget, params)
    else:
        base = _fallback(cards, plan, params)
    hold = (params.hold_tiers and not getattr(state, "loss_guard", False) and bool(fill_cards)
            and base == _hold_tier(state, fill_cards, plan, budget, params))
    # 점수 = 즉시 혜택 + 프로모션 (설계서 v4.2). 실적 가치는 점수에서 빼고 교체 기준으로 쓴다.
    # promo_in_score=False 면 v4.1 처럼 프로모션도 뺀다 (일정 팝업으로만 안내)
    if params.promo_in_score:
        scores = score_cards(state, cards, scenarios, at, plan, budget, params.with_(w2=0.0), promotions, base)
    else:
        scores = score_cards(state, cards, scenarios, at, plan, budget, params.with_(w2=0.0, w3=0.0), [], base)
    positions = {c.user_card_id: i for i, c in enumerate(cards)}
    order = sorted(positions, key=lambda uc: (-scores[uc].total, positions[uc]))
    repeat_applied = scenarios.repeat_category is not None
    threshold = params.w2 * switch_threshold(state, plan, budget, base, _expected_amount(scenarios))
    first, swapped, gain, evidence = v4_swap(scores, scenarios, order, base, threshold, params, repeat_applied)
    second = (None if repeat_applied or params.max_display < 2
              else _second_card(scores, scenarios, order, first, params))
    rest = [uc for uc in order if uc not in (first, second)]
    final_order = [first] + ([second] if second is not None else []) + rest
    return Decision(base, first, second, final_order, scores, swapped, REASON_BENEFIT if swapped else None,
                    repeat_applied, gain, evidence, threshold, hold)


def _decide_v3(state: UserState, cards: list[UserCard], scenarios: ScenarioSet, at: datetime, params: Params,
               promotions: list[Promotion], schedules=()) -> Decision:
    plan = month_plan(state)
    budget = schedule_adjusted_budget(plan, at, state, schedules)
    if getattr(state, "loss_guard", False):
        params = params.with_(w2=params.w2 * params.loss_guard_w2)
    base = choose_base_card(state, cards, plan, budget, params)
    scores = score_cards(state, cards, scenarios, at, plan, budget, params, promotions, base)
    positions = {c.user_card_id: i for i, c in enumerate(cards)}
    order = sorted(positions, key=lambda uc: (-scores[uc].total, positions[uc]))
    top = order[0]
    gain = scores[top].total - scores[base].total
    evidence = sum(s.prob for s in scenarios.scenarios
                   if scores[top].by_category[s.category] > scores[base].by_category[s.category])
    perf_part = scores[top].performance - scores[base].performance
    repeat_applied = scenarios.repeat_category is not None
    expected_amount = sum(s.prob * sum(s.amounts) / len(s.amounts) for s in scenarios.scenarios if s.amounts)
    swapped = gain >= params.switch_for(expected_amount) and (
        evidence >= params.evidence_prob or perf_part >= gain / 2 or repeat_applied)
    first = top if swapped else base
    second = None if repeat_applied else _second_card(scores, scenarios, order, first, params)
    reason = None
    if swapped:
        reason = REASON_PERFORMANCE if perf_part >= gain / 2 else REASON_BENEFIT
    rest = [uc for uc in order if uc not in (first, second)]
    final_order = [first] + ([second] if second is not None else []) + rest
    return Decision(base, first, second, final_order, scores, swapped, reason, repeat_applied, gain, evidence)
