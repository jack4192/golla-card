"""실제 카드 표(config/real_cards/*.csv)를 혜택 계산용 Card 로 바꾼다.

원본 표는 고치지 않고 config/card_rules.yml 의 규칙으로 계산에 넣을 행만 고른다.
브랜드 한정 혜택은 혜택 이름에 적힌 브랜드를 brand_alias 표로 찾아 브랜드 코드로 바꾼다.
"""

import re

import pandas as pd

from .benefit import Benefit, Card
from .common import CONFIG_DIR, load_config

REAL_DIR = CONFIG_DIR / "real_cards"
DAY_CONDITION = {"MONDAY": ("days", (0,)), "WEEKEND": ("days", (5, 6)), "WEEKDAY": ("days", (0, 1, 2, 3, 4))}
TYPE = {"DISCOUNT": "discount", "INSTANT_DISCOUNT": "discount", "PER_LITER_DISCOUNT": "discount",
        "POINT": "point", "CASHBACK": "cashback", "MULTIPLIER": "multiplier"}


def read(name: str) -> pd.DataFrame:
    return pd.read_csv(REAL_DIR / f"{name}.csv")


def normalize(text: str) -> str:
    return re.sub(r"[\s·\-/()+&.,]", "", str(text)).lower()


def alias_table() -> list[tuple[str, str]]:
    """(정규화한 별칭, 브랜드 코드). 긴 별칭부터 맞춘다."""
    alias = read("brand_alias")
    pairs = {(normalize(a), b) for a, b in zip(alias.alias, alias.brand_code)}
    pairs |= {(normalize(n), b) for n, b in zip(read("brand").brand_name, read("brand").brand_code)}
    return sorted((p for p in pairs if len(p[0]) >= 2), key=lambda p: -len(p[0]))


def brands_in(text: str, aliases: list[tuple[str, str]]) -> frozenset[str]:
    """왼쪽부터 가장 긴 별칭을 먼저 소비한다. '이마트24'가 '이마트'로, '쿠팡이츠'가 '쿠팡'으로 잡히지 않게."""
    n, found, i = normalize(text), set(), 0
    while i < len(n):
        hit = next(((a, code) for a, code in aliases if n.startswith(a, i)), None)
        if hit is None:
            i += 1
            continue
        found.add(hit[1])
        i += len(hit[0])
    return frozenset(found)


def brand_of(place_name: str, aliases: list[tuple[str, str]]) -> str | None:
    """가맹점 이름 앞부분의 브랜드 코드. '스타벅스 강남R점' → STARBUCKS."""
    n = normalize(place_name)
    return next((code for a, code in aliases if n.startswith(a)), None)


def _int(v) -> int | None:
    return None if pd.isna(v) else int(v)


def _hour(v) -> int | None:
    return None if pd.isna(v) else int(str(v).split(":")[0])


def _when(day_condition) -> dict:
    if pd.isna(day_condition):
        return {}
    if day_condition in DAY_CONDITION:
        key, value = DAY_CONDITION[day_condition]
        return {key: value}
    if str(day_condition).startswith("DAY_"):
        return {"month_days": (int(day_condition[4:]),)}
    raise ValueError(f"모르는 날짜 조건: {day_condition}")


def benefit_rows() -> pd.DataFrame:
    """계산에 넣는 행과 빼는 행을 이유와 함께 돌려준다 (excluded 가 비어 있으면 넣는 행)."""
    rules = load_config("card_rules")
    rows = read("card_benefit").merge(read("benefit"), on="benefit_id")
    reason = pd.Series("", index=rows.index)
    reason[rows.benefit_type.isin(rules["exclude_types"])] = "환산 불가 유형"
    reason[rows.region.isin(rules["exclude_regions"])] = "해외"
    for row_id, why in rules["exclude_rows"].items():
        reason[rows.card_benefit_id == row_id] = why
    reason[rows.card_benefit_id.isin(rules["reward_rows"])] = "월 리워드"
    reason[rows.card_benefit_id.isin(rules["fold_rows"])] = "추가 적립(다른 행에 합침)"
    reason[rows.benefit_type == "MULTIPLIER"] = "Plan Day 배율(같은 묶음에 붙임)"
    return rows.assign(excluded=reason)


