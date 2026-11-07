"""실적 기여 가치: 이번 결제가 다음 달 혜택 구간 달성 가능성을 얼마나 바꾸는지를 원화로 계산한다."""

import calendar
import math
from dataclasses import dataclass
from datetime import datetime

from engine.benefit_calc import Card, CardMonth, apply as apply_benefit, evaluate
from engine.domain import Payment
from engine.state import UserState


def normal_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def month_benefit(card: Card, rows: list[Payment], prev_perf: int) -> int:
    """지난달 소비를 이 카드 한 장에 썼다고 할 때 받는 월 혜택."""
    st, total = CardMonth(prev_perf=prev_perf), 0
    for p in rows:
        got, benefit = evaluate(card, p.category, p.amount, st, p.paid_at)
        apply_benefit(st, p.amount, got, benefit)
        total += got
    return total


def tier_gains(card: Card, tiers: tuple[int, ...], rows: list[Payment]) -> list[tuple[int, int]]:
    """구간별 증분 혜택: (구간 하한, 그 구간 월 혜택 − 바로 아래 구간 월 혜택)."""
    gains, below = [], month_benefit(card, rows, 0)
    for low in tiers:
        value = month_benefit(card, rows, low)
        gains.append((low, max(value - below, 0)))
        below = max(value, below)
    return gains


@dataclass
class MonthPlan:
    daily_place: float                  # 지난달 일평균 현장 결제액
    daily_fixed: dict[int, float]       # 카드별 지난달 일평균 교통·자동이체·온라인 결제액
    gains: dict[int, list[tuple[int, int]]]


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
    gains = {}
    for uc in state.cards:
        tiers = state.catalog.tiers[uc.card_id]
        if tiers and rows:
            gains[uc.user_card_id] = tier_gains(state.catalog.cards[uc.card_id], tiers, rows)
    state.plan = MonthPlan(place / days, {k: v / days for k, v in fixed.items()}, gains)
    return state.plan


def budget_at(plan: MonthPlan, at: datetime) -> Budget:
    last_day = calendar.monthrange(at.year, at.month)[1]
    days = max(last_day - at.day, 0) + 0.5
    return Budget(days, plan.daily_place * days, max(plan.daily_place * math.sqrt(days), 1.0))


def remaining_need(state: UserState, plan: MonthPlan, user_card_id: int, target: int, days: float) -> float:
    """구간 하한 − 당월 실적 − 남은 기간의 교통·자동이체·온라인 예상액."""
    return target - state.perf(user_card_id) - plan.daily_fixed.get(user_card_id, 0.0) * days


def perf_gain(amount: float, budget_left: float, sigma: float,
              tiers: list[tuple[int, int]], perf: int, fixed_left: float) -> float:
    """Σ 구간 [P(달성 | 이 결제 포함) − P(달성 | 이 결제 제외)] × 구간 증분 혜택."""
    total = 0.0
    for low, gain in tiers:
        need = low - perf - fixed_left
        if need <= 0 or gain <= 0:
            continue
        total += (normal_cdf((budget_left + amount - need) / sigma)
                  - normal_cdf((budget_left - need) / sigma)) * gain
    return total
