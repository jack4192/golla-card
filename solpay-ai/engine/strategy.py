"""사용자 맞춤 실적 채우기 전략.

매월 초 세 전략(A 모든 첫 구간 먼저 / B 주력 카드 높은 구간 먼저 / C 예산 배분) 중 하나를 고른다.
1) 본인 시뮬레이션: 지난달 실제 결제를 전략마다 다시 골라 본다. 현장 결제는 그 전략의 기본 카드로 내되
   그 결제에서 전환 기준 이상 더 주는 카드가 있으면 그 카드로, 온라인·자동이체·대표 교통카드 결제는 실제 카드 그대로.
   점수 = 그 달 받은 혜택 + 같은 배분을 다음 달에 반복할 때 받는 혜택(그 달에 넘은 구간 기준).
2) 전략 선택 모델(LightGBM): 소비 습관·카드 구간 혜택 특징 + 1)의 점수로 이번 달 가장 나은 전략을 예측한다.
   모델이 없으면 1)의 1위 전략을 쓴다.
"""

import calendar
import json
import math
from pathlib import Path

import numpy as np

from engine.benefit_calc import CardMonth, apply as apply_benefit, evaluate
from engine.domain import Payment
from engine.params import STRATEGIES, Params
from engine.perf_value import MonthPlan, budget_at, month_benefit


# 점수가 같으면 이 순서로 고른다. 고정 전략 중 B(주력 카드 높은 구간 먼저)가 전체 1위라 B 를 먼저 둔다.
TIE_ORDER = (STRATEGIES[1], STRATEGIES[2], STRATEGIES[0])


class _SimState:
    """choose_base_card 가 읽는 값만 가진 가벼운 상태."""

    def __init__(self, catalog, cards, ledger):
        self.catalog, self.cards, self.ledger = catalog, cards, ledger

    def perf(self, user_card_id: int) -> int:
        return self.ledger[user_card_id].perf


def simulate(state, strategy: str, rows: list[Payment], start_prev: dict[int, int], plan: MonthPlan,
             params: Params) -> float:
    """한 달 결제(rows)를 이 전략으로 다시 골랐을 때의 점수(원)."""
    from engine.ranker import choose_base_card     # 순환 import 방지

    catalog, cards = state.catalog, state.cards
    if not rows:
        return 0.0
    params = params.with_(base_order=strategy)
    ledger = {c.user_card_id: CardMonth(prev_perf=start_prev.get(c.user_card_id, 0)) for c in cards}
    first = rows[0].paid_at
    days = calendar.monthrange(first.year, first.month)[1]
    place = sum(p.amount for p in rows if p.is_placement)
    fixed: dict[int, float] = {}
    for p in rows:
        if not p.is_placement:
            fixed[p.user_card_id] = fixed.get(p.user_card_id, 0) + p.amount
    sim_plan = MonthPlan(place / days, {k: v / days for k, v in fixed.items()}, plan.gains, plan.rates)
    sim = _SimState(catalog, cards, ledger)
    card_of = {c.user_card_id: catalog.cards[c.card_id] for c in cards}
    assigned: dict[int, list[Payment]] = {c.user_card_id: [] for c in cards}
    total = 0
    for p in rows:
        brand = catalog.brand_of(p.merchant_id)
        uc = p.user_card_id if p.user_card_id in ledger else cards[0].user_card_id
        if p.is_placement:
            base = choose_base_card(sim, cards, sim_plan, budget_at(sim_plan, p.paid_at), params)
            values = {c: evaluate(card_of[c], p.category, p.amount, ledger[c], p.paid_at, brand, p.pay)[0] for c in ledger}
            best = max(values, key=values.get)
            uc = best if values[best] - values[base] >= params.switch_for(p.amount) else base
        got, benefit = evaluate(card_of[uc], p.category, p.amount, ledger[uc], p.paid_at, brand, p.pay)
        apply_benefit(ledger[uc], p.amount, got, benefit, when=p.paid_at)
        assigned[uc].append(p)
        total += got
    following = sum(month_benefit(card_of[uc], assigned[uc], ledger[uc].perf, catalog) for uc in ledger)
    return float(total + following)


