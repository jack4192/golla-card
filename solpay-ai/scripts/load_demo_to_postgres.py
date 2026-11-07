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
    "card_benefits": ["benefit_id", "card_id", "category_code", "benefit_type", "rate", "rate_by_tier", "amount",
                      "min_amount", "monthly_count", "cap_group", "days", "hour_start", "hour_end"],
    "card_cap_tiers": ["card_id", "cap_group", "min_prev_perf", "monthly_cap"],
    "merchants": ["merchant_id", "place_name", "category_code", "lat", "lng", "is_online", "zone_code"],
    "users": ["user_id", "loc_consent", "loc_feature_on"],
    "user_cards": ["user_card_id", "user_id", "card_id", "issuer_code", "display_order", "exclude_from_placement"],
    "payments": ["payment_id", "user_id", "user_card_id", "merchant_id", "category_code", "channel",
                 "card_select_mode", "amount", "paid_at", "synced_at"],
}


def main() -> None:
    url = os.environ["SOLPAY_DATABASE_URL"]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(SCHEMA.read_text(encoding="utf-8"))
        for table in reversed(TABLES):
            cur.execute(f"delete from placement.{table}")
        for table, columns in TABLES.items():
            df = read(table)[columns].astype(object)
            df = df.where(df.notna(), None)
            with cur.copy(f"copy placement.{table} ({', '.join(columns)}) from stdin") as copy:
                for row in df.itertuples(index=False):
                    copy.write_row(row)
            print(f"{table}: {len(df):,}건")


if __name__ == "__main__":
    main()
