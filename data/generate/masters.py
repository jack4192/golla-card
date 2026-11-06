"""① 기준 정보: 발급사, 업종, 가상 카드.

가상 카드의 혜택 규칙과 실적 구간별 한도도 함께 내보낸다. 값은 모두 임의로 만든 가정값이다.
"""

import json

import pandas as pd

from .benefit import DAY_NAMES, Card
from .common import load_config


def build_masters(cards: list[Card]) -> dict[str, pd.DataFrame]:
    issuers = pd.DataFrame(load_config("issuers")["issuers"]).rename(
        columns={"code": "issuer_code", "name": "issuer_name"})
    categories = pd.DataFrame(load_config("categories")["categories"]).rename(
        columns={"code": "category_code", "name": "category_name",
                 "channel": "default_channel", "placement_target": "is_placement_target"})
    catalog = pd.DataFrame([{
        "card_id": c.card_id, "card_code": c.code, "issuer_code": c.issuer, "card_name": c.name,
        "card_type": c.card_type, "tags": ",".join(c.tags), "annual_fee": c.annual_fee,
        "is_placeholder_name": True, "data_origin": "synthetic",
    } for c in cards])
    return {"issuers": issuers, "merchant_categories": categories, "card_catalog": catalog,
            "card_benefits": _benefits_frame(cards), "card_cap_tiers": _cap_tiers_frame(cards)}


def _benefits_frame(cards: list[Card]) -> pd.DataFrame:
    rows = [{
        "benefit_id": b.benefit_id, "card_id": c.card_id, "category_code": "ALL" if b.category == "*" else b.category,
        "benefit_type": b.type, "rate": b.rate,
        "rate_by_tier": json.dumps([{"min": lo, "rate": r} for lo, r in b.rate_by_tier]) if b.rate_by_tier else None,
        "amount": b.amount, "min_amount": b.min_amount, "monthly_count": b.monthly_count, "cap_group": b.cap_group,
        "days": ",".join(DAY_NAMES[d] for d in b.days) if b.days else None,
        "hour_start": b.hours[0] if b.hours else None, "hour_end": b.hours[1] if b.hours else None,
    } for c in cards for b in c.benefits]
    df = pd.DataFrame(rows)
    for col in ("amount", "monthly_count", "hour_start", "hour_end"):
        df[col] = df[col].astype("Int64")
    return df


def _cap_tiers_frame(cards: list[Card]) -> pd.DataFrame:
    df = pd.DataFrame([{"card_id": c.card_id, "cap_group": group, "min_prev_perf": lo, "monthly_cap": cap}
                       for c in cards for group, tiers in c.cap_tiers.items() for lo, cap in tiers])
    df["monthly_cap"] = df["monthly_cap"].astype("Int64")   # 비어 있으면 한도 없음
    return df
