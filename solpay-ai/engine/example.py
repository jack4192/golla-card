"""결제 화면 '이 거래의 예상 혜택'에 보일 예시 거래 (2026-11-23 설계: docs/superpowers/specs/2026-11-23-payment-example-design.md).

카드 배치는 거래 하나가 아니라 이 시간대 결제 후보 여러 개를 확률로 섞어 점수를 낸다. 앱이 그와 무관한 고정 예시로
예상 혜택을 보여 주면 'AI 추천' 상자와 다른 카드가 더 유리하다고 나와서, 1순위 카드 문구가 가리키는 거래를 고른다.

- 행사 문구:   그 행사(promotion_label)를 가장 크게 준 업종·가게
- 혜택 문구:   문구를 만든 시나리오 (messages._best_benefit 이 고른 업종·브랜드·금액)
- 그 밖:       가장 가능성 높은 후보 (일정으로 정했으면 basis=schedule)

prob 는 업종 확률 × 그 가게(브랜드) 비중이다. 행사 문구의 '약 N원'은 1순위 카드가 이 시간대 받을 행사 혜택 전체의
기대 금액이라, '상자 금액 × prob'과는 행사가 하나일 때만 같다 (설계서 '만들면서 바뀐 것').
"""

from __future__ import annotations

from datetime import datetime

from engine.catalog import Catalog
from engine.domain import Promotion, ScheduleItem
from engine.messages import AMOUNT_BENEFIT, GENERAL_BENEFIT, PROMOTION, TIME_BENEFIT, _best_benefit
from engine.ranker import Decision
from engine.scenarios import MODE_SCHEDULE, Scenario, ScenarioSet
from engine.state import UserState

BENEFIT_CODES = (TIME_BENEFIT, AMOUNT_BENEFIT, GENERAL_BENEFIT)


