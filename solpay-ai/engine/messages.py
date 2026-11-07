"""6단계: 안내 문구. 금액은 엔진 계산값만 넣고, LLM 이 숫자를 만들지 않는다.

문구는 이미 쓰기로 한 결제의 카드 선택만 돕는다. 소비를 늘리라는 표현은 쓰지 않는다.
"""

from dataclasses import dataclass

from engine.benefit_calc import Benefit, evaluate, rate_of
from engine.catalog import Catalog
from engine.ranker import CardScore, Decision
from engine.scenarios import Scenario, ScenarioSet
from engine.slots import slot_label
from engine.state import UserState

RULE = "RULE"
AMOUNT_BENEFIT = "AMOUNT_BENEFIT"
TIME_BENEFIT = "TIME_BENEFIT"
GENERAL_BENEFIT = "GENERAL_BENEFIT"
PERFORMANCE = "PERFORMANCE"
PROMOTION = "PROMOTION"
BASE_CHANGED = "BASE_CHANGED"
REPEAT = "REPEAT"
HABIT = "HABIT"

KIND = {"discount": "할인", "cashback": "캐시백", "point": "적립"}
HOME_ISSUER = "SHINHAN"


@dataclass
class Message:
    code: str
    text: str


def with_object_particle(word: str) -> str:
    """받침이 있으면 '을', 없으면 '를'을 붙인다."""
    last = word[-1] if word else ""
    has_final = "가" <= last <= "힣" and (ord(last) - ord("가")) % 28 > 0
    return f"{word}{'을' if has_final else '를'}"


def benefit_text(b: Benefit, prev_perf: int) -> str:
    kind = KIND.get(b.type, "혜택")
    if b.amount is not None:
        return f"{b.amount:,}원 {kind}"
    return f"{rate_of(b, prev_perf) * 100:g}% {kind}"


def when_text(b: Benefit) -> str:
    parts = []
    if b.days is not None:
        if b.days == (0, 1, 2, 3, 4):
            parts.append("평일")
        elif b.days == (5, 6):
            parts.append("주말")
        else:
            parts.append("·".join("월화수목금토일"[d] for d in b.days) + "요일")
    if b.hours is not None:
        parts.append(f"{b.hours[0]}~{b.hours[1]}시")
    return " ".join(parts)


def _best_benefit(state: UserState, user_card_id: int, card_id: int, scenarios: list[Scenario], at):
    """이 카드에서 기대 금액이 가장 큰 시나리오의 혜택을 고른다."""
    card, st = state.catalog.cards[card_id], state.ledger[user_card_id]
    best = (0.0, None, None)
    for s in scenarios:
        for amount in s.amounts:
            got, benefit = evaluate(card, s.category, amount, st, at)
            if got * s.prob > best[0]:
                best = (got * s.prob, benefit, s)
    return best[1], best[2]


def _benefit_message(state: UserState, catalog: Catalog, user_card_id: int, card_id: int, scenarios, at) -> Message | None:
    benefit, scenario = _best_benefit(state, user_card_id, card_id, scenarios, at)
    if benefit is None:
        return None
    name = catalog.category_name(scenario.category)
    what = benefit_text(benefit, state.ledger[user_card_id].prev_perf)
    if benefit.days is not None or benefit.hours is not None:
        minimum = f" {benefit.min_amount:,}원 이상" if benefit.min_amount else ""
        return Message(TIME_BENEFIT, f"{when_text(benefit)}에 {name}에서{minimum} 결제하면 {what}을 받을 수 있어요!")
    if benefit.min_amount:
        return Message(AMOUNT_BENEFIT, f"{name}에서 {benefit.min_amount:,}원 이상 결제하면 {what}을 받을 수 있어요!")
    return Message(GENERAL_BENEFIT, f"{name}에서 결제하면 {what}을 받을 수 있어요!")


def _performance_message(state: UserState, catalog: Catalog, user_card_id: int, card_id: int, issuer: str) -> Message:
    perf = state.perf(user_card_id)
    target = next((low for low in catalog.tiers[card_id] if low > perf), None)
    note = "" if issuer == HOME_ISSUER else " (어제까지 기준)"
    name = catalog.card_label(card_id)
    if target is None:
        return Message(PERFORMANCE, f"{name} 실적을 이미 채웠어요!{note}")
    return Message(PERFORMANCE, f"{name} 실적 달성까지 {target - perf:,}원 남았어요!{note}")


def _dominant(score: CardScore, base: CardScore, params) -> str:
    deltas = {
        "immediate": params.w1 * (score.immediate - base.immediate),
        "performance": params.w2 * (score.performance - base.performance),
        "promotion": params.w3 * (score.promotion - base.promotion),
    }
    return max(deltas, key=deltas.get)


def _promotion_message(score: CardScore) -> Message:
    return Message(PROMOTION, f"이 매장 이벤트로 약 {int(score.promotion):,}원 혜택을 받을 수 있어요!")


def card_message(state: UserState, catalog: Catalog, decision: Decision, scenarios: ScenarioSet, user_card_id: int,
                 at, params, base_changed: bool) -> Message:
    card_row = next(c for c in state.cards if c.user_card_id == user_card_id)
    score = decision.scores[user_card_id]
    if user_card_id == decision.first and not decision.swapped:
        if base_changed:
            return Message(BASE_CHANGED, f"앞 카드 실적을 채워 오늘부터 {with_object_particle(catalog.card_label(card_row.card_id))} 먼저 보여 드려요")
        if score.performance > score.immediate:      # 실적을 채우려고 기본 카드가 된 경우
            return _performance_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
        message = _benefit_message(state, catalog, user_card_id, card_row.card_id, scenarios.scenarios, at)
        return message or Message(HABIT, "보통 지금 시간대에 이 카드로 계산하셨어요!")
    if user_card_id == decision.first and decision.repeat_applied and decision.swap_reason != "performance":
        name = catalog.category_name(decision_category(scenarios))
        return Message(REPEAT, f"{slot_label(scenarios.slot)}에는 보통 {name}에서 결제하셔서 이 카드를 먼저 보여 드려요")
    dominant = _dominant(score, decision.scores[decision.base], params)
    if dominant == "performance" and score.performance > 0:
        return _performance_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
    if dominant == "promotion" and score.promotion > 0:
        return _promotion_message(score)
    message = _benefit_message(state, catalog, user_card_id, card_row.card_id, scenarios.scenarios, at)
    return message or Message(HABIT, "보통 지금 시간대에 이 카드로 계산하셨어요!")


def decision_category(scenarios: ScenarioSet) -> str:
    return scenarios.repeat_category or scenarios.top_category or ""

