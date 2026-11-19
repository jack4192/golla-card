"""실적 기여 가치: 이번 결제가 다음 달 혜택 구간 달성 가능성을 얼마나 바꾸는지를 원화로 계산한다."""

import calendar
import math
from dataclasses import dataclass
from datetime import datetime

from engine.benefit_calc import Card, CardMonth, apply as apply_benefit, evaluate, month_reward
from engine.catalog import Catalog
from engine.params import BASE_ORDER_AUTO
from engine.domain import Payment
from engine.state import UserState


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def month_benefit(card: Card, rows: list[Payment], prev_perf: int, catalog: Catalog | None = None) -> int:
    """지난달 소비를 이 카드 한 장에 썼다고 할 때 받는 월 혜택 (전월 실적만 보는 월 리워드 포함)."""
    st, total = CardMonth(prev_perf=prev_perf), month_reward(card, prev_perf)
    for p in rows:
        brand = catalog.brand_of(p.merchant_id) if catalog is not None else None
        got, benefit = evaluate(card, p.category, p.amount, st, p.paid_at, brand, p.pay)
        apply_benefit(st, p.amount, got, benefit, when=p.paid_at)
        total += got
    return total


def tier_gains(card: Card, tiers: tuple[int, ...], rows: list[Payment],
               catalog: Catalog | None = None) -> list[tuple[int, int]]:
    """구간별 증분 혜택: (구간 하한, 그 구간 월 혜택 − 바로 아래 구간 월 혜택)."""
    gains, below = [], month_benefit(card, rows, 0, catalog)
    for low in tiers:
        value = month_benefit(card, rows, low, catalog)
        gains.append((low, max(value - below, 0)))
        below = max(value, below)
    return gains


def best_card_value(state: UserState, rows: list[Payment], prev: dict[int, int]) -> int:
    """지난달 결제를, 현장 결제는 결제마다 가장 많이 주는 카드로 냈을 때의 월 혜택 (나머지는 실제 카드)."""
    catalog = state.catalog
    cards = {c.user_card_id: catalog.cards[c.card_id] for c in state.cards}
    ledgers = {uc: CardMonth(prev_perf=prev.get(uc, 0)) for uc in cards}
    total = sum(month_reward(cards[uc], prev.get(uc, 0)) for uc in cards)
    for p in sorted(rows, key=lambda r: r.paid_at):
        brand = catalog.brand_of(p.merchant_id)
        uc = p.user_card_id if p.user_card_id in cards else next(iter(cards))
        if p.is_placement:
            uc = max(cards, key=lambda c: (evaluate(cards[c], p.category, p.amount, ledgers[c], p.paid_at, brand, p.pay)[0],
                                            c == p.user_card_id))
        got, benefit = evaluate(cards[uc], p.category, p.amount, ledgers[uc], p.paid_at, brand, p.pay)
        apply_benefit(ledgers[uc], p.amount, got, benefit, when=p.paid_at)
        total += got
    return total


def marginal_tier_gains(state: UserState, rows: list[Payment]) -> dict[int, list[tuple[int, int]]]:
    """구간별 증분 혜택(결제마다 최선 카드 기준): 이 카드만 그 구간에 올렸을 때 지난달 혜택이 얼마나 늘었을지.
    다른 카드로도 받을 수 있던 혜택은 빼고 센다."""
    prev = {uc: st.prev_perf for uc, st in state.ledger.items()}
    out = {}
    for c in state.cards:
        tiers = state.catalog.tiers[c.card_id]
        if not tiers:
            continue
        below = best_card_value(state, rows, {**prev, c.user_card_id: 0})
        gains = []
        for low in tiers:
            value = best_card_value(state, rows, {**prev, c.user_card_id: low})
            gains.append((low, max(value - below, 0)))
            below = max(value, below)
        out[c.user_card_id] = gains
    return out


@dataclass
class MonthPlan:
    daily_place: float                  # 지난달 일평균 현장 결제액
    daily_fixed: dict[int, float]       # 카드별 지난달 일평균 교통·자동이체·온라인 결제액
    gains: dict[int, list[tuple[int, int]]]
    rates: dict[int, float] = None      # 카드별: 지난달 현장 결제를 이 카드로 냈다면 받는 혜택률 (지금 전월 실적 기준)
    strategy: str | None = None         # 이번 달 맞춤 실적 채우기 전략 (base_order=auto 일 때)
    strategy_scores: dict[str, float] = None   # 본인 지난달 시뮬레이션 점수 (전략 → 원)
    switch_share: dict[int, float] = None      # 카드별: 지난달 현장 결제 중 다른 모든 카드보다 전환 기준 이상 더 줘서
                                               # 기본 카드와 관계없이 그 카드로 갔을 금액 비중 (perf_budget_share)


