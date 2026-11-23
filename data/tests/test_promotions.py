"""최종 프로모션 (generate.promotions, 2026-11-18 사용자 결정)."""

from datetime import date

import pandas as pd

from generate.promotions import (DB_COLUMNS, ENGINE_COLUMNS, PERIOD_START, db_frame, engine_frame, final_promotions,
                                 myshop_on, promo_value)


def test_가맹점을_식별할_수_없는_2건을_뺀_29건():
    ps = final_promotions()
    assert [p["promotion_id"] for p in ps] == list(range(1, 30))
    assert sum(p["kind"] == "myshop" for p in ps) == 23 and sum(p["kind"] == "event" for p in ps) == 6


def test_전체_기간에_있는_행사로_본다():
    ps = final_promotions()
    assert all(p["start"] == PERIOD_START == date(2025, 11, 1) for p in ps)
    assert all(p["end"] >= date(2026, 11, 5) for p in ps)          # 원래 종료일. 데이터 마지막 날(11-05)까지 모두 덮는다
    assert {p["promotion_id"]: str(p["end"]) for p in ps}[9] == "2026-11-15"


def test_팀_DB_형식():
    df = db_frame(pd.DataFrame(columns=["merchant_id", "brand", "brand_code", "place_name", "category_code"]))
    assert list(df.columns) == DB_COLUMNS
    assert set(df.issuer) == {"신한"} and df.card_id.isna().all() and df.merchant_id.isna().all()
    mega = df[df.promotion_id == 1].iloc[0]
    assert (mega.value_type, mega.value, mega.kind, mega.min_amount) == ("FIXED", 500, "event", 0)
    rate = df[df.value_type == "RATE"].iloc[0]
    assert 0 < rate.value <= 100                      # 비율은 % (10 = 10%)
    assert str(df.start_date.iloc[0]) == "2025-11-01"


def test_엔진_형식은_이전_칸과_같다():
    df = engine_frame()
    assert list(df.columns) == ENGINE_COLUMNS
    assert set(df.issuer_code) == {"SHINHAN"} and not df.needs_check.any()     # 응모·선착순 조건은 생략
    assert df.match_brand.notna().all()


def test_행사_금액은_엔진과_같은_규칙():
    p = {"amount": None, "rate": 0.1, "min_amount": 0, "max_amount": 2000}
    assert promo_value(p, 6_789) == 670                # 10원 단위 내림
    assert promo_value(p, 50_000) == 2000              # 건당 상한
    assert promo_value({"amount": 1000, "rate": None, "min_amount": 30_000, "max_amount": None}, 29_000) == 0
    assert promo_value({"amount": 1000, "rate": None, "min_amount": 30_000, "max_amount": None}, 30_000) == 1000


def test_마이샵_ON_은_사용자_행사_달마다_고정이고_약_30퍼센트():
    draws = [myshop_on(u, 9, "2026-03") for u in range(3_000)]
    assert draws == [myshop_on(u, 9, "2026-03") for u in range(3_000)]
    assert 0.27 < sum(draws) / len(draws) < 0.33


def _index():
    from generate.promotions import index_by_merchant
    m = pd.DataFrame([{"merchant_id": 7, "brand": "할리스", "brand_code": "할리스", "place_name": "할리스 역삼점",
                       "category_code": "CAFE"},
                      {"merchant_id": 8, "brand": "메가MGC커피", "brand_code": "메가MGC커피", "place_name": "메가MGC커피 역삼점",
                       "category_code": "CAFE"}])
    return index_by_merchant(final_promotions(), m)


def test_결제에는_조건이_맞는_가장_큰_행사_하나():
    from generate.promotions import best_promotion
    idx = _index()
    assert best_promotion(idx, 1, 8, "SHINHAN", 6_000, date(2026, 3, 2)) == (1, 500)          # 메가MGC커피 이벤트 500원
    assert best_promotion(idx, 1, 8, "KB", 6_000, date(2026, 3, 2)) == (None, 0)              # 신한카드만
    assert best_promotion(idx, 1, 99, "SHINHAN", 6_000, date(2026, 3, 2)) == (None, 0)        # 행사 가맹점 아님
    assert best_promotion(idx, 1, 8, "SHINHAN", 6_000, date(2025, 10, 31)) == (None, 0)       # 기간 전


def test_마이샵은_ON_인_사용자_달에만():
    from generate.promotions import best_promotion
    idx = _index()
    hollys = next(p for p in final_promotions() if p["brand"] == "할리스")
    on = [u for u in range(200) if myshop_on(u, hollys["promotion_id"], "2026-03")]
    off = [u for u in range(200) if not myshop_on(u, hollys["promotion_id"], "2026-03")]
    assert best_promotion(idx, on[0], 7, "SHINHAN", 6_000, date(2026, 3, 2))[1] > 0
    assert best_promotion(idx, off[0], 7, "SHINHAN", 6_000, date(2026, 3, 2)) == (None, 0)


# ---------- 화면용 칸 (2026-11-23 행사 목록 DB 이전) ----------

def test_display_frame_has_29_rows_with_screen_values():
    from generate.promotions import display_frame
    df = display_frame().set_index("promotion_id")
    assert len(df) == 29 and 30 not in df.index and 31 not in df.index
    assert df.loc[2, "display_name"] == "온라인 다이소몰" and df.loc[2, "benefit_text"] == "1,000 마이신한포인트 적립"
    assert str(df.loc[3, "display_start"]) == "2026-11-16" and str(df.loc[5, "display_end"]) == "2026-12-25"
    assert df.loc[1, "logo_url"] == "/brand-logos/mega.png" and df.loc[1, "note"] == "키오스크에서 바코드 스캔 필요"
    assert bool(df.loc[5, "needs_check"]) and bool(df.loc[6, "needs_check"]) and not bool(df.loc[1, "needs_check"])
    assert df.loc[8, "payout"] == "결제일에 따라 다름" and df.loc[8, "pay_method"] == "마이샵 혜택 ON 설정 후 신한카드 결제"
    assert pd.isna(df.loc[8, "note"]) and df.loc[7, "benefit_type"] == "discount"
    assert df.loc[21, "display_name"] == "차앤박(CNP)" and df.loc[21, "logo_url"] == "/brand-logos/cnp.png"


def test_db_frame_keeps_old_columns_and_adds_display():
    from generate.promotions import DISPLAY_COLUMNS
    old = ["promotion_id", "card_id", "issuer", "merchant_id", "promo_name", "category", "merchant_name",
           "value_type", "value", "max_amount", "start_date", "end_date", "kind", "min_amount"]
    df = db_frame(pd.DataFrame(columns=["merchant_id", "brand", "brand_code", "place_name", "category_code"]))
    assert list(df.columns) == old + DISPLAY_COLUMNS
    assert (df.start_date == "2025-11-01").sum() == 29 and len(df) == 29
    row = df[df.promotion_id == 2].iloc[0]
    assert (row.merchant_name, row.display_name) == ("다이소몰", "온라인 다이소몰")


def test_migration_sql_updates_29_rows_and_never_inserts():
    from generate.promotions import migration_sql
    sql = migration_sql()
    assert sql.count("UPDATE public.promotions SET") == 29 and "INSERT" not in sql.upper()
    assert "ADD COLUMN IF NOT EXISTS display_name varchar(100)" in sql
    assert "ADD COLUMN IF NOT EXISTS needs_check boolean NOT NULL DEFAULT false" in sql
    assert "BEGIN;" in sql and "COMMIT;" in sql
    assert "'X-MAS 사전예약 제품 대상. 매일 오전 10:30부터 선착순'" in sql
