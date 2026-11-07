"""카드와 가맹점 기준 정보. 테이블 형식을 benefit_calc 의 Card 로 바꾼다."""

import json
import math
from dataclasses import dataclass

from engine.benefit_calc import DAYS, Benefit, Card
from engine.domain import Merchant


def parse_days(value: str | None) -> tuple[int, ...] | None:
    if not value:
        return None
    return tuple(DAYS[d.strip()] for d in value.split(","))


def _rate_by_tier(value: str | None) -> tuple[tuple[int, float], ...] | None:
    if not value:
        return None
    return tuple(sorted((t["min"], t["rate"]) for t in json.loads(value)))


def build_card(row: dict, benefit_rows: list[dict], tier_rows: list[dict]) -> Card:
    """card_catalog, card_benefits, card_cap_tiers 행으로 Card 를 만든다. 비어 있는 값은 None 이어야 한다."""
    tiers: dict[str, list[tuple[int, int | None]]] = {}
    for t in tier_rows:
        tiers.setdefault(t["cap_group"], []).append((t["min_prev_perf"], t["monthly_cap"]))
    benefits = []
    for b in sorted(benefit_rows, key=lambda x: x["benefit_id"]):
        start, end = b.get("hour_start"), b.get("hour_end")
        benefits.append(Benefit(
            benefit_id=b["benefit_id"],
            category="*" if b["category_code"] == "ALL" else b["category_code"],
            type=b["benefit_type"],
            rate=b.get("rate"),
            rate_by_tier=_rate_by_tier(b.get("rate_by_tier")),
            amount=b.get("amount"),
            min_amount=b.get("min_amount") or 0,
            monthly_count=b.get("monthly_count"),
            cap_group=b["cap_group"],
            days=parse_days(b.get("days")),
            hours=(start, end) if start is not None and end is not None else None,
        ))
    return Card(
        card_id=row["card_id"], code=row["card_code"], issuer=row["issuer_code"], name=row["card_name"],
        card_type=row["card_type"], tags=tuple((row.get("tags") or "").split(",")), annual_fee=row["annual_fee"],
        cap_tiers={g: tuple(sorted(v, key=lambda x: x[0])) for g, v in tiers.items()},
        benefits=tuple(benefits),
    )


@dataclass
class Catalog:
    cards: dict[int, Card]
    merchants: dict[int, Merchant]
    category_names: dict[str, str]

    def __post_init__(self):
        self.tiers: dict[int, tuple[int, ...]] = {}
        for card_id, card in self.cards.items():
            lows = {lo for group in card.cap_tiers.values() for lo, _ in group if lo > 0}
            self.tiers[card_id] = tuple(sorted(lows))
        self._located = [m for m in self.merchants.values()
                         if not m.is_online and m.lat is not None and m.lng is not None]

    def first_tier(self, card_id: int) -> int | None:
        tiers = self.tiers[card_id]
        return tiers[0] if tiers else None

    def top_tier(self, card_id: int) -> int | None:
        tiers = self.tiers[card_id]
        return tiers[-1] if tiers else None

    def category_name(self, code: str) -> str:
        return self.category_names.get(code, code)

    def card_label(self, card_id: int) -> str:
        return self.cards[card_id].name.replace("(가칭)", "").strip()

    def nearby(self, lat: float, lng: float, radius_m: float) -> list[tuple[Merchant, float]]:
        scale = 111_000 * math.cos(math.radians(lat))
        found = []
        for m in self._located:
            dist = math.hypot((m.lat - lat) * 111_000, (m.lng - lng) * scale)
            if dist <= radius_m:
                found.append((m, dist))
        return found