def self_scores(state, plan: MonthPlan) -> dict[str, float]:
    """본인 지난달 시뮬레이션 점수. 지난달 결제가 없으면 빈 dict."""
    if not state.prev_rows:
        return {}
    rows = sorted(state.prev_rows, key=lambda p: p.paid_at)
    return {s: simulate(state, s, rows, state.prev_month_start, plan, state.params) for s in STRATEGIES}


FEATURES = ("place_log", "fixed_log", "n_cards", "n_tier_cards", "best_rate", "rate_gap", "no_tier_rate",
            "main_gain", "main_gain_share", "main_top_ratio", "first_need_ratio", "concentration",
            "sim_A", "sim_B", "sim_C")


def features(state, plan: MonthPlan, scores: dict[str, float]) -> list[float]:
    """월초에 알 수 있는 값만 쓴다 (지난달 결제, 보유 카드의 구간 혜택, 본인 시뮬레이션 점수)."""
    rows = state.prev_rows
    place = sum(p.amount for p in rows if p.is_placement)
    fixed = sum(p.amount for p in rows if not p.is_placement)
    rates = sorted((plan.rates or {}).values(), reverse=True) + [0.0, 0.0]
    gains = {c.user_card_id: sum(g for _, g in plan.gains.get(c.user_card_id, [])) for c in state.cards}
    total_gain = sum(gains.values())
    main = max(state.cards, key=lambda c: gains[c.user_card_id])
    tiers = state.catalog.tiers
    no_tier = [plan.rates.get(c.user_card_id, 0.0) for c in state.cards if not tiers[c.card_id]] if plan.rates else []
    by_card: dict[int, int] = {}
    for p in rows:
        if p.is_placement:
            by_card[p.user_card_id] = by_card.get(p.user_card_id, 0) + p.amount
    top = scores and max(scores.values()) or 0.0
    scale = max(place, 1.0) / 100       # 지난달 현장 결제 대비 % 로
    return [
        math.log1p(place), math.log1p(fixed), len(state.cards), sum(bool(tiers[c.card_id]) for c in state.cards),
        rates[0] * 100, (rates[0] - rates[1]) * 100, max(no_tier, default=0.0) * 100,
        gains[main.user_card_id], gains[main.user_card_id] / total_gain if total_gain else 0.0,
        (tiers[main.card_id][-1] / place) if tiers[main.card_id] and place else 0.0,
        sum(tiers[c.card_id][0] for c in state.cards if tiers[c.card_id]) / place if place else 0.0,
        max(by_card.values(), default=0) / place if place else 0.0,
        *[((scores.get(s, top) - top) / scale) if scores else 0.0 for s in STRATEGIES],
    ]


class StrategyModel:
    """전략마다 회귀 모델 하나. (그 전략 점수 − 세 전략 평균) ÷ 지난달 현장 결제의 1% 를 예측한다."""

    def __init__(self, boosters: dict):
        self.boosters = boosters

    def predict(self, x: list[float]) -> dict[str, float]:
        row = np.array([x], dtype=np.float32)
        return {s: float(b.predict(row)[0]) for s, b in self.boosters.items()}

    @classmethod
    def load(cls, directory: Path, name: str = "full") -> "StrategyModel | None":
        paths = {s: directory / f"{name}_{s}.txt" for s in STRATEGIES}
        if not all(p.exists() for p in paths.values()):
            return None
        import lightgbm as lgb
        return cls({s: lgb.Booster(model_file=str(p)) for s, p in paths.items()})


def choose(state, plan: MonthPlan) -> tuple[str, dict[str, float]]:
    """이번 달 전략. 모델이 있으면 모델, 없으면 본인 시뮬레이션 1위, 지난달 결제가 없으면 B."""
    cache = state.strategy_cache
    key = (state.user.user_id, state.ym, len(state.prev_rows))
    if cache is not None and key in cache:
        return cache[key]
    picked = _choose(state, plan)
    if cache is not None:
        cache[key] = picked
    return picked