def _median(amounts) -> int:
    values = sorted(amounts)
    return int(values[(len(values) - 1) // 2])


def _example(basis: str, catalog: Catalog, category: str, merchant_id: int | None, name: str | None,
             amount: int, prob: float) -> dict:
    return {"basis": basis, "category_code": category, "category_name": catalog.category_name(category),
            "merchant_id": merchant_id, "name": name or catalog.category_name(category),
            "amount": int(amount), "prob": round(min(max(prob, 0.0), 1.0), 3)}


def _brand_name(catalog: Catalog, merchant_id: int | None) -> str | None:
    merchant = catalog.merchants.get(merchant_id) if merchant_id is not None else None
    return merchant.brand if merchant is not None else None


def _promotion_example(state: UserState, decision: Decision, scenarios: ScenarioSet, promotions, at) -> dict | None:
    """1순위 카드의 행사(promotion_label)가 가장 크게 기여한 (시나리오, 가게). ranker.promotion_value 와 같은 방식으로 센다."""
    first = decision.first
    label = decision.scores[first].promotion_label
    card = next((c for c in state.cards if c.user_card_id == first), None)
    # 같은 행사가 목록에 두 번 들어올 수 있어(실제 DB 에서 확인) 행사 번호마다 하나만 쓴다
    tagged = list({p.promotion_id: p for p in promotions if p.label() == label}.values()) if label and card is not None else []
    catalog = state.catalog
    # (시나리오, 행사)마다 그 행사가 걸린 가게(지점·브랜드)들의 기여와 비중을 더한다. 행사 하나가 지점 여러 곳에 걸리면
    # 문구 금액은 지점을 모두 더한 값이라, 지점 하나의 비중만 쓰면 '상자 금액 × 가능성'이 문구보다 작아진다.
    best = (0.0, None, None, None, 0.0)          # (기여, 시나리오, 대표 가게, 행사, 비중 합)
    for s in scenarios.scenarios:
        if s.merchants:
            places = [(m, share, p) for m, share in s.merchants.items() for p in tagged if m in p.merchant_ids]
        else:
            brands = s.promo_brands if s.promo_brands is not None else s.brands
            places = [(catalog.promo_merchants(p.merchant_ids).get((s.category, b)), share, p)
                      for b, share in brands.items() for p in tagged]
        groups: dict[int, list] = {}             # 행사 번호 → [기여, 비중 합, 대표 가게, 대표 비중, 행사]
        for merchant_id, share, promotion in places:
            if merchant_id is None:
                continue
            got = sum(promotion.value(merchant_id, card.issuer, card.card_id, a, at) for a in s.amounts) / len(s.amounts)
            if got <= 0:
                continue
            g = groups.setdefault(promotion.promotion_id, [0.0, 0.0, merchant_id, share, promotion])
            g[0] += s.prob * share * got
            g[1] += share
            if share > g[3]:
                g[2], g[3] = merchant_id, share
        for contrib, total_share, merchant_id, _, promotion in groups.values():
            if contrib > best[0]:
                best = (contrib, s, merchant_id, promotion, total_share)
    _, s, merchant_id, promotion, share = best
    if s is None:
        return None
    return _example("promotion", catalog, s.category, merchant_id, promotion.brand, _median(s.amounts), s.prob * share)


def _benefit_example(state: UserState, decision: Decision, scenarios: ScenarioSet, at) -> dict | None:
    first = decision.first
    card_id = next((c.card_id for c in state.cards if c.user_card_id == first), None)
    if card_id is None:
        return None
    benefit, s, brand, amount = _best_benefit(state, first, card_id, scenarios.scenarios, at)
    if benefit is None:
        return None
    catalog = state.catalog
    merchant_id = catalog.merchant_for(s.category, brand)
    return _example("benefit", catalog, s.category, merchant_id, _brand_name(catalog, merchant_id), amount,
                    s.prob * s.brands.get(brand, 1.0))


def _likely_example(catalog: Catalog, scenarios: ScenarioSet) -> dict | None:
    """가장 가능성 높은 후보와 그 업종에서 가장 흔한 브랜드. 브랜드 없음(None, 나머지 가게를 묶은 몫)과 비중이 같으면
    브랜드 없음을 고른다 (특정 브랜드가 더 흔하다고 말할 근거가 없다)."""
    if not scenarios.scenarios:
        return None
    s: Scenario = max(scenarios.scenarios, key=lambda x: x.prob)
    brands = s.promo_brands if s.promo_brands is not None else s.brands
    top, share = max(brands.items(), key=lambda kv: (kv[1], kv[0] is None)) if brands else (None, 1.0)
    merchant_id = catalog.merchant_for(s.category, top)
    basis = "schedule" if scenarios.mode == MODE_SCHEDULE else "likely"
    if merchant_id is None:
        return _example(basis, catalog, s.category, None, None, _median(s.amounts), s.prob)
    return _example(basis, catalog, s.category, merchant_id, _brand_name(catalog, merchant_id) or top,
                    _median(s.amounts), s.prob * share)


def rank_example(state: UserState, decision: Decision, scenarios: ScenarioSet, code: str,
                 promotions: list[Promotion], at: datetime) -> dict | None:
    """1순위 카드 문구(code)가 가리키는 예시 거래. 후보가 하나도 없으면 None."""
    found = None
    if code == PROMOTION:
        found = _promotion_example(state, decision, scenarios, list(promotions), at)
    elif code in BENEFIT_CODES:
        found = _benefit_example(state, decision, scenarios, at)
    return found or _likely_example(state.catalog, scenarios)


def _brand_merchant(catalog: Catalog, category: str, brand_name: str | None) -> int | None:
    """그 업종에서 행사 브랜드 이름(Promotion.brand)에 맞는 가맹점 중 번호가 가장 작은 것. 행사 가맹점을 고를 때와 같은
    기준(Merchant.is_brand: 브랜드명이 같거나 가맹점 이름이 브랜드명으로 시작)으로 찾는다."""
    if not brand_name:
        return None
    found = [m.merchant_id for m in catalog.merchants.values() if m.category == category and m.is_brand(brand_name)]
    return min(found) if found else None


def schedule_example(catalog: Catalog, item: ScheduleItem, name: str | None = None) -> dict:
    """일정 프로모션 카드 화면: 지금 일정의 업종·브랜드·금액. 백엔드 일정에는 브랜드 코드가 없으므로(앱 일정은 업종만)
    그때는 추천한 행사 브랜드 이름(name)으로 가게를 찾는다. 가게 번호가 없으면 가정 계산에 행사가 빠져 문구와 어긋난다."""
    merchant_id = catalog.merchant_for(item.category, item.brand) or _brand_merchant(catalog, item.category, name)
    return _example("schedule", catalog, item.category, merchant_id, name or _brand_name(catalog, merchant_id),
                    item.amount, 1.0)
