"""카드 혜택 계산.

생성기(받은 혜택, 사후 최적 카드)와 배치 엔진(예상 혜택)이 같은 규칙을 쓰도록 계산은 이 파일 하나에만 둔다.
나중에 solpay-ai/engine/benefit_calc.py 로 옮기거나 그쪽에서 import 한다.

규칙
- 혜택 구간과 월 한도는 전월 실적(prev_perf)으로 정한다.
- 한 결제에는 혜택 하나만 붙고, 붙을 수 있는 것 중 금액이 가장 큰 것을 고른다.
- 비율 혜택은 10원 미만을 버린다.
- 한도를 함께 쓰는 혜택은 cap_group 단위로 남은 한도 안에서만 준다.
"""

import math
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Benefit:
    benefit_id: int
    category: str                                   # "*" 는 전 업종
    type: str                                       # discount / cashback / point
    rate: float | None
    rate_by_tier: tuple[tuple[int, float], ...] | None
    amount: int | None
    min_amount: int
    monthly_count: int | None
    cap_group: str


@dataclass(frozen=True)
class Card:
    card_id: int
    code: str
    issuer: str
    name: str
    card_type: str
    tags: tuple[str, ...]
    annual_fee: int
    cap_tiers: dict[str, tuple[tuple[int, int | None], ...]]   # cap_group → ((실적 하한, 한도), ...) 하한 오름차순
    benefits: tuple[Benefit, ...]

    def benefits_for(self, category: str) -> list[Benefit]:
        return [b for b in self.benefits if b.category in (category, "*")]

    def advertises(self, category: str) -> bool:
        """그 업종을 콕 집은 혜택이 있는지. 사람이 '이 카드 카페 할인되지'라고 아는 수준."""
        return any(b.category == category for b in self.benefits)


@dataclass
class CardMonth:
    """카드 한 장의 이번 달 상태."""
    prev_perf: int = 0
    perf: int = 0
    discount: int = 0
    txn: int = 0
    cap_used: dict[str, int] = field(default_factory=dict)
    count_used: dict[int, int] = field(default_factory=dict)

    def roll(self) -> "CardMonth":
        return CardMonth(prev_perf=self.perf)


def cap_for(card: Card, cap_group: str, prev_perf: int) -> tuple[bool, int | None]:
    """(혜택 대상인지, 이번 달 한도). 한도 None 은 무제한."""
    ok = [cap for lo, cap in card.cap_tiers[cap_group] if prev_perf >= lo]
    if not ok:
        return False, 0
    return True, ok[-1]


def rate_of(b: Benefit, prev_perf: int) -> float:
    if b.rate_by_tier:
        ok = [r for lo, r in b.rate_by_tier if prev_perf >= lo]
        return ok[-1] if ok else 0.0
    return b.rate or 0.0


def evaluate(card: Card, category: str, amount: int, st: CardMonth) -> tuple[int, Benefit | None]:
    """이 카드로 지금 결제하면 받을 혜택(원)과 적용될 혜택. 상태는 바꾸지 않는다."""
    best_amt, best_b = 0, None
    for b in card.benefits_for(category):
        if amount < b.min_amount:
            continue
        if b.monthly_count is not None and st.count_used.get(b.benefit_id, 0) >= b.monthly_count:
            continue
        eligible, cap = cap_for(card, b.cap_group, st.prev_perf)
        if not eligible:
            continue
        if b.amount is not None:
            raw = min(b.amount, amount)
        else:
            raw = math.floor(amount * rate_of(b, st.prev_perf) / 10) * 10
        if cap is not None:
            raw = min(raw, cap - st.cap_used.get(b.cap_group, 0))
        if raw > best_amt:
            best_amt, best_b = raw, b
    return best_amt, best_b


def apply(st: CardMonth, amount: int, got: int, b: Benefit | None, counts_for_perf: bool = True) -> None:
    st.txn += 1
    if counts_for_perf:
        st.perf += amount
    if b is not None and got > 0:
        st.cap_used[b.cap_group] = st.cap_used.get(b.cap_group, 0) + got
        st.discount += got
        if b.monthly_count is not None:
            st.count_used[b.benefit_id] = st.count_used.get(b.benefit_id, 0) + 1


def load_cards(cfg: dict) -> list[Card]:
    """cards.yml → Card 목록. card_id, benefit_id 는 파일 순서대로 1부터."""
    cards, bid = [], 0
    for i, c in enumerate(cfg["cards"], start=1):
        tiers = {
            g: tuple(sorted((t["min"], t["cap"]) for t in spec["tiers"]))
            for g, spec in c.get("cap_groups", {}).items()
        }
        benefits = []
        for b in c.get("benefits", []):
            bid += 1
            rbt = b.get("rate_by_tier")
            benefits.append(Benefit(
                benefit_id=bid,
                category=b["category"],
                type=b["type"],
                rate=b.get("rate"),
                rate_by_tier=tuple(sorted((t["min"], t["rate"]) for t in rbt)) if rbt else None,
                amount=b.get("amount"),
                min_amount=b.get("min_amount", 0),
                monthly_count=b.get("monthly_count"),
                cap_group=b["cap_group"],
            ))
        cards.append(Card(
            card_id=i, code=c["code"], issuer=c["issuer"], name=c["name"],
            card_type=c["card_type"], tags=tuple(c["tags"]), annual_fee=c["annual_fee"],
            cap_tiers=tiers, benefits=tuple(benefits),
        ))
    return cards