def _choose(state, plan: MonthPlan) -> tuple[str, dict[str, float]]:
    scores = self_scores(state, plan)
    model = getattr(state.models, "strategy", None) if state.models is not None else None
    if not scores:
        return TIE_ORDER[0], scores
    if model is not None:
        predicted = model.predict(features(state, plan, scores))
        return max(TIE_ORDER, key=lambda s: (predicted[s], -TIE_ORDER.index(s))), scores
    return max(TIE_ORDER, key=lambda s: (scores[s], -TIE_ORDER.index(s))), scores


def select_initial(user, cards, catalog, params, payments, at, promotions=()):
    """최근 6개월의 완료된 결제만 사용해 최초 방식을 추천한다.

    초기 실적은 관측된 이전 결제로 구성하며, 이후 월은 각 방식별 실적을 이월한다.
    마지막 달의 다음 달 혜택은 추정치이며 반환값은 저장 전 초안이다.
    """
    from engine.state import UserState
    from engine.perf_value import month_plan
    from engine.slots import ym_of
    from dataclasses import replace
    current = at.year * 12 + at.month - 1
    start = current - 6
    rows = sorted((p for p in payments if p.paid_at < at and p.visible_at <= at),
                  key=lambda p: (p.paid_at, p.payment_id))
    month_key = lambda p: p.paid_at.year * 12 + p.paid_at.month - 1
    target = [p for p in rows if start <= month_key(p) < current]
    eligible = sum(p.is_placement for p in target)
    months = sorted({month_key(p) for p in target})
    info = {'strategy': TIE_ORDER[0], 'status': 'insufficient_history', 'scores': {},
            'eligible_transactions': eligible, 'months': len(months), 'window_months': 6}
    if not months or eligible < 10:
        return info
    scores = {strategy: _replay_window(user, cards, catalog, params.with_(base_order=strategy), rows, target, promotions)
              for strategy in STRATEGIES}
    info.update(status='ready', scores=scores,
                strategy=max(TIE_ORDER, key=lambda s: (scores[s], -TIE_ORDER.index(s))))
    return info


def _window(payments, at, months: int):
    """(이전 결제 전체, 최근 months 달의 완료된 결제). at 시점에 보이는 결제만 쓴다."""
    current = at.year * 12 + at.month - 1
    rows = sorted((p for p in payments if p.paid_at < at and p.visible_at <= at),
                  key=lambda p: (p.paid_at, p.payment_id))
    month_key = lambda p: p.paid_at.year * 12 + p.paid_at.month - 1
    return rows, [p for p in rows if current - months <= month_key(p) < current]


def _replay_window(user, cards, catalog, params, rows, target, promotions=(), habit: bool = False) -> float:
    """target 기간의 결제를 다시 흘려 받은 혜택(+마지막 달 실적이 다음 달에 줄 혜택 추정)을 센다.
    habit=True 면 실제로 쓴 카드 그대로, 아니면 이 방식의 기본 카드(전환 기준 이상 더 주는 카드가 있으면 그 카드)."""
    from dataclasses import replace
    from engine.benefit_calc import month_reward
    from engine.perf_value import month_plan
    from engine.ranker import choose_base_card
    from engine.slots import ym_of
    from engine.state import UserState
    if not target:
        return 0.0
    state = UserState(user, cards, catalog, params)
    month_key = lambda p: p.paid_at.year * 12 + p.paid_at.month - 1
    earliest = month_key(target[0])
    for payment in rows:                       # 이전 결제로 실적만 데워 둔다
        if month_key(payment) >= earliest:
            break
        if payment.user_card_id in state.card_ids:
            state.apply(payment)
    score, last_assigned, last_month, plan = 0.0, {c.user_card_id: [] for c in cards}, None, None
    for payment in target:
        if payment.user_card_id not in state.card_ids:
            continue
        month = ym_of(payment.paid_at)
        if month != last_month:
            state.roll_to(month)
            plan = month_plan(state)
            for uc, ledger in state.ledger.items():
                score += month_reward(catalog.cards[state.card_ids[uc]], ledger.prev_perf)
            last_assigned = {c.user_card_id: [] for c in cards}
            last_month = month
        uc = payment.user_card_id
        eligible_cards = [c for c in cards if not c.excluded]
        if payment.is_placement and eligible_cards and not habit:
            base = choose_base_card(state, eligible_cards, plan, budget_at(plan, payment.paid_at), params)
            brand = catalog.brand_of(payment.merchant_id)
            values = {c.user_card_id: evaluate(catalog.cards[c.card_id], payment.category, payment.amount,
                       state.ledger[c.user_card_id], payment.paid_at, brand, payment.pay)[0] for c in eligible_cards}
            if payment.merchant_id is not None:
                for c in eligible_cards:
                    values[c.user_card_id] += max((x.value(payment.merchant_id, c.issuer, c.card_id, payment.amount,
                                                           payment.paid_at) for x in promotions), default=0)
            best = max(values, key=values.get)
            uc = best if values[best] - values[base] >= params.switch_for(payment.amount) else base
        assigned = replace(payment, user_card_id=uc)
        score += state.apply(assigned)
        if payment.is_placement and payment.merchant_id is not None:
            card = next(c for c in cards if c.user_card_id == uc)
            score += max((x.value(payment.merchant_id, card.issuer, card.card_id, payment.amount, payment.paid_at)
                          for x in promotions), default=0)
        last_assigned[uc].append(assigned)
    projected = sum(month_benefit(catalog.cards[c.card_id], last_assigned[c.user_card_id],
                                  state.ledger[c.user_card_id].perf, catalog) for c in cards) if last_month else 0
    return score + projected


