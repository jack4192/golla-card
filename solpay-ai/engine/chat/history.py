"""챗봇 고도화 2단계 도구의 계산 (2026-11-24, docs/설계/2026-11-24-chatbot-stage2-design.md).

결제 요약(spending), 지난 결제 다시 보기(review), 올해 받은 혜택(year_totals). 엔진 상태를 바꾸지 않는다.
OpenAI 로 가는 결과에는 업종·금액·날짜·카드 이름·카드사 목록 브랜드(brand_code)만 넣는다. 가맹점 원문(merchant.name)은 넣지 않는다.
"""

from collections import Counter, defaultdict
from datetime import datetime, timedelta

from engine.benefit_calc import evaluate
from engine.slots import ym_of
from engine.state import UserState

PERIODS = ("today", "yesterday", "this_week", "last_7_days", "this_month", "last_month", "this_year")
PERIOD_LABEL = {"today": "오늘", "yesterday": "어제", "this_week": "이번 주", "last_7_days": "최근 7일",
                "this_month": "이번 달", "last_month": "지난달", "this_year": "올해"}


class PeriodError(ValueError):
    pass


def _month_start(d: datetime, back: int = 0) -> datetime:
    y, m = d.year, d.month - back
    while m < 1:
        y, m = y - 1, m + 12
    return d.replace(year=y, month=m, day=1, hour=0, minute=0, second=0, microsecond=0)


def _same_point(month_start: datetime, at: datetime) -> datetime:
    """month_start 달에서 at 과 같은 날·시각 (그 달에 없는 날이면 그 달 말일)."""
    nxt = _month_start(month_start.replace(day=28) + timedelta(days=4))
    last_day = (nxt - timedelta(days=1)).day
    return month_start.replace(day=min(at.day, last_day), hour=at.hour, minute=at.minute, second=at.second)


def window(period: str, at: datetime) -> tuple[datetime, datetime, datetime, datetime]:
    """(시작, 끝, 직전 시작, 직전 끝). 끝은 포함하지 않는다. '지금까지' 기간은 at 에서 끝난다."""
    midnight = at.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "today":
        return midnight, at, midnight - timedelta(days=1), at - timedelta(days=1)
    if period == "yesterday":
        d = timedelta(days=1)
        return midnight - d, midnight, midnight - 2 * d, midnight - d
    if period == "this_week":
        start = midnight - timedelta(days=at.weekday())
        return start, at, start - timedelta(days=7), at - timedelta(days=7)
    if period == "last_7_days":
        return at - timedelta(days=7), at, at - timedelta(days=14), at - timedelta(days=7)
    if period == "this_month":
        start, prev = _month_start(at), _month_start(at, 1)
        return start, at, prev, _same_point(prev, at)
    if period == "last_month":
        return _month_start(at, 1), _month_start(at), _month_start(at, 2), _month_start(at, 1)
    if period == "this_year":
        start = midnight.replace(month=1, day=1)
        return start, at, start.replace(year=start.year - 1), at.replace(year=at.year - 1)
    raise PeriodError(f"period 는 {', '.join(PERIODS)} 중 하나입니다: {period}")


def _day(d: datetime) -> str:
    return f"{d:%Y-%m-%d}"


def _last_day(end: datetime, at: datetime) -> str:
    return _day(at if end >= at else end - timedelta(seconds=1))


def spending(payments, catalog, names: dict, at: datetime, period: str, category: str | None = None,
             user_card_id: int | None = None) -> dict:
    start, end, p_start, p_end = window(period, at)

    def keep(p):
        return (category is None or p.category == category) and (user_card_id is None or p.user_card_id == user_card_id)

    rows = [p for p in payments if start <= p.paid_at < end and keep(p)]
    before = [p for p in payments if p_start <= p.paid_at < p_end and keep(p)]

    def by(key, items):
        amount, count = Counter(), Counter()
        for p in items:
            k = key(p)
            if k is not None:
                amount[k] += p.amount
                count[k] += 1
        return amount, count

    cat_amt, cat_cnt = by(lambda p: p.category, rows)
    card_amt, card_cnt = by(lambda p: p.user_card_id, rows)
    brand_amt, brand_cnt = by(lambda p: catalog.brand_of(p.merchant_id), rows)
    prev_amt, _ = by(lambda p: p.category, before)
    change = sorted(((c, cat_amt.get(c, 0), prev_amt.get(c, 0)) for c in set(cat_amt) | set(prev_amt)),
                    key=lambda x: -abs(x[1] - x[2]))[:3]
    return {
        "period": PERIOD_LABEL[period], "from": _day(start), "to": _last_day(end, at),
        "total": sum(p.amount for p in rows), "count": len(rows),
        "by_category": [{"category_name": catalog.category_name(c), "amount": a, "count": cat_cnt[c]}
                        for c, a in cat_amt.most_common(8)],
        "by_card": [{"name": names.get(uc, str(uc)), "amount": a, "count": card_cnt[uc]} for uc, a in card_amt.most_common()],
        "top_brands": [{"brand": b, "amount": a, "count": brand_cnt[b]} for b, a in brand_amt.most_common(5)],
        "previous": {"from": _day(p_start), "to": _last_day(p_end, at), "total": sum(p.amount for p in before),
                     "by_category_change": [{"category_name": catalog.category_name(c), "this": a, "before": b,
                                             "change": a - b} for c, a, b in change]},
        "recent": [{"date": f"{p.paid_at:%Y-%m-%d %H:%M}", "category_name": catalog.category_name(p.category),
                    "brand": catalog.brand_of(p.merchant_id), "amount": p.amount, "card": names.get(p.user_card_id)}
                   for p in sorted(rows, key=lambda r: r.paid_at, reverse=True)[:5]],
        "note": "브랜드는 카드사 가맹점 목록에 있는 곳만 이름이 나온다. 직전 기간(previous)은 같은 길이의 바로 앞 기간이다.",
    }


