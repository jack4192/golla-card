"""맞춤 추천 페이지: 카드사 추천 탭·가맹점 추천 탭 (설계서 2026-11-19-recommendation-page-design.md).

일정을 저장하거나 건너뛰면 뜨는 페이지다. 무엇을 보여 줄지는 엔진이 정하고, 문구는 engine.chat.page_copy 가 쓴다.

표시 규칙 (2026-11-19 사용자 결정):
  카드날     : 카드 탭 + 가맹점 탭 (있는 것만, 카드 먼저)
  카드날 아님: 가맹점 탭. 프로모션이 없으면 카드 탭
  카드날 = 오늘 이전의 마지막 카드 추천에서 3일 이상 지났거나 기록이 없다.
           오늘 기록과 프로모션이 없어 대신 보여 준 카드(page_fallback) 기록은 세지 않는다.

오늘 볼 항목: 아직 끝나지 않은 오늘 일정. 없으면 최근 30일 현장 결제가 많은 3업종(평소 소비)을 그 업종의
중앙값 금액·평소 시각으로 만든다 (item_id 는 -1, -2, -3).
"""

import math
from collections import Counter, defaultdict
from dataclasses import dataclass
from collections.abc import Callable
from datetime import datetime, timedelta
from statistics import median

from engine.benefit_calc import SOLPAY, Card, CardMonth, evaluate
from engine.catalog import Catalog
from engine.domain import Payment, ScheduleItem
from engine.params import Params
from engine.popup import PromotionOffer, promotion_offers
from engine.recommend import candidates, monthly_gain

CYCLE = "page_cycle"            # 카드날에 보여 준 카드
FALLBACK = "page_fallback"      # 프로모션이 없어 대신 보여 준 카드 (3일 주기에 세지 않는다)
PATTERN_DAYS = 30
PATTERN_TOP = 3
FIRST_MONTH_NOTE = "발급 첫 달은 전월 실적이 없어 이 혜택이 적거나 없을 수 있어요"


def _recent(payments: list[Payment], at: datetime) -> list[Payment]:
    since = at - timedelta(days=PATTERN_DAYS)
    return [p for p in payments if since <= p.paid_at < at]


def usual_brand(payments: list[Payment], catalog: Catalog, category: str, at: datetime) -> str | None:
    """최근 30일 그 업종 결제에서 가장 많이 간 브랜드 코드 (같으면 이름 순). 없으면 None."""
    seen = Counter(b for p in _recent(payments, at) if p.category == category
                   and (b := catalog.brand_of(p.merchant_id)) is not None)
    if not seen:
        return None
    return min(seen.items(), key=lambda kv: (-kv[1], kv[0]))[0]


def _round100(value: float) -> int:
    return max(100, int(math.floor(value / 100 + 0.5)) * 100)


def pattern_items(payments: list[Payment], catalog: Catalog, at: datetime, user_id: int) -> list[ScheduleItem]:
    """평소 소비 항목: 최근 30일 현장 결제 건수 상위 3업종. 금액은 중앙값(100원 단위), 시각은 결제 시각 중앙값의
    정시부터 1시간 (이미 지났으면 지금부터)."""
    amounts: dict[str, list[int]] = defaultdict(list)
    hours: dict[str, list[int]] = defaultdict(list)
    for p in _recent(payments, at):
        if p.is_placement:
            amounts[p.category].append(p.amount)
            hours[p.category].append(p.paid_at.hour)
    top = sorted(amounts, key=lambda c: (-len(amounts[c]), c))[:PATTERN_TOP]
    now = at.replace(second=0, microsecond=0)
    items = []
    for i, category in enumerate(top):
        start = at.replace(hour=int(median(hours[category])), minute=0, second=0, microsecond=0)
        start = max(start, now)
        items.append(ScheduleItem(-(i + 1), user_id, start, start + timedelta(hours=1), category,
                                  _round100(median(amounts[category]))))
    return items


def today_items(schedules: list[ScheduleItem], payments: list[Payment], catalog: Catalog, at: datetime,
                params: Params, user_id: int) -> tuple[str, list[ScheduleItem]]:
    """("schedule", 아직 끝나지 않은 일정) 또는 ("pattern", 평소 소비 항목)."""
    tail = timedelta(minutes=params.schedule_tail_min)
    remaining = [s for s in schedules if s.end + tail >= at]
    if remaining:
        return "schedule", remaining
    return "pattern", pattern_items(payments, catalog, at, user_id)


def _day(record: dict, at: datetime):
    return record["at"].astimezone(at.tzinfo).date()