def load_real_cards() -> list[Card]:
    rules = load_config("card_rules")
    aliases = alias_table()
    rows = benefit_rows()
    tiers = read("card_cap_tier")
    cards = []
    for c in read("card").sort_values("card_id").itertuples():
        mine = rows[rows.card_id == c.card_id]
        my_tiers = tiers[tiers.card_id == c.card_id]
        cap_tiers = {g: tuple(sorted((int(t.min_prev_spend), _int(t.monthly_cap)) for t in grp.itertuples()))
                     for g, grp in my_tiers.groupby("cap_group")}
        units = {g: ("usage" if (grp.unit == "USAGE_KRW").all() else "krw") for g, grp in my_tiers.groupby("cap_group")}
        plan_days = {}
        for m in mine[mine.benefit_type == "MULTIPLIER"].itertuples():
            day = _when(m.day_condition).get("month_days", (1,))[0]
            plan_days[m.cap_group] = (day, float(m.rate))
        fold = {}
        for f in mine[mine.card_benefit_id.isin(rules["fold_rows"])].itertuples():
            fold[f.cap_group] = fold.get(f.cap_group, 0.0) + float(f.rate)

        benefits = []
        for r in mine[mine.excluded == ""].itertuples():
            scope = r.brand_scope
            if scope == "BRAND_EXAMPLE" and rules["brand_example_as_category"]:
                scope = "CATEGORY"
            brands = brands_in(r.name, aliases) if scope == "BRAND_ONLY" else None
            if scope == "BRAND_ONLY" and not brands:
                raise ValueError(f"브랜드를 못 찾은 브랜드 한정 혜택: {r.card_benefit_id} {r.name}")
            rate = None if pd.isna(r.rate) else float(r.rate)
            if rate is not None and r.category_code == "ALL" and not pd.isna(r.cap_group):
                rate += fold.get(r.cap_group, 0.0)
            per_liter = _int(r.fixed_amount) if r.benefit_type == "PER_LITER_DISCOUNT" else None
            group = None if pd.isna(r.cap_group) else r.cap_group
            start, end = _hour(r.time_start), _hour(r.time_end)
            benefits.append(Benefit(
                benefit_id=int(r.card_benefit_id),
                category="*" if r.category_code == "ALL" else r.category_code,
                type=TYPE[r.benefit_type],
                rate=rate,
                amount=None if per_liter is not None else _int(r.fixed_amount),
                per_liter=per_liter,
                min_amount=_int(r.min_amount_per_tx) or 0,
                min_prev=_int(r.min_prev_spend) or 0,
                max_per_tx=_int(r.max_per_tx),
                monthly_count=_int(r.monthly_count_cap),
                daily_count=_int(r.daily_count_cap),
                cap_group=group,
                cap_unit=units.get(group, "krw"),
                row_cap=_int(r.monthly_cap),
                hours=(start, end) if start is not None and end is not None else None,
                brands=brands,
                plan_day=plan_days.get(group) if rate is not None else None,
                also=frozenset(rules.get("also_categories", {}).get(int(r.card_benefit_id), [])) or None,
                name=r.name,
                **_when(r.day_condition),
            ))
        rewards = tuple(sorted((int(r.min_prev_spend), int(r.fixed_amount))
                               for r in mine[mine.card_benefit_id.isin(rules["reward_rows"])].itertuples()))
        tags = [t for t in str(c.tags).split(";") if t] + [c.card_type.lower()]
        if c.card_code in rules["kpass_cards"]:
            tags.append("kpass")
        cards.append(Card(
            card_id=int(c.card_id), code=c.card_code, issuer=c.issuer_code, name=c.name,
            card_type=c.card_type.lower(), tags=tuple(tags), annual_fee=int(c.annual_fee),
            cap_tiers=cap_tiers, benefits=tuple(benefits), rewards=rewards,
        ))
    return cards
