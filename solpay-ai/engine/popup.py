"""하루 일정 팝업 (설계서 v4.1).

일정을 저장하면 팝업을 하나 띄운다. 마지막 카드 추천에서 3일이 지났으면 아직 없는 신한카드를 추천하고,
그 밖의 날에는 그날 일정 업종에 맞는 프로모션을 추천한다. 프로모션은 카드 배치 점수에 넣지 않는다.

프로모션 추천:
  받을 금액(행사 x, 신한카드 k) = 행사 혜택(x, 일정 금액) + 건당 혜택(k, 일정 업종, x 의 브랜드, 일정 금액, 일정 시각)
  행사마다 받을 금액이 가장 큰 신한카드를 고르고, 받을 금액이 큰 순서로 popup_promotions 건을 보여 준다.
  응모·선착순·가맹점 식별 불가(needs_check) 행사, 이미 끝난 일정은 뺀다. 신한카드가 없으면 추천하지 않는다.
추천한 일정 시간(시작 30분 전 ~ 끝 30분 후)에는 그 신한카드를 1순위로 둔다 (PlacementEngine.rank_state).
"""

import random
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta

from engine.benefit_calc import SOLPAY, CardMonth, evaluate
from engine.domain import Payment, Promotion, ScheduleItem
from engine.params import Params
from engine.recommend import Recommendation, regular_recommendation

HOME_ISSUER = "SHINHAN"


@dataclass(frozen=True)
class PromotionOffer:
    item_id: int
    start: datetime
    end: datetime
    category: str
    amount: int
    promotion_id: int
    brand: str
    title: str
    kind: str                          # event / myshop
    user_card_id: int
    card_id: int
    card_name: str
    promo_value: int
    card_value: int
    alternatives: tuple[tuple[int, int], ...] = ()     # 다른 신한카드 (user_card_id, 받을 금액), 큰 순서
    card_benefit_type: str = ""                        # 카드 건당 혜택 종류 (discount / cashback / point, 없으면 "")
    display_name: str = ""                             # 화면 이름 (2026-11-23, DB promotions.display_name, 없으면 brand)
    logo_url: str | None = None                        # 로고 주소 (백엔드 /brand-logos/)
    # 일정과 맞는 행사가 없어 무작위로 띄운 행사면 False (2026-11-24). 이때 일정 시간이 없어 시간 창은 비우고
    # 행사 자체 혜택(benefit_text: '500원', '10%(최대 2,000원)')과 끝 날짜(until)를 준다
    related: bool = True
    benefit_text: str = ""
    until: date | None = None
    min_amount: int = 0                                # 무작위 행사의 최소 결제 금액 (화면에 '○원 이상 결제 시', 최종 검토)

    @property
    def total(self) -> int:
        return self.promo_value + self.card_value

    def to_dict(self, params: Params) -> dict:
        out = asdict(self)
        out["alternatives"] = [list(a) for a in self.alternatives]
        out["total"] = self.total
        out["start"], out["end"] = self.start.isoformat(), self.end.isoformat()
        out["until"] = self.until.isoformat() if self.until is not None else None
        if not self.related:
            out["window_from"] = out["window_to"] = None
            return out
        out["window_from"] = (self.start - timedelta(minutes=params.schedule_lead_min)).isoformat()
        out["window_to"] = (self.end + timedelta(minutes=params.schedule_tail_min)).isoformat()
        return out


RANDOM_AMOUNT = 10_000                 # 무작위 행사를 받을 수 있는지 볼 결제 금액 (행사 최소 금액이 더 크면 그 금액)


def benefit_text(promo: Promotion) -> str:
    """행사 자체 혜택: 정액 '500원', 비율 '10%(최대 2,000원)'."""
    if promo.amount is not None:
        return f"{promo.amount:,}원"
    text = f"{(promo.rate or 0) * 100:g}%"
    return text + (f"(최대 {promo.max_amount:,}원)" if promo.max_amount is not None else "")


def random_offer(state, promotions: list[Promotion], at: datetime, params: Params,
                 excluded: Callable[[datetime], set[int]] | None = None) -> "PromotionOffer | None":
    """일정과 맞는 행사가 없을 때 띄울 행사 1건 (2026-11-24 사용자 결정). 지금 진행 중이고 확인이 필요 없으며 엔진이 아는
    가맹점에서 내 신한카드(제외 규칙 밖)로 받을 수 있는 행사 중 (사용자, 날짜) 씨앗으로 고른다 → 같은 날 다시 열어도 같은 행사.
    받을 수 있는지는 max(행사 최소 금액, RANDOM_AMOUNT) 결제로 보고, 카드는 그 행사에서 받을 금액(행사 + 카드 혜택)이 가장 큰 신한카드.
    일정이 없으니 item_id 는 0 (결제 화면 팝업에는 쓰지 않는다)."""
    if params.page_random_promotions <= 0:
        return None
    catalog = state.catalog
    blocked = excluded(at) if excluded is not None else set()
    cards = [c for c in state.cards if c.issuer == HOME_ISSUER and not c.excluded and c.user_card_id not in blocked]
    pool = []
    for promo in sorted(promotions, key=lambda p: p.promotion_id):
        if promo.needs_check or not promo.shown(at):
            continue
        amount = max(promo.min_amount, RANDOM_AMOUNT)
        best = None
        for merchant_id in sorted(m for m in promo.merchant_ids if m in catalog.merchants):
            merchant, brand = catalog.merchants[merchant_id], catalog.brand_of(merchant_id)
            for uc in cards:
                promo_value = promo.value(merchant_id, uc.issuer, uc.card_id, amount, at)
                if promo_value <= 0:
                    continue
                card_value, benefit = evaluate(catalog.cards[uc.card_id], merchant.category, amount,
                                               state.ledger.get(uc.user_card_id) or CardMonth(), at, brand, SOLPAY)
                key = (promo_value + card_value, -uc.display_order)
                if best is None or key > best[0]:
                    best = (key, merchant.category, uc, promo_value, card_value,
                            benefit.type if benefit is not None and card_value > 0 else "")
        if best is not None:
            pool.append((promo, amount, best))
    if not pool:
        return None
    promo, amount, (_, category, uc, promo_value, card_value, benefit_type) = \
        random.Random(f"{state.user.user_id}:{at.date().isoformat()}").choice(pool)
    return PromotionOffer(0, at, at, category, amount, promo.promotion_id, promo.brand, promo.title, promo.kind,
                          uc.user_card_id, uc.card_id, catalog.card_label(uc.card_id), promo_value, card_value, (),
                          benefit_type, promo.name, promo.logo_url, related=False, benefit_text=benefit_text(promo),
                          until=(promo.shown_to or promo.ends_at).date(), min_amount=promo.min_amount)


