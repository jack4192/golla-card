"""월간 리포트: 카드별 이번 달·지난달 숫자. 숫자는 엔진 상태(원장)에서만 가져온다."""
from engine.benefit_calc import Card, CardMonth, cap_for, total_cap
from engine.catalog import Catalog
from engine.params import (BASE_ORDER_FIRST_TIER, BASE_ORDER_MAIN_TOP, BASE_ORDER_NONE, BASE_ORDER_TOP_TIER,
                           BASE_ORDER_VALUE)
from engine.state import UserState

STRATEGY_LABEL = {BASE_ORDER_FIRST_TIER: "첫 구간 우선", BASE_ORDER_MAIN_TOP: "주력 카드 우선",
                  BASE_ORDER_VALUE: "가치 최대", BASE_ORDER_NONE: "실적 안 채움",
                  BASE_ORDER_TOP_TIER: "1번 카드 최고 구간 우선"}
STRATEGY_DESC = {BASE_ORDER_FIRST_TIER: "모든 카드의 첫 구간을 먼저 채운다",
                 BASE_ORDER_MAIN_TOP: "구간 혜택이 가장 큰 주력 카드의 높은 구간부터 채우고 남으면 다른 카드",
                 BASE_ORDER_VALUE: "남은 예산 안에서 (구간 증분 혜택 − 포기하는 혜택) 합이 최대인 구간 조합",
                 BASE_ORDER_NONE: "실적을 채우지 않고 결제마다 혜택률이 가장 높은 카드",
                 BASE_ORDER_TOP_TIER: "1번 카드의 최고 구간부터 채운다"}
REASON_GROUP = {"RULE": "사용자 규칙", "PROMOTION": "프로모션", "PROMOTION_CARD": "프로모션",
                "PERFORMANCE": "실적 채우기", "HOLD": "실적 채우기", "BASE_CHANGED": "실적 채우기"}


def reason_group(code: str) -> str:
    """배치 이유 코드를 리포트의 묶음 이름으로 바꾼다 (규칙·프로모션·실적 채우기, 그 밖은 혜택 비교)."""
    return REASON_GROUP.get(code, "혜택 비교")


def limits_of(card: Card, ledger: CardMonth) -> list[dict]:
    """카드 월 통합 한도와 혜택 묶음별 한도의 사용액·남은 금액."""
    limits = []
    total = total_cap(card, ledger.prev_perf)
    if total is not None:
        limits.append({"name": "카드 월 통합 한도", "used": ledger.discount, "limit": total,
                       "left": max(total - ledger.discount, 0)})
    for group in card.cap_tiers:
        ok, cap = cap_for(card, group, ledger.prev_perf)
        if not ok or cap is None:
            continue
        label = next((b.name for b in card.benefits if b.cap_group == group), group)
        used = ledger.cap_used.get(group, 0)
        limits.append({"name": label, "used": used, "limit": cap, "left": max(cap - used, 0)})
    return limits


def _has_tiers(tiers) -> bool:
    return any(t > 0 for t in tiers)


def this_month_tiers(tiers: list[int], ledger: CardMonth) -> dict:
    """이번 달 구간 칸. tier_min 은 지난달 실적으로 받는 구간 하한(없으면 None, 구간 0원짜리면 0),
    remaining_to_keep 은 그 구간을 다음 달에도 받기까지 남은 금액(구간이 없거나 0이면 None),
    next_tier 는 이번 달 실적 바로 위 구간, remaining_to_next 는 거기까지 남은 금액(없으면 0).
    실적 조건 없는 카드의 None 처리는 부르는 쪽(card_rows)이 한다."""
    held = max((t for t in tiers if t <= ledger.prev_perf), default=None)
    nxt = next((t for t in tiers if t > ledger.perf), None)
    return {"tier_min": held, "remaining_to_keep": max(held - ledger.perf, 0) if held else None,
            "next_tier": nxt, "remaining_to_next": nxt - ledger.perf if nxt else 0}


def tier_info(tiers: list[int], perf: int) -> dict:
    """첫 구간 달성 여부, 도달한 가장 높은 구간, 첫 구간까지 모자란 금액. 실적 조건이 없으면 모두 None."""
    if not _has_tiers(tiers):
        return {"first_tier": None, "tier_reached": None, "achieved": None, "short_of_first": None}
    first = min(t for t in tiers if t > 0)
    reached = max((t for t in tiers if 0 < t <= perf), default=None)
    return {"first_tier": first, "tier_reached": reached, "achieved": reached is not None,
            "short_of_first": max(first - perf, 0)}


def _payments_per_card(state: UserState) -> dict[int, int]:
    counts: dict[int, int] = {}
    for p in state.cur_rows:
        counts[p.user_card_id] = counts.get(p.user_card_id, 0) + 1
    return counts


def card_rows(now: UserState, prev: UserState, catalog: Catalog) -> list[dict]:
    """카드별 이번 달·지난달 숫자. now 는 이번 달로, prev 는 지난달로 roll 된 상태."""
    now_counts, prev_counts = _payments_per_card(now), _payments_per_card(prev)
    out = []
    for uc in now.cards:
        st, old = now.ledger[uc.user_card_id], prev.ledger[uc.user_card_id]
        tiers = list(catalog.tiers[uc.card_id])
        if _has_tiers(tiers):
            tier_fields = this_month_tiers(tiers, st)
        else:
            tier_fields = dict.fromkeys(("tier_min", "remaining_to_keep", "next_tier", "remaining_to_next"))
        out.append({
            "user_card_id": uc.user_card_id, "card_id": uc.card_id, "name": catalog.card_label(uc.card_id),
            "issuer": uc.issuer, "display_order": uc.display_order,
            "this_month": {"perf": st.perf, "benefit": st.discount, "payments": now_counts.get(uc.user_card_id, 0),
                           **tier_fields, "limits": limits_of(catalog.cards[uc.card_id], st)},
            "prev_month": {"perf": old.perf, "benefit": old.discount, "payments": prev_counts.get(uc.user_card_id, 0),
                           **tier_info(tiers, old.perf)},
            "synced_note": uc.issuer != "SHINHAN",
        })
    return out
