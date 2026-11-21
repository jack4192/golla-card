"""월간 리포트: 카드별 이번 달·지난달 숫자. 숫자는 엔진 상태(원장)에서만 가져온다."""
import heapq
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime, timedelta

from engine.benefit_calc import Card, CardMonth, cap_for, total_cap
from engine.catalog import Catalog
from engine.domain import Payment, RankResult
from engine.params import (BASE_ORDER_FIRST_TIER, BASE_ORDER_MAIN_TOP, BASE_ORDER_NONE, BASE_ORDER_TOP_TIER,
                           BASE_ORDER_VALUE)
from engine.perf_value import month_benefit
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


def month_starts(at: datetime) -> tuple[datetime, datetime]:
    """(지난달 1일 0시, 이번 달 1일 0시). at 의 시간대를 그대로 쓴다."""
    this = at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (this - timedelta(days=1)).replace(day=1), this


def totals_of(rows: list[dict]) -> dict:
    """카드별 혜택(카드사 혜택, 프로모션 제외)의 합."""
    return {"this_month_benefit": sum(r["this_month"]["benefit"] for r in rows),
            "prev_month_benefit": sum(r["prev_month"]["benefit"] for r in rows)}


def strategy_now(result: RankResult, rows: list[dict]) -> dict:
    """지금 결제 화면(기록을 남기지 않는 preview)에서 고른 것: 실적을 채우는 기본 카드와 그 카드의 이번 달 다음 구간·남은 금액
    (최고 구간이면 target_tier None, remaining 0), 보여 주는 카드 순서, 1순위 카드 안내 문구."""
    by_id = {r["user_card_id"]: r for r in rows}
    base = by_id.get(result.base_card)
    return {
        "base_card": {"user_card_id": base["user_card_id"], "name": base["name"],
                      "target_tier": base["this_month"]["next_tier"],
                      "remaining": base["this_month"]["remaining_to_next"]} if base else None,
        "current_order": [{"rank": c.rank, "user_card_id": c.user_card_id, "name": by_id[c.user_card_id]["name"]}
                          for c in result.cards[:result.display_count]],
        "message": result.cards[0].message if result.cards else "",
    }


def _next_month(state: UserState, assigned: dict[int, list[Payment]], catalog: Catalog) -> int:
    """카드별로 지난달 결제를 지난달 실적 구간으로 이번 달에 똑같이 했다면 받을 혜택의 합 (월간 맞춤 방식과 같은 추정)."""
    return sum(month_benefit(catalog.cards[uc.card_id], assigned[uc.user_card_id],
                             state.ledger[uc.user_card_id].perf, catalog) for uc in state.cards)


def _tier_changes(actual: UserState, recommended: UserState, catalog: Catalog) -> list[dict]:
    """실제와 추천의 도달 구간(하한, 없으면 None)이 다른 카드."""
    out = []
    for uc in actual.cards:
        tiers = list(catalog.tiers[uc.card_id])
        a_perf, r_perf = actual.ledger[uc.user_card_id].perf, recommended.ledger[uc.user_card_id].perf
        a, r = tier_info(tiers, a_perf), tier_info(tiers, r_perf)
        if a["tier_reached"] != r["tier_reached"]:
            out.append({"card": catalog.card_label(uc.card_id), "first_tier": a["first_tier"],
                        "actual_perf": a_perf, "recommended_perf": r_perf,
                        "actual_tier": a["tier_reached"], "recommended_tier": r["tier_reached"]})
    return out


def replay_month(start: Callable[[], UserState], payments: list[Payment],
                 choose: Callable[[UserState, Payment], tuple[int, str]], promo: Callable[[int, Payment], int],
                 catalog: Catalog, month: str) -> dict | None:
    """지난달 SOL페이 효과: 지난달 결제(시간순)를 다시 흘려 결제화면 결제만 choose 가 고른 카드로 냈다면.
    start() 는 지난달 1일 직전까지 반영한 새 상태를 돌려준다 (세 번 부른다: 실제·추천·엔진이 보는 상태).
    엔진이 보는 상태는 결제화면 결제를 바로, 나머지는 visible_at 이후에 안다 (재생 평가 replay_user 와 같다).
    choose(view, p) → (카드, 이유 코드), promo(카드, p) → 그 결제의 프로모션 (결제화면 결제만 부른다).
    결제화면 결제가 없으면 None."""
    if not any(p.is_placement for p in payments):
        return None
    actual, recommended, view = start(), start(), start()
    for state in (actual, recommended, view):
        state.roll_to(month)
    card_of = actual.card_ids
    sums = {"actual": {"card": 0, "promotion": 0}, "recommended": {"card": 0, "promotion": 0}}
    assigned = {"actual": {uc: [] for uc in card_of}, "recommended": {uc: [] for uc in card_of}}
    pending, changes, placements = [], [], 0
    for seq, p in enumerate(payments):
        while pending and pending[0][0] <= p.paid_at:
            view.apply(heapq.heappop(pending)[2])
        chosen, code = choose(view, p) if p.is_placement else (p.user_card_id, None)
        moved = replace(p, user_card_id=chosen)
        got = {"actual": actual.apply(p), "recommended": recommended.apply(moved)}
        assigned["actual"][p.user_card_id].append(p)
        assigned["recommended"][chosen].append(moved)
        for side in sums:
            sums[side]["card"] += got[side]
        if not p.is_placement:
            heapq.heappush(pending, (p.visible_at, seq, moved))
            continue
        placements += 1
        view.apply(moved)
        promo_a = promo(p.user_card_id, p)
        promo_r = promo_a if chosen == p.user_card_id else promo(chosen, p)
        sums["actual"]["promotion"] += promo_a
        sums["recommended"]["promotion"] += promo_r
        if chosen != p.user_card_id:
            changes.append((got["recommended"] + promo_r - got["actual"] - promo_a, p, chosen, code))

    sums["actual"]["next_month"] = _next_month(actual, assigned["actual"], catalog)
    sums["recommended"]["next_month"] = _next_month(recommended, assigned["recommended"], catalog)
    diff = {k: sums["recommended"][k] - sums["actual"][k] for k in ("card", "promotion", "next_month")}
    diff["total"] = diff["card"] + diff["promotion"] + diff["next_month"]
    changes.sort(key=lambda c: c[0], reverse=diff["total"] >= 0)      # 덜 받았으면 덜 받은 결제부터
    top = [{"day": p.paid_at.date().isoformat(), "category": catalog.category_name(p.category), "amount": p.amount,
            "actual_card": catalog.card_label(card_of[p.user_card_id]),
            "recommended_card": catalog.card_label(card_of[chosen]), "diff": d, "why": reason_group(code)}
           for d, p, chosen, code in changes[:3]]
    return {"month": month, "placement_payments": placements, "changed_payments": len(changes),
            "actual": sums["actual"], "recommended": sums["recommended"], "diff": diff,
            "top_changes": top, "tier_changes": _tier_changes(actual, recommended, catalog)}
