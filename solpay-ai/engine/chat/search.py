"""카드 이름·가맹점 이름·업종 이름 검색. LLM 은 이름으로 말하고, 서버가 ID 로 바꾼다.

이름이 여러 개에 맞으면 후보를 모두 돌려주어 LLM 이 되묻게 한다.
"""

import re
from dataclasses import dataclass

from engine.catalog import Catalog
from engine.domain import UserCard

_DROP = ("신한카드", "카드", "card", "체크", "신용")
ISSUER_WORDS = {"신한": "SHINHAN", "국민": "KB", "kb": "KB", "kb국민": "KB", "하나": "HANA", "bc": "BC", "비씨": "BC",
                "농협": "NH", "nh": "NH", "nh농협": "NH", "롯데": "LOTTE"}


def norm(text: str) -> str:
    """공백·기호를 뺀 소문자. '+' 는 카드 이름을 가르므로 남긴다 (Discount Plan / Discount Plan+)."""
    return re.sub(r"[\s·\-/()&.,_'\"]", "", str(text)).lower()


def _core(text: str) -> str:
    n = norm(text)
    for w in _DROP:
        n = n.replace(w, "")
    return n


def _score(query: str, name: str) -> int:
    """4: 같음, 3: 핵심어가 같음, 2: 핵심어가 서로 포함, 1: 원문이 포함. 0: 안 맞음."""
    q, n = norm(query), norm(name)
    if not q:
        return 0
    if q == n:
        return 4
    qc, nc = _core(query), _core(name)
    if qc and qc == nc:
        return 3
    if qc and nc and ((len(qc) >= 2 and qc in nc) or (len(nc) >= 2 and nc in qc)):
        return 2
    if len(q) >= 2 and q in n:
        return 1
    return 0


@dataclass(frozen=True)
class CardHit:
    card_id: int
    name: str
    issuer: str
    user_card_id: int | None = None      # 내 카드면 보유 카드 ID


def find_cards(query: str, catalog: Catalog, owned: list[UserCard], owned_only: bool = False) -> list[CardHit]:
    """가장 잘 맞는 점수의 카드만 돌려준다. 내 카드가 맞으면 내 카드만 (같은 점수일 때)."""
    mine = {c.card_id: c.user_card_id for c in owned}
    issuer = ISSUER_WORDS.get(norm(query))
    pool = [cid for cid in catalog.cards if not owned_only or cid in mine]
    if issuer:                                      # "KB 카드" 처럼 카드사만 말한 경우
        hits = [cid for cid in pool if catalog.cards[cid].issuer == issuer]
        if owned_only or any(cid in mine for cid in hits):
            hits = [cid for cid in hits if cid in mine] or hits
        return [CardHit(cid, catalog.card_label(cid), catalog.cards[cid].issuer, mine.get(cid)) for cid in hits]
    scored = [(max(_score(query, catalog.card_label(cid)), _score(query, catalog.cards[cid].name)), cid) for cid in pool]
    best = max((s for s, _ in scored), default=0)
    if best == 0:
        return []
    hits = [cid for s, cid in scored if s == best]
    if any(cid in mine for cid in hits):
        hits = [cid for cid in hits if cid in mine]
    return [CardHit(cid, catalog.card_label(cid), catalog.cards[cid].issuer, mine.get(cid)) for cid in sorted(hits)]


@dataclass(frozen=True)
class MerchantHit:
    merchant_id: int
    name: str
    brand: str | None
    category: str
    category_name: str


def find_merchants(query: str, catalog: Catalog, limit: int = 5) -> list[MerchantHit]:
    """정확히 일치 → 브랜드 일치 → 부분 일치. 같은 브랜드·업종은 대표 가맹점 하나로 묶는다.
    별칭(팀 DB merchant_aliases 등, catalog.aliases)이 맞으면 그 브랜드로 찾는다 ('메가커피' → 메가MGC커피)."""
    q = norm(query)
    if not q:
        return []
    q = norm(getattr(catalog, "aliases", {}).get(q, q))
    tiers: dict[int, dict[tuple, int]] = {0: {}, 1: {}, 2: {}}
    for m in sorted(catalog.merchants.values(), key=lambda m: m.merchant_id):
        name, brand = norm(m.name), norm(m.brand_code or "")
        if q == name:
            level = 0
        elif brand and (q == brand or q == norm(m.brand or "")):
            level = 1
        elif len(q) >= 2 and (q in name or (brand and (q in brand or brand in q))):
            level = 2
        else:
            continue
        key = (m.brand_code or m.name, m.category)
        tiers[level].setdefault(key, m.merchant_id)
    for level in (0, 1, 2):
        if tiers[level]:
            ids = list(tiers[level].values())[:limit]
            return [MerchantHit(i, catalog.merchants[i].brand_code or catalog.merchants[i].name,
                                catalog.merchants[i].brand_code, catalog.merchants[i].category,
                                catalog.category_name(catalog.merchants[i].category)) for i in ids]
    return []


def find_categories(query: str, catalog: Catalog, limit: int = 5) -> list[tuple[str, str]]:
    """업종 이름으로 업종 코드 찾기. '카페' → (CAFE, 카페)."""
    q = norm(query)
    if not q:
        return []
    exact = [(c, n) for c, n in catalog.category_names.items() if norm(n) == q or c.lower() == q]
    if exact:
        return exact[:limit]
    return [(c, n) for c, n in catalog.category_names.items()
            if c != "ALL" and (q in norm(n) or (len(norm(n)) >= 2 and norm(n) in q))][:limit]
