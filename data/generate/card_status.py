"""⑤ 카드별 월 실적과 받은 혜택.

결제 내역은 바꾸지 않고, 실제로 쓴 카드 그대로 혜택을 계산한다.
첫 달은 전월 실적을 알 수 없으므로 혜택 없이 실적만 쌓는다.
브랜드 한정 혜택은 가맹점의 브랜드(최종 카드 DB 브랜드명)로, 간편결제 조건은 결제 방식(pay_method)으로 판단하고, 월 리워드(전월 실적만 보고 주는 정액)는 받은 혜택에 더한다.
"""

import pandas as pd

from .benefit import Card, CardMonth, apply, evaluate, month_reward, pay_method


def build_card_status(cards: list[Card], user_cards: pd.DataFrame, payments: pd.DataFrame,
                      merchants: pd.DataFrame) -> pd.DataFrame:
    by_id = {c.card_id: c for c in cards}
    brand = {int(k): v for k, v in zip(merchants.merchant_id, merchants.brand_code) if isinstance(v, str)}
    owners = user_cards[["user_card_id", "user_id", "card_id"]].itertuples(index=False)
    owned = list(owners)
    pay = payments.assign(year_month=payments.paid_at.dt.strftime("%Y-%m")).sort_values("paid_at", kind="stable")

    rows, prev_perf = [], {}
    for i, (year_month, group) in enumerate(pay.groupby("year_month", sort=True)):
        states = {uc.user_card_id: CardMonth(prev_perf=prev_perf.get(uc.user_card_id, 0)) for uc in owned}
        for r in group.itertuples():
            state = states[r.user_card_id]
            merchant = None if pd.isna(r.merchant_id) else brand.get(int(r.merchant_id))
            got, benefit = ((0, None) if i == 0 else
                            evaluate(by_id[r.card_id], r.category_code, r.amount, state, r.paid_at, merchant,
                                     pay_method(r.channel, r.card_select_mode)))
            apply(state, r.amount, got, benefit, when=r.paid_at)
        if i > 0:
            for uc in owned:
                states[uc.user_card_id].discount += month_reward(by_id[uc.card_id], states[uc.user_card_id].prev_perf)
        for uc in owned:
            state = states[uc.user_card_id]
            rows.append({
                "user_id": uc.user_id, "user_card_id": uc.user_card_id, "card_id": uc.card_id,
                "year_month": year_month, "prev_perf": state.prev_perf, "perf": state.perf,
                "benefit_amount": state.discount, "txn_count": state.txn,
            })
            prev_perf[uc.user_card_id] = state.perf
    return pd.DataFrame(rows)
