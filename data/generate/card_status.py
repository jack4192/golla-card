"""⑤ 카드별 월 실적과 받은 혜택.

결제 내역은 바꾸지 않고, 실제로 쓴 카드 그대로 혜택을 계산한다.
첫 달은 전월 실적을 알 수 없으므로 혜택 없이 실적만 쌓는다.
"""

import pandas as pd

from .benefit import Card, CardMonth, apply, evaluate


def build_card_status(cards: list[Card], user_cards: pd.DataFrame, payments: pd.DataFrame) -> pd.DataFrame:
    by_id = {c.card_id: c for c in cards}
    owners = user_cards[["user_card_id", "user_id", "card_id"]].itertuples(index=False)
    owned = list(owners)
    pay = payments.assign(year_month=payments.paid_at.dt.strftime("%Y-%m")).sort_values("paid_at", kind="stable")

    rows, prev_perf = [], {}
    for i, (year_month, group) in enumerate(pay.groupby("year_month", sort=True)):
        states = {uc.user_card_id: CardMonth(prev_perf=prev_perf.get(uc.user_card_id, 0)) for uc in owned}
        for r in group.itertuples():
            state = states[r.user_card_id]
            got, benefit = (0, None) if i == 0 else evaluate(by_id[r.card_id], r.category_code, r.amount, state, r.paid_at)
            apply(state, r.amount, got, benefit)
        for uc in owned:
            state = states[uc.user_card_id]
            rows.append({
                "user_id": uc.user_id, "user_card_id": uc.user_card_id, "card_id": uc.card_id,
                "year_month": year_month, "prev_perf": state.prev_perf, "perf": state.perf,
                "benefit_amount": state.discount, "txn_count": state.txn,
            })
            prev_perf[uc.user_card_id] = state.perf
    return pd.DataFrame(rows)
