"""가상 데이터를 placement 스키마에 넣는다.

    SOLPAY_DATABASE_URL=postgresql://... uv run python -m scripts.load_demo_to_postgres
"""

import os
from pathlib import Path

import psycopg

from engine.loader import read

SCHEMA = Path(__file__).resolve().parent.parent / "sql" / "001_placement.sql"
TABLES = {
    "merchant_categories": ["category_code", "category_name"],
    "card_catalog": ["card_id", "card_code", "issuer_code", "card_name", "card_type", "tags", "annual_fee"],
    "card_benefits": ["benefit_id", "card_id", "category_code", "benefit_type", "rate", "amount", "per_liter",
                      "min_amount", "min_prev_perf", "max_per_tx", "monthly_count", "daily_count", "cap_group",
                      "cap_unit", "row_cap", "days", "month_days", "hour_start", "hour_end", "brands", "plan_day",
                      "plan_mult", "also_categories", "targets", "max_prev_perf", "basis", "pay_type",
                      "source_benefit_id", "benefit_name"],
    "card_cap_tiers": ["card_id", "cap_group", "min_prev_perf", "monthly_cap", "cap_unit"],
    "card_total_caps": ["card_id", "min_prev_perf", "total_limit"],
    "card_rewards": ["card_id", "min_prev_perf", "amount"],
    "merchants": ["merchant_id", "place_name", "category_code", "lat", "lng", "is_online", "zone_code", "brand",
                  "brand_code"],
    "promotions": ["promotion_id", "kind", "brand", "match_brand", "category_code", "card_id", "title", "issuer_code",
                   "benefit_type", "amount", "rate",
                   "min_amount", "max_amount", "starts_at", "ends_at", "payout", "note", "needs_check"],
    "users": ["user_id"],
    "user_cards": ["user_card_id", "user_id", "card_id", "issuer_code", "display_order", "exclude_from_placement"],
    "payments": ["payment_id", "user_id", "user_card_id", "merchant_id", "category_code", "channel",
                 "card_select_mode", "amount", "paid_at", "synced_at"],
}
OPTIONAL = {"promotions"}     # 없으면 건너뛴다


def main() -> None:
    url = os.environ["SOLPAY_DATABASE_URL"]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA.read_text(encoding="utf-8"))
        for table in reversed(TABLES):
            cur.execute(f"delete from placement.{table}")
        for table, columns in TABLES.items():
            try:
                df = read(table)[columns].astype(object)
            except FileNotFoundError:
                if table in OPTIONAL:
                    print(f"{table}: 파일 없음, 건너뜀")
                    continue
                raise
            df = df.where(df.notna(), None)
            with cur.copy(f"copy placement.{table} ({', '.join(columns)}) from stdin") as copy:
                for row in df.itertuples(index=False):
                    copy.write_row(row)
            print(f"{table}: {len(df):,}건")


if __name__ == "__main__":
    main()