@dataclass(frozen=True)
class Budget:
    days: float                         # 남은 일수
    total: float                        # 남은 기간 현장 결제 예상액
    sigma: float


def month_plan(state: UserState) -> MonthPlan:
    if state.plan is not None:
        return state.plan
    rows = state.prev_rows
    place, fixed = 0, {}
    for p in rows:
        if p.is_placement:
            place += p.amount
        else:
            fixed[p.user_card_id] = fixed.get(p.user_card_id, 0) + p.amount
    days = calendar.monthrange(int(state.prev_ym[:4]), int(state.prev_ym[5:7]))[1] if state.prev_ym else 30
    gains, rates = {}, {}
    place_rows = [p for p in rows if p.is_placement]
    marginal = marginal_tier_gains(state, rows) if rows and state.params.tier_gain_mode == "marginal" else None
    for uc in state.cards:
        card = state.catalog.cards[uc.card_id]
        tiers = state.catalog.tiers[uc.card_id]
        if tiers and rows:
            gains[uc.user_card_id] = (marginal.get(uc.user_card_id, []) if marginal is not None
                                      else tier_gains(card, tiers, rows, state.catalog))
        if place:
            prev = state.ledger[uc.user_card_id].prev_perf if uc.user_card_id in state.ledger else 0
            got = month_benefit(card, place_rows, prev, state.catalog) - month_reward(card, prev)
            rates[uc.user_card_id] = got / place
    state.plan = MonthPlan(place / days, {k: v / days for k, v in fixed.items()}, gains, rates)
    if state.params.perf_budget_share and place:
        state.plan.switch_share = switch_shares(state, place_rows, place)
    if state.params.base_order == BASE_ORDER_AUTO:
        state.plan.strategy = state.month_strategy or state.fixed_strategy or "main_top"
        state.plan.strategy_scores = {}
    return state.plan


def switch_shares(state: UserState, place_rows: list[Payment], place: float) -> dict[int, float]:
    """지난달 현장 결제를 다시 흘려, 한 카드가 다른 모든 카드보다 전환 기준 이상 더 주는 결제의 금액 비중.
    이 금액은 어느 카드가 기본 카드든 그 카드로 간다고 본다. 한도는 결제마다 가장 많이 주는 카드에서 깎는다."""
    catalog, threshold = state.catalog, state.params.switch_threshold
    cards = {c.user_card_id: catalog.cards[c.card_id] for c in state.cards}
    if len(cards) < 2:
        return {uc: 0.0 for uc in cards}
    ledgers = {uc: CardMonth(prev_perf=state.ledger[uc].prev_perf if uc in state.ledger else 0) for uc in cards}
    shares = {uc: 0.0 for uc in cards}
    for p in sorted(place_rows, key=lambda r: r.paid_at):
        brand = catalog.brand_of(p.merchant_id)
        results = {uc: evaluate(cards[uc], p.category, p.amount, ledgers[uc], p.paid_at, brand, p.pay) for uc in cards}
        ranked = sorted(results, key=lambda uc: -results[uc][0])
        best, second = ranked[0], ranked[1]
        if results[best][0] - results[second][0] >= threshold:
            shares[best] += p.amount
        apply_benefit(ledgers[best], p.amount, results[best][0], results[best][1], when=p.paid_at)
    return {uc: v / place for uc, v in shares.items()}


def card_budget(plan: MonthPlan, budget: Budget, user_card_id: int, base: int) -> tuple[float, float]:
    """이 카드로 들어올 남은 현장 결제 예상액과 표준편차. 기본 카드 = 1 − 다른 카드 몫, 그 밖 = 자기 몫.
    결제가 무작위로 나뉜다고 보고 표준편차는 √몫 으로 줄인다."""
    shares = plan.switch_share or {}
    if user_card_id == base:
        share = max(1.0 - sum(v for uc, v in shares.items() if uc != base), 0.0)
    else:
        share = shares.get(user_card_id, 0.0)
    return budget.total * share, max(budget.sigma * math.sqrt(share), 1.0)


