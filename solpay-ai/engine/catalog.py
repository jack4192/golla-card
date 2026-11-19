"""카드와 가맹점 기준 정보. 테이블 형식을 benefit_calc 의 Card 로 바꾼다."""

import json
from dataclasses import dataclass

from engine.benefit_calc import DAYS, Benefit, Card
from engine.domain import Merchant


def parse_days(value: str | None) -> tuple[int, ...] | None:
    if not value:
        return None
    return tuple(DAYS[d.strip()] for d in value.split(","))


def _ints(value: str | None) -> tuple[int, ...] | None:
    return tuple(int(x) for x in value.split(",")) if value else None


def _opt_int(value) -> int | None:
    return None if value is None else int(value)


def _targets(value) -> tuple[tuple[str, str | None], ...] | None:
    if not value:
        return None
    return tuple((c, b) for c, b in json.loads(value))


def build_card(row: dict, benefit_rows: list[dict], tier_rows: list[dict], reward_rows: list[dict] = (),
               total_rows: list[dict] = ()) -> Card:
    """card_catalog, card_benefits, card_cap_tiers, card_rewards, card_total_caps 행으로 Card 를 만든다.
    비어 있는 값은 None 이어야 한다."""
    tiers: dict[str, list[tuple[int, int | None]]] = {}
    for t in tier_rows:
        tiers.setdefault(t["cap_group"], []).append((int(t["min_prev_perf"]), _opt_int(t["monthly_cap"])))
    benefits = []
    for b in sorted(benefit_rows, key=lambda x: x["benefit_id"]):
        start, end = b.get("hour_start"), b.get("hour_end")
        plan_day = b.get("plan_day")
        benefits.append(Benefit(
            benefit_id=int(b["benefit_id"]),
            category="*" if b["category_code"] == "ALL" else b["category_code"],
            type=b["benefit_type"],
            rate=None if b.get("rate") is None else float(b["rate"]),
            amount=_opt_int(b.get("amount")),
            per_liter=_opt_int(b.get("per_liter")),
            min_amount=int(b.get("min_amount") or 0),
            min_prev=int(b.get("min_prev_perf") or 0),
            max_per_tx=_opt_int(b.get("max_per_tx")),
            monthly_count=_opt_int(b.get("monthly_count")),
            daily_count=_opt_int(b.get("daily_count")),
            cap_group=b.get("cap_group"),
            cap_unit=b.get("cap_unit") or "krw",
            row_cap=_opt_int(b.get("row_cap")),
            days=parse_days(b.get("days")),
            month_days=_ints(b.get("month_days")),
            hours=(int(start), int(end)) if start is not None and end is not None else None,
            brands=frozenset(b["brands"].split(",")) if b.get("brands") else None,
            plan_day=(int(plan_day), float(b["plan_mult"])) if plan_day is not None else None,
            also=frozenset(b["also_categories"].split(",")) if b.get("also_categories") else None,
            name=b.get("benefit_name") or "",
            targets=_targets(b.get("targets")),
            max_prev=_opt_int(b.get("max_prev_perf")),
            basis=b.get("basis") or "benefit",
            pay=b.get("pay_type"),
            source_id=_opt_int(b.get("source_benefit_id")),
        ))
    return Card(
        card_id=int(row["card_id"]), code=row["card_code"], issuer=row["issuer_code"], name=row["card_name"],
        card_type=row["card_type"], tags=tuple((row.get("tags") or "").split(",")), annual_fee=int(row["annual_fee"]),
        cap_tiers={g: tuple(sorted(v, key=lambda x: x[0])) for g, v in tiers.items()},
        benefits=tuple(benefits),
        rewards=tuple(sorted((int(r["min_prev_perf"]), int(r["amount"])) for r in reward_rows)),
        total_caps=tuple(sorted((int(t["min_prev_perf"]), _opt_int(t["total_limit"])) for t in total_rows)),
    )


@dataclass
class Catalog:
    cards: dict[int, Card]
    merchants: dict[int, Merchant]
    category_names: dict[str, str]

    def __post_init__(self):
        self.tiers: dict[int, tuple[int, ...]] = {card_id: card.perf_tiers() for card_id, card in self.cards.items()}
        self._promo_merchants: dict[frozenset, dict[tuple[str, str | None], int]] = {}

    def promo_merchants(self, merchant_ids: frozenset) -> dict[tuple[str, str | None], int]:
        """행사 가맹점을 (업종, 브랜드 코드) 마다 대표 가맹점 하나로 묶는다. 가게를 모를 때 브랜드 비중으로 행사를 셀 때 쓴다.
        행사 금액은 가맹점이 행사 대상인지만 보므로 같은 업종·브랜드면 어느 가맹점이든 같다."""
        found = self._promo_merchants.get(merchant_ids)
        if found is None:
            found = {}
            for merchant_id in sorted(merchant_ids):
                merchant = self.merchants.get(merchant_id)
                if merchant is not None:
                    found.setdefault((merchant.category, merchant.brand_code), merchant_id)
            self._promo_merchants[merchant_ids] = found
        return found

    def first_tier(self, card_id: int) -> int | None:
        tiers = self.tiers[card_id]
        return tiers[0] if tiers else None

    def top_tier(self, card_id: int) -> int | None:
        tiers = self.tiers[card_id]
        return tiers[-1] if tiers else None

    def brand_of(self, merchant_id: int | None) -> str | None:
        merchant = self.merchants.get(merchant_id) if merchant_id is not None else None
        return merchant.brand_code if merchant is not None else None

    def category_name(self, code: str) -> str:
        return self.category_names.get(code, code)

    def card_label(self, card_id: int) -> str:
        return self.cards[card_id].name.replace("(가칭)", "").strip()

