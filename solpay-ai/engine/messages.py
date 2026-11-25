"""6단계: 안내 문구. 금액은 엔진 계산값만 넣고, LLM 이 숫자를 만들지 않는다.

문구는 이미 쓰기로 한 결제의 카드 선택만 돕는다. 소비를 늘리라는 표현은 쓰지 않는다.
"""

from collections import Counter
from dataclasses import dataclass

from engine.benefit_calc import SOLPAY, Benefit, evaluate
from engine.catalog import Catalog
from engine.ranker import CardScore, Decision
from engine.scenarios import Scenario, ScenarioSet
from engine.slots import slot_label, slot_of
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
NEUTRAL = "NEUTRAL"                 # 혜택으로 말할 것이 없고 습관 문구도 사실이 아닐 때
NO_CARD = "NO_CARD"                 # 등록한 카드가 없어 보여 줄 카드가 없을 때 (cards=[], 문구 없음)
HOLD = "HOLD"                       # v4 구간 지키기로 기본 카드가 된 경우
PROMOTION_CARD = "PROMOTION_CARD"   # 일정 팝업에서 추천한 프로모션의 신한카드

KIND = {"discount": "할인", "cashback": "캐시백", "point": "적립"}
HOME_ISSUER = "SHINHAN"
HABIT_MIN = 3                       # 이 시간대에 이 카드로 이만큼은 결제했어야 '보통 이 카드로'라고 말한다


@dataclass
class Message:
    code: str
    text: str


def with_object_particle(word: str) -> str:
    """받침이 있으면 '을', 없으면 '를'을 붙인다."""
    last = word[-1] if word else ""
    has_final = "가" <= last <= "힣" and (ord(last) - ord("가")) % 28 > 0
    return f"{word}{'을' if has_final else '를'}"


def with_direction_particle(word: str) -> str:
    """받침이 있으면 '으로', 받침이 없거나 ㄹ 받침이면 '로'를 붙인다 ('500원으로', '25%로')."""
    last = word[-1] if word else ""
    final = (ord(last) - ord("가")) % 28 if "가" <= last <= "힣" else 0
    return f"{word}{'로' if final in (0, 8) else '으로'}"


def benefit_text(b: Benefit, prev_perf: int) -> str:
    kind = KIND.get(b.type, "혜택")
    if b.per_liter is not None:
        return f"ℓ당 {b.per_liter:,}원 {kind}"
    if b.amount is not None:
        return f"{b.amount:,}원 {kind}"
    text = f"{(b.rate or 0) * 100:g}% {kind}"
    return f"{text}(최대 {b.max_per_tx:,}원)" if b.max_per_tx is not None else text


def when_text(b: Benefit) -> str:
    parts = []
    if b.month_days is not None:
        parts.append("매월 " + "·".join(f"{d}일" for d in b.month_days))
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
    """이 카드에서 기대 금액이 가장 큰 시나리오의 혜택을 고른다. (혜택, 시나리오, 브랜드 코드, 금액)
    브랜드·금액은 결제 화면 예시 거래(engine.example)가 문구와 같은 거래를 보이려고 쓴다."""
    card, st = state.catalog.cards[card_id], state.ledger[user_card_id]
    best = (0.0, None, None, None, None)
    for s in scenarios:
        for brand, weight in s.brands.items():
            for amount in s.amounts:
                got, benefit = evaluate(card, s.category, amount, st, at, brand, SOLPAY)
                if got * s.prob * weight > best[0]:
                    best = (got * s.prob * weight, benefit, s, brand, amount)
    return best[1], best[2], best[3], best[4]


def _benefit_message(state: UserState, catalog: Catalog, user_card_id: int, card_id: int, scenarios, at) -> Message | None:
    benefit, scenario, _, _ = _best_benefit(state, user_card_id, card_id, scenarios, at)
    if benefit is None:
        return None
    name = catalog.category_name(scenario.category)
    what = benefit_text(benefit, state.ledger[user_card_id].prev_perf)
    if benefit.days is not None or benefit.hours is not None or benefit.month_days is not None:
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


def _hold_message(state: UserState, catalog: Catalog, user_card_id: int, card_id: int, issuer: str) -> Message:
    """지난달 받던 구간을 이번 달에 지키려고 기본 카드가 된 경우."""
    held = max((t for t in catalog.tiers[card_id] if t <= state.ledger[user_card_id].prev_perf), default=0)
    left = max(held - state.perf(user_card_id), 0)
    note = "" if issuer == HOME_ISSUER else " (어제까지 기준)"
    return Message(HOLD, f"{catalog.card_label(card_id)} {held // 10_000}만 원 구간까지 {left:,}원 남았어요. "
                         f"채우면 다음 달에도 지금 혜택을 받아요{note}")


def _dominant(score: CardScore, base: CardScore, params) -> str:
    deltas = {
        "immediate": params.w1 * (score.immediate - base.immediate),
        "performance": params.w2 * (score.performance - base.performance),
        "promotion": params.w3 * (score.promotion - base.promotion),
    }
    if params.engine != "v3":           # v4 점수에는 실적 가치가 없다 (교체 기준으로만 쓴다)
        del deltas["performance"]
    return max(deltas, key=deltas.get)