def _replay(context, catalog, params, visit):
    """결제를 처음부터 다시 반영한다. visit(p, state) 가 True 를 돌려주면 그 결제 직전 상태에서 카드마다 혜택을 계산해
    (p, {user_card_id: 혜택}, 받은 혜택) 을 모은다. 실적이 나중에 들어온 결제(이미 지난달로 넘어간 뒤)는 비교하지 않는다."""
    state = UserState(context.user, context.cards, catalog, params, benefit_start=context.benefit_start)
    out = []
    for p in context.payments:
        values = None
        if visit(p):
            ym = ym_of(p.paid_at)
            if state.ym is None or ym > state.ym:
                state.roll_to(ym)
            if ym == state.ym and (state.benefit_start is None or ym >= state.benefit_start):
                brand = catalog.brand_of(p.merchant_id)
                values = {uc: evaluate(catalog.cards[state.card_ids[uc]], p.category, p.amount, st, p.paid_at, brand,
                                       p.pay)[0] for uc, st in state.ledger.items()}
        got = state.apply(p)
        if values is not None:
            out.append((p, values, got))
    return out


def review(context, catalog, params, names: dict, at: datetime, period: str, category: str | None = None,
           brand: str | None = None, only_missed: bool = False) -> dict:
    start, end, _, _ = window(period, at)

    def visit(p):
        return (start <= p.paid_at < end and (category is None or p.category == category)
                and (brand is None or catalog.brand_of(p.merchant_id) == brand))

    rows = []
    for p, values, got in _replay(context, catalog, params, visit):
        best = max(values, key=lambda uc: (values[uc], uc == p.user_card_id))
        rows.append({"date": f"{p.paid_at:%Y-%m-%d %H:%M}", "category_name": catalog.category_name(p.category),
                     "brand": catalog.brand_of(p.merchant_id), "amount": p.amount,
                     "used_card": names.get(p.user_card_id), "got": got,
                     "best_card": names.get(best), "best_got": values[best], "missed": values[best] - got})
    shown = ([r for r in sorted(rows, key=lambda r: (-r["missed"], r["date"])) if r["missed"] > 0] if only_missed
             else sorted(rows, key=lambda r: r["date"], reverse=True))
    return {
        "period": PERIOD_LABEL[period], "from": _day(start), "to": _last_day(end, at), "count": len(rows),
        "best_card_count": sum(r["missed"] == 0 for r in rows), "got_total": sum(r["got"] for r in rows),
        "missed_total": sum(r["missed"] for r in rows), "missed_count": sum(r["missed"] > 0 for r in rows),
        "payments": shown[:8],
        "note": "카드 혜택만 비교했다 (프로모션 제외). 그 결제 하나만 본 값이라, 실적 구간을 채우려고 기본 카드로 낸 결제는 "
                "덜 받은 것처럼 보일 수 있다. payments 는 최대 8건만 보인다.",
    }


def year_totals(context, catalog, params, names: dict, at: datetime) -> dict:
    """올해 결제의 받은 카드 혜택(엔진이 다시 계산)과 프로모션(결제 기록값)을 달별·카드별로."""
    state = UserState(context.user, context.cards, catalog, params, benefit_start=context.benefit_start)
    by_month, by_card, promo = defaultdict(int), defaultdict(int), 0
    for p in context.payments:
        got = state.apply(p)
        if p.paid_at.year == at.year and p.paid_at < at:
            by_month[p.paid_at.month] += got
            by_card[p.user_card_id] += got
            promo += p.promotion_amount or 0
    card_total = sum(by_month.values())
    return {"year": at.year, "card_benefit_total": card_total, "promotion_total": promo, "total": card_total + promo,
            "by_month": [{"month": f"{m}월", "benefit": by_month[m]} for m in sorted(by_month)],
            "by_card": [{"name": names.get(uc, str(uc)), "benefit": v} for uc, v in sorted(by_card.items(), key=lambda x: -x[1])]}