def promotion_offers(state, schedules: list[ScheduleItem], promotions: list[Promotion], at: datetime,
                     params: Params, excluded: Callable[[datetime], set[int]] | None = None) -> list[PromotionOffer]:
    """남은 일정마다 그 업종에 가맹점이 있는 진행 중 행사를 찾아, 행사별로 받을 금액이 가장 큰 신한카드를 고른다.
    받을 금액이 큰 순서로 돌려준다 (자르지 않는다). excluded(일정 시작 시각) → 사용자 제외 규칙에 걸린 카드."""
    catalog = state.catalog
    shinhan = [c for c in state.cards if c.issuer == HOME_ISSUER and not c.excluded]
    if not shinhan:
        return []
    tail = timedelta(minutes=params.schedule_tail_min)
    offers = []
    for item in schedules:
        if item.end + tail < at:
            continue
        blocked = excluded(item.start) if excluded is not None else set()
        cards = [c for c in shinhan if c.user_card_id not in blocked]
        for promo in promotions:
            if promo.needs_check or not promo.shown(item.start):     # 실제 행사 기간 (2026-11-23)
                continue
            merchant = next((m for m in sorted(promo.merchant_ids)
                             if m in catalog.merchants and catalog.merchants[m].category == item.category
                             and (item.brand is None or catalog.merchants[m].brand_code == item.brand)), None)
            if merchant is None:
                continue
            brand = catalog.brand_of(merchant)
            found = []
            for uc in cards:
                promo_value = promo.value(merchant, uc.issuer, uc.card_id, item.amount, item.start)
                if promo_value <= 0:
                    continue
                ledger = state.ledger.get(uc.user_card_id) or CardMonth()
                card_value, benefit = evaluate(catalog.cards[uc.card_id], item.category, item.amount, ledger,
                                               item.start, brand, SOLPAY)
                found.append((promo_value + card_value, uc.display_order, promo_value, card_value, uc,
                              benefit.type if benefit is not None and card_value > 0 else ""))
            if not found:
                continue
            found.sort(key=lambda f: (-f[0], f[1]))
            _, _, promo_value, card_value, uc, benefit_type = found[0]
            offers.append(PromotionOffer(
                item.item_id, item.start, item.end, item.category, item.amount, promo.promotion_id, promo.brand,
                promo.title, promo.kind, uc.user_card_id, uc.card_id, catalog.card_label(uc.card_id),
                promo_value, card_value, tuple((f[4].user_card_id, f[0]) for f in found[1:]), benefit_type,
                promo.name, promo.logo_url))
    return sorted(offers, key=lambda o: (-o.total, o.start, o.promotion_id))


def card_day(history: list[dict], at: datetime, params: Params) -> bool:
    """마지막 카드 추천에서 recommend_interval_days 일이 지났거나 추천한 적이 없으면 카드 추천 날이다."""
    last = max((h["at"] for h in history), default=None)
    return last is None or at - last >= timedelta(days=params.recommend_interval_days)


def schedule_popup(state, payments: list[Payment], schedules: list[ScheduleItem], history: list[dict],
                   promotions: list[Promotion], at: datetime, params: Params,
                   excluded: Callable[[datetime], set[int]] | None = None) -> dict:
    """{"kind": card / promotion / none, "recommendation": Recommendation | None, "offers": [PromotionOffer]}.
    카드 추천 날인데 추천할 카드가 없으면 프로모션 추천으로 넘어간다."""
    if card_day(history, at, params):
        rec: Recommendation | None = regular_recommendation(state, payments, history, at, params)
        if rec is not None:
            return {"kind": "card", "recommendation": rec, "offers": []}
    offers = promotion_offers(state, schedules, promotions, at, params, excluded)[:params.popup_promotions]
    return {"kind": "promotion" if offers else "none", "recommendation": None, "offers": offers}


def offers_by_item(offers: list[PromotionOffer]) -> dict[int, list[tuple[int, int, str]]]:
    """보여 준 행사를 일정별로 묶는다: item_id → [(user_card_id, 받을 금액, 문구용 행사 이름)], 받을 금액이 큰 순서.
    한 일정에 행사가 여럿이면 받을 금액이 가장 큰 행사의 카드가 앞에 온다."""
    out: dict[int, list[tuple[int, int, str]]] = {}
    for o in sorted(offers, key=lambda o: -o.total):
        rows = out.setdefault(o.item_id, [])
        for uc, total in ((o.user_card_id, o.total), *o.alternatives):
            if all(uc != r[0] for r in rows):
                rows.append((uc, total, o.brand))
    return out