def _promotion_message(score: CardScore) -> Message:
    name = score.promotion_label or "이 매장 이벤트"
    return Message(PROMOTION, f"{with_direction_particle(name)} 약 {int(round(score.promotion, -1)):,}원을 더 받을 수 있어요!")


def _shows_promotion(score: CardScore, params) -> bool:
    """행사 문구를 낼 만한지: 문구에 적힐 금액(10원 단위로 맞춘 기대 금액)이 promo_message_min 이상일 때만
    (2026-11-21 팀 결정). 기대 금액은 그 가게에 갈 확률을 곱한 값이라 작으면 '약 30원' 같은 문구가 된다."""
    return score.promotion > 0 and int(round(score.promotion, -1)) >= params.promo_message_min


def _fallback_message(state: UserState, user_card_id: int, at, params) -> Message:
    """혜택으로 말할 것이 없을 때. 최근 두 달(지난달과 이번 달) 이 시간대 현장 결제에서 이 카드를 가장 많이,
    HABIT_MIN 번 이상 썼을 때만 습관 문구를 쓰고, 아니면 혜택 차이가 없다고 그대로 말한다 (2026-11-21 팀 결정.
    1년 재생에서 습관 문구의 1순위 카드가 실제로 쓰던 카드와 같은 경우는 54%였다)."""
    slot = slot_of(at, params)
    used = Counter(p.user_card_id for p in (*state.prev_rows, *state.cur_rows)
                   if p.is_placement and p.paid_at < at and slot_of(p.paid_at, params) == slot)
    if used[user_card_id] >= HABIT_MIN and used[user_card_id] == max(used.values()):
        return Message(HABIT, "보통 지금 시간대에 이 카드로 계산하셨어요!")
    return Message(NEUTRAL, "지금은 카드마다 혜택 차이가 크지 않아요.")


def previous_base_filled(state: UserState, catalog: Catalog, last_base: int, params) -> bool:
    """직전 기본 카드가 이번 달 실적 구간을 실제로 채웠는지 ('앞 카드 실적을 채워 …' 문구를 낼 수 있는지).
    이번 달 실적이 그 카드의 첫 구간 이상이고, 구간 지키기를 쓰면 지난달 받던 구간 이상이어야 한다.
    구간이 없는 카드, 이번 달 실적이 모자란 카드(달이 바뀐 첫 화면, 고정 규칙으로 잠깐 앞에 온 카드)는 아니다
    (2026-11-21 팀 결정. 1년 재생에서 이 문구의 14.6%가 달이 바뀐 첫 화면이었다)."""
    card_id = state.card_ids.get(last_base)
    tiers = catalog.tiers.get(card_id, ()) if card_id is not None else ()
    if not tiers or last_base not in state.ledger:
        return False
    st = state.ledger[last_base]
    held = max((t for t in tiers if t <= st.prev_perf), default=tiers[0]) if params.hold_tiers else tiers[0]
    return st.perf >= max(tiers[0], held)


def card_message(state: UserState, catalog: Catalog, decision: Decision, scenarios: ScenarioSet, user_card_id: int,
                 at, params, base_changed: bool) -> Message:
    card_row = next(c for c in state.cards if c.user_card_id == user_card_id)
    score = decision.scores[user_card_id]
    if user_card_id == decision.first and not decision.swapped:
        if base_changed:
            return Message(BASE_CHANGED, f"앞 카드 실적을 채워 오늘부터 {with_object_particle(catalog.card_label(card_row.card_id))} 먼저 보여 드려요")
        if params.engine != "v3":
            if decision.hold:
                return _hold_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
            if decision.threshold > 0 and decision.gain > 0:   # 더 주는 카드가 있지만 실적 때문에 기본 카드를 유지
                return _performance_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
            if _shows_promotion(score, params) and score.promotion >= score.immediate:   # 기본 카드의 행사가 가장 큰 경우 (v4.2)
                return _promotion_message(score)
            message = _benefit_message(state, catalog, user_card_id, card_row.card_id, scenarios.scenarios, at)
            return message or _fallback_message(state, user_card_id, at, params)
        if _shows_promotion(score, params) and score.promotion >= max(score.immediate, score.performance):
            return _promotion_message(score)         # 기본 카드를 유지했지만 이 매장 이벤트가 가장 큰 경우
        if score.performance > score.immediate:      # 실적을 채우려고 기본 카드가 된 경우
            return _performance_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
        message = _benefit_message(state, catalog, user_card_id, card_row.card_id, scenarios.scenarios, at)
        return message or _fallback_message(state, user_card_id, at, params)
    if user_card_id == decision.first and decision.repeat_applied and decision.swap_reason != "performance":
        name = catalog.category_name(decision_category(scenarios))
        return Message(REPEAT, f"{slot_label(scenarios.slot)}에는 보통 {name}에서 결제하셔서 이 카드를 먼저 보여 드려요")
    dominant = _dominant(score, decision.scores[decision.base], params)
    if dominant == "performance" and score.performance > 0:
        return _performance_message(state, catalog, user_card_id, card_row.card_id, card_row.issuer)
    if dominant == "promotion" and _shows_promotion(score, params):
        return _promotion_message(score)
    message = _benefit_message(state, catalog, user_card_id, card_row.card_id, scenarios.scenarios, at)
    return message or _fallback_message(state, user_card_id, at, params)


def decision_category(scenarios: ScenarioSet) -> str:
    return scenarios.repeat_category or scenarios.top_category or ""

