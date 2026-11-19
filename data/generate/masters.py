"""① 기준 정보: 카드사, 업종, 최종 카드 DB의 카드 40장과 혜택 규칙, 브랜드, 프로모션 (2026-11-15).

카드·혜택·한도 원본은 config/card_db/*.csv 이고, 이름표와 제외 규칙은 config/card_db_map.yml 이다.
card_benefits 는 계산에 쓰는 행(원본 혜택 × 구간), card_benefits_source 는 원본 혜택 전체와 계산에서 뺀 이유다.
"""

import json

import pandas as pd

from .benefit import DAY_NAMES, Card
from .card_db import alias_table, benefit_rows, brand_home_category, canonical_brand, read
from .common import load_config
from .promotions import engine_frame


def build_masters(cards: list[Card]) -> dict[str, pd.DataFrame]:
    rules = load_config("card_db_map")
    issuers = pd.DataFrame([{"issuer_code": v["code"], "issuer_name": v["name"], "issuer_label": k,
                             "openpay_supported": v["openpay_supported"], "openpay_assumed": False,
                             "is_recommend_target": v["is_recommend_target"]} for k, v in rules["issuers"].items()])
    categories = pd.DataFrame(load_config("categories")["categories"]).rename(
        columns={"code": "category_code", "name": "category_name",
                 "channel": "default_channel", "placement_target": "is_placement_target"})
    raw = read("cards").set_index("card_id")
    catalog = pd.DataFrame([{
        "card_id": c.card_id, "card_code": c.code, "issuer_code": c.issuer, "card_name": c.name,
        "card_type": c.card_type, "tags": ",".join(c.tags), "annual_fee": c.annual_fee,
        "annual_fee_overseas": int(raw.annual_fee_overseas[c.card_id]), "description": raw.description[c.card_id],
        "image_url": None, "is_placeholder_name": False, "data_origin": "card_db_2026_11",
    } for c in cards])
    source = benefit_rows().rename(columns={"excluded": "excluded_reason"})
    home = brand_home_category()
    brands = pd.DataFrame(sorted({(b, home.get(b, "OTHER")) for _, b in alias_table()}),
                          columns=["brand_code", "category_code"]).drop_duplicates("brand_code")
    brands.insert(1, "brand_name", brands.brand_code)
    aliases = pd.DataFrame([{"alias": a, "brand_code": canonical_brand(b, rules)}
                            for a, b in zip(read("merchant_aliases").alias_name, read("merchant_aliases").brand_name)]
                           + [{"alias": a, "brand_code": canonical_brand(b, rules)} for a, b in rules["brand_aliases"].items()])
    return {"issuers": issuers, "merchant_categories": categories, "card_catalog": catalog,
            "card_benefits": _benefits_frame(cards), "card_cap_tiers": _cap_tiers_frame(cards),
            "card_total_caps": _total_caps_frame(cards), "card_rewards": _rewards_frame(cards),
            "card_benefits_source": source, "card_perks": read("card_perks"),
            # 프로모션은 SOL 페이 혜택 정보 29건, 전체 기간 (2026-11-18 결정, generate.promotions)
            "brands": brands, "brand_aliases": aliases, "promotions": engine_frame()}


def _benefits_frame(cards: list[Card]) -> pd.DataFrame:
    rows = [{
        "benefit_id": b.benefit_id, "card_id": c.card_id, "category_code": "ALL" if b.category == "*" else b.category,
        "benefit_type": b.type, "rate": b.rate, "amount": b.amount, "per_liter": b.per_liter,
        "min_amount": b.min_amount, "min_prev_perf": b.min_prev, "max_prev_perf": b.max_prev, "max_per_tx": b.max_per_tx,
        "monthly_count": b.monthly_count, "daily_count": b.daily_count,
        "cap_group": b.cap_group, "cap_unit": b.cap_unit, "row_cap": b.row_cap,
        "days": ",".join(DAY_NAMES[d] for d in b.days) if b.days else None,
        "month_days": ",".join(str(d) for d in b.month_days) if b.month_days else None,
        "hour_start": b.hours[0] if b.hours else None, "hour_end": b.hours[1] if b.hours else None,
        "brands": ",".join(sorted(b.brands)) if b.brands else None,
        "plan_day": b.plan_day[0] if b.plan_day else None, "plan_mult": b.plan_day[1] if b.plan_day else None,
        "also_categories": ",".join(sorted(b.also)) if b.also else None,
        "targets": json.dumps(b.targets, ensure_ascii=False) if b.targets is not None else None,
        "basis": b.basis, "pay_type": b.pay, "source_benefit_id": b.source_id,
        "benefit_name": b.name,
    } for c in cards for b in c.benefits]
    df = pd.DataFrame(rows)
    for col in ("amount", "per_liter", "max_per_tx", "monthly_count", "daily_count", "row_cap",
                "hour_start", "hour_end", "plan_day", "max_prev_perf", "source_benefit_id"):
        df[col] = df[col].astype("Int64")
    return df


def _cap_tiers_frame(cards: list[Card]) -> pd.DataFrame:
    units = {(c.card_id, b.cap_group): b.cap_unit for c in cards for b in c.benefits if b.cap_group}
    df = pd.DataFrame([{"card_id": c.card_id, "cap_group": group, "min_prev_perf": lo, "monthly_cap": cap,
                        "cap_unit": units.get((c.card_id, group), "krw")}
                       for c in cards for group, tiers in c.cap_tiers.items() for lo, cap in tiers])
    df["monthly_cap"] = df["monthly_cap"].astype("Int64")   # 비어 있으면 한도 없음
    return df


def _total_caps_frame(cards: list[Card]) -> pd.DataFrame:
    df = pd.DataFrame([{"card_id": c.card_id, "min_prev_perf": lo, "total_limit": cap}
                       for c in cards for lo, cap in c.total_caps], columns=["card_id", "min_prev_perf", "total_limit"])
    df["total_limit"] = df["total_limit"].astype("Int64")
    return df


def _rewards_frame(cards: list[Card]) -> pd.DataFrame:
    return pd.DataFrame([{"card_id": c.card_id, "min_prev_perf": lo, "amount": amount}
                         for c in cards for lo, amount in c.rewards],
                        columns=["card_id", "min_prev_perf", "amount"])
