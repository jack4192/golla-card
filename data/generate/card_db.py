"""최종 카드 DB(config/card_db/*.csv)를 혜택 계산용 Card 로 바꾼다 (2026-11-15).

원본 표는 고치지 않고 config/card_db_map.yml 의 규칙(카드 코드, 해외 대상 제외, 브랜드 표기)만 더한다.

- 혜택 × 구간(benefit_tiers) 한 줄이 계산용 Benefit 한 행이다. 그 구간의 전월 실적 범위 [하한, 다음 구간 하한)에서만 쓴다.
- 대상(benefit_targets)은 (업종, 브랜드) 목록으로 옮긴다. 대상이 없는 혜택은 국내 전 업종이다.
- 혜택 그룹 한도(benefit_group_tiers)는 묶음 한도, 카드 통합 한도(card_tiers.total_limit)는 카드 한도가 된다.
- 브랜드는 새 DB의 정규화된 브랜드명(merchant_name)을 그대로 브랜드 코드로 쓴다.
"""

import re
from collections import Counter

import pandas as pd

from .benefit import DAYS, Benefit, Card
from .common import CONFIG_DIR, load_config

DB_DIR = CONFIG_DIR / "card_db"
KIND = {"DISCOUNT": "discount", "POINT": "point", "CASHBACK": "cashback"}


def read(name: str) -> pd.DataFrame:
    return pd.read_csv(DB_DIR / f"{name}.csv", encoding="utf-8-sig")


def normalize(text: str) -> str:
    return re.sub(r"[\s·\-/()+&.,_]", "", str(text)).lower()


def _int(v) -> int | None:
    return None if pd.isna(v) else int(v)


def canonical_brand(name: str, rules: dict | None = None) -> str:
    rules = rules or load_config("card_db_map")
    return rules.get("brand_canonical", {}).get(name, name)


def brand_names() -> set[str]:
    """새 DB에 나오는 모든 브랜드 (혜택 대상, 가맹점 표, 프로모션)."""
    rules = load_config("card_db_map")
    names = set(read("benefit_targets").merchant_name.dropna()) | set(read("merchants").merchant_name)
    names |= set(read("promotions").merchant_name.dropna()) | set(read("merchant_aliases").brand_name)
    return {canonical_brand(n, rules) for n in names}


def alias_table() -> list[tuple[str, str]]:
    """(정규화한 표기, 브랜드). 긴 표기부터 맞춘다.
    표기마다 브랜드 하나로 정한다: 브랜드 이름 → 원본 별칭 표 → card_db_map 별칭 순서로 덮어쓰고, 두 브랜드가 겹치는 표기는
    card_db_map alias_resolve 로 고정한다 (2026-11-18: 집합 순서가 실행마다 달라 가맹점 브랜드가 바뀌던 문제)."""
    rules = load_config("card_db_map")
    pairs = {normalize(n): n for n in sorted(brand_names())}
    alias = read("merchant_aliases")
    pairs.update({normalize(a): canonical_brand(b, rules) for a, b in zip(alias.alias_name, alias.brand_name)})
    pairs.update({normalize(a): canonical_brand(b, rules) for a, b in rules.get("brand_aliases", {}).items()})
    pairs.update({normalize(a): b for a, b in rules.get("alias_resolve", {}).items()})
    return sorted(((a, b) for a, b in pairs.items() if len(a) >= 2), key=lambda p: (-len(p[0]), p[0]))


def brand_of(place_name: str, aliases: list[tuple[str, str]]) -> str | None:
    """가맹점 이름 앞부분의 브랜드. '스타벅스 강남R점' → 스타벅스."""
    n = normalize(place_name)
    return next((brand for a, brand in aliases if n.startswith(a)), None)


def brand_categories() -> dict[str, set[str]]:
    """브랜드 → 새 DB에서 그 브랜드가 속한 업종들 (가맹점 표와 혜택 대상)."""
    rules = load_config("card_db_map")
    out: dict[str, set[str]] = {}
    for df in (read("merchants"), read("benefit_targets").dropna(subset=["merchant_name"])):
        for name, cat in zip(df.merchant_name, df.category):
            out.setdefault(canonical_brand(name, rules), set()).add(cat)
    return out


def brand_home_category() -> dict[str, str]:
    """브랜드의 대표 업종: 새 DB 가맹점 표의 업종, 없으면 혜택 대상에서 가장 많이 나온 업종."""
    rules = load_config("card_db_map")
    home = {canonical_brand(n, rules): c for n, c in zip(read("merchants").merchant_name, read("merchants").category)}
    counts: dict[str, Counter] = {}
    t = read("benefit_targets").dropna(subset=["merchant_name"])
    for name, cat in zip(t.merchant_name, t.category):
        counts.setdefault(canonical_brand(name, rules), Counter())[cat] += 1
    for brand, c in counts.items():
        home.setdefault(brand, c.most_common(1)[0][0])
    return home


