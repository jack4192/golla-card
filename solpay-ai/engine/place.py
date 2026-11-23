"""일정 '직접 입력'의 짧은 말을 업종·가맹점(브랜드)으로 바꾸는 규칙 분류 (2026-11-23 설계서).

가맹점 이름·브랜드·별칭이 딱 맞으면 그 브랜드, 업종 이름이면 업종만, 여러 곳에 걸리면 후보만 준다.
확신 없이 틀린 브랜드를 붙이지 않는다. 검색 규칙은 engine/chat/search.py 를 그대로 쓴다.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from statistics import median

from engine.catalog import Catalog
from engine.chat.search import find_categories, find_merchants, norm
from engine.domain import Payment
from engine.priors import Priors
from engine.privacy import redact

MAX_CHARS = 40
HINT_DAYS = 90
MAX_CANDIDATES = 5
RESEMBLE_MIN = 0.5      # OpenAI 가 고른 브랜드를 받는 글자 닮음 정도 ('스타벅쓰'·'맥날'은 통과, '커피 한 잔'→스타벅스는 버림)


@dataclass
class PlaceMatch:
    category: str | None = None
    brand: str | None = None            # 브랜드 코드 (혜택 계산용)
    brand_name: str | None = None
    candidates: list[dict] = field(default_factory=list)
    exact: bool = False


def clean_text(text: str) -> str:
    """앞뒤 공백을 빼고 카드번호·전화번호 등을 가린 뒤 40자로 자른다."""
    return redact(str(text or "").strip())[:MAX_CHARS]


def _candidate(catalog: Catalog, category: str, brand: str | None, brand_name: str | None) -> dict:
    return {"category": category, "category_name": catalog.category_name(category),
            "brand": brand, "brand_name": brand_name}


def match_place(text: str, catalog: Catalog) -> PlaceMatch:
    q = clean_text(text)
    if not q:
        return PlaceMatch()
    target = norm(getattr(catalog, "aliases", {}).get(norm(q), q))
    hits = find_merchants(q, catalog, limit=10)
    named = {}
    for h in hits:
        brand = h.brand
        # 이름·브랜드가 같거나, 입력이 브랜드 이름을 품을 때만 그 가맹점이라고 본다 ('스타벅스 강남' → 스타벅스)
        if norm(h.name) == target or (brand and (norm(brand) == target or norm(brand) in target)):
            named[(brand, h.category)] = h
    if len(named) == 1:
        (brand, category), h = next(iter(named.items()))
        merchant = catalog.merchants[h.merchant_id]
        return PlaceMatch(category, brand, merchant.brand or brand, exact=True)

    # 업종은 업종 이름(또는 코드)과 글자가 같을 때만 확정한다. '동물병원'→병원, '집'→어린이집 같은 부분 일치는
    # 확정하지 않고 OpenAI 나 후보로 넘긴다 (2026-11-23 평가에서 찾은 문제)
    categories = find_categories(q, catalog)
    exact = [code for code, name in categories if norm(name) == norm(q) or code.lower() == norm(q)]
    if len(exact) == 1:
        return PlaceMatch(category=exact[0])

    cands: dict = {}
    for h in hits:
        cands.setdefault((h.brand, h.category),
                         _candidate(catalog, h.category, h.brand, catalog.merchants[h.merchant_id].brand or h.brand))
    if len(norm(q)) >= 2:                       # 한 글자('집')로 걸린 업종은 후보로도 보여 주지 않는다
        for code, _ in categories:
            cands.setdefault((None, code), _candidate(catalog, code, None, None))
    return PlaceMatch(candidates=list(cands.values())[:MAX_CANDIDATES])


def resembles(text: str, *names: str | None) -> bool:
    """글과 브랜드 이름이 글자로 닮았는지 (오타·줄임말은 받고, 글에 없는 브랜드를 지어 붙인 것은 버린다)."""
    t = norm(text)
    return any(n and SequenceMatcher(None, t, norm(n)).ratio() >= RESEMBLE_MIN for n in names)


def amount_hint(payments: list[Payment], catalog: Catalog, category: str, brand: str | None,
                at: datetime, priors: Priors) -> int:
    """최근 90일 현장 결제 중 그 브랜드 중앙값 → 없으면 그 업종 중앙값 → 없으면 전체 사용자 중앙값. 100원 단위."""
    since = at - timedelta(days=HINT_DAYS)
    recent = [p for p in payments if p.is_placement and since <= p.paid_at < at and p.category == category]
    by_brand = [p.amount for p in recent if brand and catalog.brand_of(p.merchant_id) == brand]
    pool = by_brand or [p.amount for p in recent]
    value = median(pool) if pool else priors.amount_median(category)
    return int(round(value, -2))