def loss_guard(user, cards, catalog, params, payments, at, strategy: str, promotions=()) -> dict:
    """손해 방지 (2026-11-15): 최근 loss_guard_months 달을 이 사용자의 방식으로 다시 돌려 본 혜택이
    실제로 쓴 카드 그대로의 혜택보다 작으면 active. 완료된 달의 결제가 10건 미만이면 판단하지 않는다."""
    if params.loss_guard_months <= 0:
        return {"active": False, "status": "off"}
    rows, target = _window(payments, at, params.loss_guard_months)
    if sum(p.is_placement for p in target) < 10:
        return {"active": False, "status": "insufficient_history"}
    algo = _replay_window(user, cards, catalog, params.with_(base_order=strategy), rows, target, promotions)
    habit = _replay_window(user, cards, catalog, params, rows, target, promotions, habit=True)
    return {"active": algo < habit, "status": "ready", "algo": algo, "habit": habit}


def monthly_pick(user, cards, catalog, params, payments, at, fixed_strategy: str | None, promotions=()) -> dict:
    """월간 맞춤 방식 (2026-11-15). at 이 속한 달의 첫날 기준으로, 직전 adaptive_months 달의 완료된 결제
    (그 시점에 보이는 것만)를 후보 방식마다 다시 돌려 받은 혜택(+마지막 달 실적이 다음 달에 줄 혜택 추정)이 가장 큰 방식.
    후보 = 최초 선택 방식 + adaptive_orders. 동점이거나 adaptive_margin 원 이상 낫지 않으면 최초 선택 방식.
    습관대로 냈을 때의 혜택은 후보마다 같으므로 쓰지 않는다. 반환: {strategy, status, scores, months}."""
    base = fixed_strategy or TIE_ORDER[0]
    info = {"strategy": base, "status": "off", "scores": {}, "months": params.adaptive_months}
    if params.adaptive_months <= 0:
        return info
    month_start = at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows, target = _window(payments, month_start, params.adaptive_months)
    if sum(p.is_placement for p in target) < params.adaptive_min_payments:
        return {**info, "status": "insufficient_history"}
    candidates = [base] + [s for s in params.adaptive_orders if s != base]
    scores = {s: _replay_window(user, cards, catalog, params.with_(base_order=s), rows, target, promotions)
              for s in candidates}
    best = max(candidates, key=lambda s: scores[s])           # 동점이면 앞(최초 선택 방식)
    picked = best if scores[best] - scores[base] >= params.adaptive_margin else base
    return {**info, "strategy": picked, "status": "ready", "scores": scores}