def budget_at(plan: MonthPlan, at: datetime, state: UserState | None = None) -> Budget:
    """남은 기간 현장 결제 예상액과 불확실성. 남은 소비 예측 모델이 있으면 모델(16·50·84% 분위수),
    없으면 지난달 일평균 × 남은 일수."""
    last_day = calendar.monthrange(at.year, at.month)[1]
    days = max(last_day - at.day, 0) + 0.5
    model = getattr(state.models, "spend", None) if state is not None and state.models is not None else None
    if model is not None and state.prev_rows:
        low, mid, high = model.predict(state, at)
        return Budget(days, mid, max((high - low) / 2, 1.0))
    return Budget(days, plan.daily_place * days, max(plan.daily_place * math.sqrt(days), 1.0))


def schedule_adjusted_budget(plan: MonthPlan, at: datetime, state: UserState, schedules=()) -> Budget:
    """Replace today's baseline estimate with later planned spending (not the current payment).

    An unassigned schedule is part of the shared future budget, not an amount
    independently credited to every card. Amount and attendance remain estimates.
    """
    from engine.scenarios import active_schedule
    baseline = budget_at(plan, at, state)
    current_ids = {item.item_id for item in active_schedule(state, at, schedules, state.params)}
    later = [item for item in schedules if item.user_id == state.user.user_id
             and item.start.date() == at.date() and item.start > at
             and item.item_id not in current_ids and item.amount > 0]
    if not later:
        return baseline
    today_baseline = min(baseline.total, max(plan.daily_place * 0.5, 0.0))
    return Budget(baseline.days, max(baseline.total - today_baseline, 0.0)
                  + sum(item.amount for item in later), baseline.sigma)

def remaining_need(state: UserState, plan: MonthPlan, user_card_id: int, target: int, days: float) -> float:
    """구간 하한 − 당월 실적 − 남은 기간의 교통·자동이체·온라인 예상액."""
    return target - state.perf(user_card_id) - plan.daily_fixed.get(user_card_id, 0.0) * days


def switch_threshold(state: UserState, plan: MonthPlan, budget: Budget, user_card_id: int, amount: float) -> float:
    """v4 교체 기준: 이 결제를 기본 카드로 냈을 때 다음 구간에 가까워지는 값(원).
    min(결제 예상액, N) × G × p ÷ N. N = 다음 구간까지 남은 필요액, G = 다음 구간의 구간 가치,
    p = Φ((남은 예상 현장 결제 − N) / σ). 다음 구간이 없거나 N ≤ 0 이거나 G ≤ 0 이면 0원."""
    perf = state.perf(user_card_id)
    nxt = next(((low, gain) for low, gain in plan.gains.get(user_card_id, []) if low > perf), None)
    if nxt is None:
        return 0.0
    low, gain = nxt
    need = remaining_need(state, plan, user_card_id, low, budget.days)
    if need <= 0 or gain <= 0:
        return 0.0
    p = normal_cdf((budget.total - need) / max(budget.sigma, 1.0))
    return min(amount, need) * gain * p / need


def perf_gain(amount: float, budget_left: float, sigma: float,
              tiers: list[tuple[int, int]], perf: int, fixed_left: float, cost_rate: float = 0.0) -> float:
    """Σ 구간 [P(달성 | 이 결제 포함) − P(달성 | 이 결제 제외)] × 구간 가치.
    cost_rate > 0 이면 구간 가치를 순가치로 센다: 구간 증분 혜택 − (이 구간 필요액 − 아래 구간 필요액) × cost_rate.
    cost_rate 는 혜택률 1위 카드와 이 카드의 혜택률 차이 (이 카드로 채우느라 포기하는 혜택의 비율).
    이번 실적부터 그 구간까지의 누적 순가치가 0 이하이면 그 구간은 채울 가치가 없다고 보고 뺀다 (4단계와 같은 기준)."""
    total, below, cumulative = 0.0, 0.0, 0.0
    for low, gain in tiers:
        need = low - perf - fixed_left
        if need <= 0:
            continue
        value = gain - (need - below) * cost_rate
        cumulative += gain
        below = need
        if value <= 0 or cumulative - need * cost_rate < 0:
            continue
        total += (normal_cdf((budget_left + amount - need) / sigma)
                  - normal_cdf((budget_left - need) / sigma)) * value
    return total
