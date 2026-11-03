"""생성 결과 요약. 분포를 바꾼 뒤 숫자가 그럴듯한지 확인할 때 쓴다.

실행: uv run python -m generate.summary
"""

import pandas as pd

from .common import OUT_DIR, load_config


def main() -> None:
    p = OUT_DIR / "parquet"
    pay = pd.read_parquet(p / "payments.parquet")
    users = pd.read_parquet(p / "users.parquet")
    uc = pd.read_parquet(p / "user_cards.parquet")

    s = load_config("settings")
    as_of = pd.Timestamp(s["as_of"]).tz_convert("Asia/Seoul")
    days = (as_of.normalize().tz_localize(None) - pd.Timestamp(s["start_date"])).days + 1
    months = days / 30.4

    pay = pay.merge(users[["user_id", "persona_code"]], on="user_id")
    n = users.groupby("persona_code").size()
    g = pay.groupby("persona_code")

    # 사용자별로 가장 많이 쓴 카드가 지출에서 차지하는 비율 (카드가 얼마나 몰리는지)
    per_card = pay.groupby(["persona_code", "user_id", "user_card_id"]).amount.sum()
    top_share = (per_card.groupby(["persona_code", "user_id"]).max()
                 / per_card.groupby(["persona_code", "user_id"]).sum()).groupby("persona_code").mean()

    print(f"== 유형별 1인 평균 ({s['start_date']} ~ {as_of:%Y-%m-%d %H:%M}, {days}일)")
    print(pd.DataFrame({
        "인원": n,
        "하루 결제(전체)": g.size() / n / days,
        "하루 결제(일반)": pay[pay.card_select_mode == "manual"].groupby("persona_code").size() / n / days,
        "월 지출(만원)": g.amount.sum() / n / months / 10000,
        "주 카드 지출 비중": top_share,
    }).round(2).to_string())

    print("\n== 업종 비중 (건수 %, 금액 %)")
    cat = pd.DataFrame({
        "건수%": pay.category_code.value_counts(normalize=True) * 100,
        "금액%": pay.groupby("category_code").amount.sum() / pay.amount.sum() * 100,
    }).round(1).sort_values("건수%", ascending=False)
    print(cat.to_string())

    print("\n== 결제 방식 · 카드 고른 이유")
    print(pay.card_select_mode.value_counts().to_string())
    print(pay.choice_reason.value_counts().to_string())

    print("\n== 발급사별 결제 비중 (금액 %)")
    print((pay.groupby("issuer_code").amount.sum() / pay.amount.sum() * 100).round(1).to_string())

    print("\n== 데모 사용자 카드별 지출 (전체 기간, 만원)")
    d = (pay[pay.user_id < 1000].groupby(["user_id", "user_card_id"]).amount.sum() / 10000).round(1).rename("지출")
    d = d.reset_index().merge(uc[["user_card_id", "card_code", "display_order"]], on="user_card_id")
    print(d[["user_id", "display_order", "card_code", "지출"]].to_string(index=False))


if __name__ == "__main__":
    main()