def _days(v) -> tuple[int, ...] | None:
    if pd.isna(v):
        return None
    return tuple(DAYS[d.strip().lower()] for d in str(v).split(","))


def _hour(v) -> int | None:
    return None if pd.isna(v) else int(str(v).split(":")[0])


def benefit_rows() -> pd.DataFrame:
    """원본 혜택 전체와 계산에서 뺀 이유 (excluded 가 비어 있으면 계산에 넣는다)."""
    rules = load_config("card_db_map")
    b, t = read("benefits"), read("benefit_targets")
    skip = set(rules["exclude_target_categories"])
    has_target = set(t.benefit_id)
    domestic = set(t[~t.category.isin(skip)].benefit_id)
    reason = pd.Series("", index=b.index)
    reason[b.benefit_id.isin(has_target) & ~b.benefit_id.isin(domestic)] = "해외"
    return b.assign(excluded=reason)


def load_cards() -> list[Card]:
    rules = load_config("card_db_map")
    skip = set(rules["exclude_target_categories"])
    cards_df, tiers = read("cards"), read("card_tiers")
    groups, group_tiers = read("benefit_groups"), read("benefit_group_tiers")
    targets, btiers = read("benefit_targets"), read("benefit_tiers")
    rows = benefit_rows()
    tier_min = dict(zip(tiers.tier_id, tiers.min_amount))
    issuer_code = {k: v["code"] for k, v in rules["issuers"].items()}

    cards = []
    for c in cards_df.sort_values("card_id").itertuples():
        my_tiers = tiers[tiers.card_id == c.card_id].sort_values("tier_no")
        lows = sorted(set(my_tiers.min_amount))
        next_low = {lo: (lows[i + 1] if i + 1 < len(lows) else None) for i, lo in enumerate(lows)}
        total_caps = tuple((int(t.min_amount), _int(t.total_limit)) for t in my_tiers.itertuples())
        if all(cap is None for _, cap in total_caps):
            total_caps = ()
        cap_tiers = {}
        for g in groups[groups.card_id == c.card_id].itertuples():
            gt = group_tiers[group_tiers.group_id == g.group_id]
            cap_tiers[f"G{g.group_id}"] = tuple(sorted((int(tier_min[t.tier_id]), int(t.monthly_limit)) for t in gt.itertuples()))

        benefits = []
        for r in rows[(rows.card_id == c.card_id) & (rows.excluded == "")].itertuples():
            mine = targets[(targets.benefit_id == r.benefit_id) & ~targets.category.isin(skip)]
            tgt = tuple(sorted({(t.category, None if pd.isna(t.merchant_name) else canonical_brand(t.merchant_name, rules))
                                for t in mine.itertuples()}, key=lambda x: (x[0], x[1] or "")))
            brands = frozenset(b for _, b in tgt if b is not None) or None
            start, end = _hour(r.time_from), _hour(r.time_to)
            for bt in btiers[btiers.benefit_id == r.benefit_id].itertuples():
                low = int(tier_min[bt.tier_id])
                value = float(bt.value)
                benefits.append(Benefit(
                    benefit_id=int(bt.benefit_tier_id),
                    category=tgt[0][0] if tgt else "*",
                    type=KIND[r.benefit_kind],
                    rate=value / 100 if r.value_type == "RATE" else None,
                    amount=int(value) if r.value_type == "FIXED" else None,
                    per_liter=int(value) if r.value_type == "PER_LITER" else None,
                    min_amount=_int(r.min_pay_amount) or 0,
                    min_prev=low,
                    max_per_tx=_int(bt.per_payment_limit),
                    monthly_count=_int(bt.monthly_count),
                    daily_count=_int(r.daily_count),
                    cap_group=None if pd.isna(r.group_id) else f"G{int(r.group_id)}",
                    row_cap=_int(bt.monthly_limit),
                    days=_days(r.days),
                    hours=(start, end) if start is not None and end is not None else None,
                    brands=brands,
                    name=r.benefit_name,
                    targets=tgt or None,
                    max_prev=next_low.get(low),
                    basis="usage" if r.limit_basis == "USAGE" else "benefit",
                    pay=None if pd.isna(r.pay_type) else r.pay_type,
                    source_id=int(r.benefit_id),
                ))
        code = rules["card_codes"][int(c.card_id)]
        tags = [c.card_type.lower()] + (["kpass"] if code in rules["kpass_cards"] else [])
        cards.append(Card(
            card_id=int(c.card_id), code=code, issuer=issuer_code[c.issuer], name=c.card_name,
            card_type=c.card_type.lower(), tags=tuple(tags), annual_fee=int(c.annual_fee_domestic),
            cap_tiers=cap_tiers, benefits=tuple(benefits), total_caps=total_caps,
        ))
    return cards
