"""맞춤형 카드 추천: 최근 N개월의 모든 결제를 미보유 신한카드 한 장으로 했다고 보고 다시 계산한다 (챗봇 설계서).

달마다 전월 실적 구간과 월 한도를 적용하고, 첫 달의 전월 실적은 그 앞 달 결제 합으로 본다.
월 평균 혜택에서 연회비÷12 를 뺀 순혜택이 큰 순서로 돌려준다. 금액은 10원 단위로 반올림한다.
"""

from collections import Counter, defaultdict
from datetime import datetime

from engine.benefit_calc import CardMonth, apply, evaluate
from engine.domain import Payment
from engine.recommend import candidates


def _month_keys(at: datetime, months: int) -> list[tuple[int, int]]:
    y, m = at.year, at.month
    keys = []
    for _ in range(months):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        keys.append((y, m))
    return sorted(keys)


def _prev(key: tuple[int, int]) -> tuple[int, int]:
    y, m = key
    return (y - 1, 12) if m == 1 else (y, m - 1)


def recommend_new_cards(state, payments: list[Payment], at: datetime, months: int = 3, top: int = 3, cards=None) -> dict:
    """at 이 속한 달 직전 months 개월(다 끝난 달)로 계산한다. 결제가 있는 달만 평균에 넣는다.
    cards: 주면 그 카드들만 그 순서대로 계산한다 (챗봇 카드 지정 비교 compare_cards, 2026-11-24). 없으면 미보유 신한카드 상위 top 장."""
    catalog = state.catalog
    keys = _month_keys(at, months)
    by_month: dict[tuple[int, int], list[Payment]] = defaultdict(list)
    for p in payments:
        by_month[(p.paid_at.year, p.paid_at.month)].append(p)
    used = [k for k in keys if by_month.get(k)]
    if not used:
        return {"months": [], "cards": [], "note": "최근 결제가 없어 계산할 수 없습니다"}
    rows = []
    for card in (cards if cards is not None else candidates(state)):
        total, by_cat = 0, Counter()
        prev_perf = sum(p.amount for p in by_month.get(_prev(used[0]), []))
        for key in used:
            st = CardMonth(prev_perf=prev_perf)
            for p in sorted(by_month[key], key=lambda r: r.paid_at):
                got, b = evaluate(card, p.category, p.amount, st, p.paid_at, catalog.brand_of(p.merchant_id), p.pay)
                apply(st, p.amount, got, b, when=p.paid_at)
                total += got
                by_cat[p.category] += got
            prev_perf = st.perf
        monthly = int(round(total / len(used), -1))
        fee_month = int(round(card.annual_fee / 12, -1))
        rows.append({
            "card_id": card.card_id, "name": catalog.card_label(card.card_id),
            "monthly_benefit": monthly, "annual_fee": card.annual_fee, "annual_fee_monthly": fee_month,
            "net_benefit": monthly - fee_month,
            "top_categories": [{"category": c, "category_name": catalog.category_name(c), "benefit": int(round(v / len(used), -1))}
                               for c, v in by_cat.most_common(3) if v > 0],
        })
    if cards is None:
        rows.sort(key=lambda r: (-r["net_benefit"], r["card_id"]))
        rows = rows[:top]
    spend = int(round(sum(p.amount for k in used for p in by_month[k]) / len(used), -1))
    return {"months": [f"{y}-{m:02d}" for y, m in used], "monthly_spend": spend, "cards": rows}