def is_card_day(history: list[dict], at: datetime, params: Params) -> bool:
    """오늘 이전의 마지막 카드 추천(대신 보여 준 카드 제외)에서 recommend_interval_days 일이 지났거나 기록이 없으면 카드날."""
    today = at.date()
    days = [d for h in history if h.get("trigger") != FALLBACK and (d := _day(h, at)) < today]
    return not days or (today - max(days)).days >= params.recommend_interval_days


def recently_recommended(history: list[dict], at: datetime, params: Params) -> set[int]:
    """오늘 이전 recommend_same_card_days 일 안에 추천한 카드 (오늘 기록은 다시 계산할 때 같은 카드를 고를 수 있게 뺀다)."""
    today = at.date()
    return {h["card_id"] for h in history if 0 < (today - _day(h, at)).days < params.recommend_same_card_days}


# ---------- 카드 고르기 ----------
@dataclass(frozen=True)
class CardPickItem:
    """후보 카드가 보유 카드보다 더 주는 오늘 항목 하나."""
    item_id: int
    start: datetime
    end: datetime
    category: str
    amount: int
    brand: str | None           # 계산에 쓴 브랜드 코드
    benefit: str                # 적용된 혜택 이름
    benefit_type: str           # discount / cashback / point
    min_prev: int               # 그 혜택의 전월 실적 조건
    value: int                  # 후보 카드 혜택 (첫 실적 구간을 채웠다고 볼 때)
    owned_value: int            # 보유 카드 중 가장 큰 혜택 (이번 달 실제 장부)

    @property
    def gain(self) -> int:
        return self.value - self.owned_value


@dataclass(frozen=True)
class CardPick:
    card_id: int
    card_name: str
    annual_fee: int
    items: tuple[CardPickItem, ...]
    monthly_gain: int           # 지난 30일 결제로 본 월 이득 (연회비 반영, 참고값)
    first_month_note: str | None

    @property
    def gain(self) -> int:
        return sum(i.gain for i in self.items)


def _covered_brands(card: Card, category: str) -> list[str]:
    """카드가 그 업종에서 혜택을 주는 브랜드 코드."""
    out: set[str] = set()
    for b in card.benefits:
        if b.targets is not None:
            out |= {brand for c, brand in b.targets if c == category and brand}
        elif b.brands and (b.category == category or (b.also is not None and category in b.also)):
            out |= set(b.brands)
    return sorted(out)


def _item_gain(state, card: Card, item: ScheduleItem, brands: list[str | None], owned) -> CardPickItem | None:
    """브랜드마다 (후보 혜택 − 보유 최고 혜택)을 계산해 가장 큰 것. 더 주는 게 없으면 None."""
    catalog = state.catalog
    prev = catalog.first_tier(card.card_id) or 0
    best = None
    for brand in brands:
        value, b = evaluate(card, item.category, item.amount, CardMonth(prev_perf=prev), item.start, brand, SOLPAY)
        have = max((evaluate(c, item.category, item.amount, state.ledger.get(uc.user_card_id) or CardMonth(),
                             item.start, brand, SOLPAY)[0] for uc, c in owned), default=0)
        if value - have <= 0 or (best is not None and value - have <= best.gain):
            continue
        name = (b.name if b is not None and b.name else "") or f"{catalog.category_name(item.category)} 혜택"
        best = CardPickItem(item.item_id, item.start, item.end, item.category, item.amount, brand, name,
                            b.type if b is not None else "", b.min_prev if b is not None else 0, value, have)
    return best


def pick_card(state, payments: list[Payment], items: list[ScheduleItem], history: list[dict], at: datetime,
              params: Params) -> CardPick | None:
    """아직 없는 신한카드 중 오늘 항목에서 보유 카드보다 더 주는 금액 합이 가장 큰 카드 (0원이면 추천하지 않는다).
    같으면 연회비가 낮은 카드, 그다음 card_id. 30일 안에 추천한 카드(오늘 기록 제외)와 자격 제한 카드는 뺀다."""
    catalog = state.catalog
    blocked = recently_recommended(history, at, params)
    owned = [(uc, catalog.cards[uc.card_id]) for uc in state.cards if not uc.excluded]
    usual = {i.category: usual_brand(payments, catalog, i.category, at) for i in items}
    found = []
    for card in candidates(state):
        if card.card_id in blocked:
            continue
        rows = []
        for item in items:
            brands = [usual[item.category]] if usual[item.category] else (_covered_brands(card, item.category) or [None])
            row = _item_gain(state, card, item, brands, owned)
            if row is not None:
                rows.append(row)
        if rows:
            found.append((sum(r.gain for r in rows), card, tuple(rows)))
    if not found:
        return None
    _, card, rows = min(found, key=lambda f: (-f[0], f[1].annual_fee, f[1].card_id))
    rows60 = [p for p in payments if at - timedelta(days=60) <= p.paid_at < at]
    monthly = monthly_gain(state, rows60, card, at, params.switch_threshold)[0]
    top = max(rows, key=lambda r: r.gain)
    first = evaluate(card, top.category, top.amount, CardMonth(prev_perf=0), top.start, top.brand, SOLPAY)[0]
    return CardPick(card.card_id, catalog.card_label(card.card_id), card.annual_fee, rows, monthly,
                    FIRST_MONTH_NOTE if first < top.value else None)


# ---------- 페이지 ----------
@dataclass(frozen=True)
class Page:
    source: str                         # schedule: 오늘 일정 / pattern: 평소 소비
    card_day: bool
    card: CardPick | None
    offers: tuple[PromotionOffer, ...]
    trigger: str | None                 # 카드를 보여 주면 CYCLE / FALLBACK

    @property
    def tabs(self) -> list[str]:
        return (["card"] if self.card is not None else []) + (["merchant"] if self.offers else [])

    def to_dict(self, catalog: Catalog, params: Params) -> dict:
        names = catalog.category_name
        card = None
        if self.card is not None:
            c = self.card
            card = {"card_id": c.card_id, "card_name": c.card_name, "annual_fee": c.annual_fee, "gain": c.gain,
                    "show_amount": c.gain >= params.page_amount_min,     # 작으면 화면에 금액 대신 혜택 이름
                    "monthly_gain": c.monthly_gain, "first_month_note": c.first_month_note,
                    "items": [{"item_id": i.item_id, "start": i.start.isoformat(), "end": i.end.isoformat(),
                               "category": i.category, "category_name": names(i.category), "amount": i.amount,
                               "brand": i.brand, "benefit": i.benefit, "benefit_type": i.benefit_type,
                               "min_prev": i.min_prev, "value": i.value,
                               "owned_value": i.owned_value, "gain": i.gain} for i in c.items]}
        merchant = None
        if self.offers:
            merchant = {"offers": [{**o.to_dict(params), "category_name": names(o.category)} for o in self.offers]}
        return {"source": self.source, "card_day": self.card_day, "tabs": self.tabs, "card": card, "merchant": merchant}


def _unique(offers: list[PromotionOffer]) -> list[PromotionOffer]:
    """팀 DB 행사와 promotions.yml 이 같은 행사를 두 번 가질 수 있다. (일정, 브랜드, 행사 이름)마다 받을 금액이 가장 큰 것만."""
    seen, out = set(), []
    for o in offers:                    # promotion_offers 는 받을 금액이 큰 순서
        key = (o.item_id, o.brand, o.title)
        if key not in seen:
            seen.add(key)
            out.append(o)
    return out


def build_page(state, payments: list[Payment], schedules: list[ScheduleItem], history: list[dict],
               promotions: list, at: datetime, params: Params,
               excluded: Callable[[datetime], set[int]] | None = None) -> Page:
    """표시 규칙대로 카드·행사를 고른다. excluded(시각) → 사용자 제외 규칙에 걸린 보유 카드 (행사 카드에서 뺀다)."""
    source, items = today_items(schedules, payments, state.catalog, at, params, state.user.user_id)
    card_day = is_card_day(history, at, params)
    offers = _unique(promotion_offers(state, items, promotions, at, params, excluded))[:params.popup_promotions]
    card = pick_card(state, payments, items, history, at, params) if card_day or not offers else None
    trigger = None if card is None else (CYCLE if card_day else FALLBACK)
    return Page(source, card_day, card, tuple(offers), trigger)


def merge_promotions(team: list, popup: list) -> list:
    """팀 DB 행사 + promotions.yml 행사. 두 목록은 같은 원본(data/generate/promotions.py)에서 같은 번호로 만들어지는데,
    응모·신규 조건처럼 엔진이 확인할 수 없는 행사는 yml 쪽에만 '확인 필요'(needs_check) 표시가 있다.
    yml 에서 확인 필요인 번호는 팀 DB 사본도 뺀다 (받을 수 없는 혜택을 보여 주지 않게)."""
    blocked = {p.promotion_id for p in popup if p.needs_check}
    return [p for p in team if p.promotion_id not in blocked] + list(popup)
