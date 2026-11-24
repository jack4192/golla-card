"""맞춤 추천 페이지: 카드사 추천 탭·가맹점 추천 탭 (설계서 2026-11-19-recommendation-page-design.md).

일정을 저장하거나 건너뛰면 뜨는 페이지다. 무엇을 보여 줄지는 엔진이 정하고, 문구는 engine.chat.page_copy 가 쓴다.

카드 고르기 (2026-11-21 사용자 결정): 오늘 항목에서 보유 카드보다 더 주는 카드 중, 지난 1년 소비로 따져 연회비를 빼고도
이득인 카드만 남긴다. 그중 오늘 일정 업종·브랜드를 콕 집은 혜택(음식점 10% 할인 등)이 있는 카드를 먼저 보고, 1년 순이득이 가장 큰 카드.
화면의 큰 글씨는 오늘 일정에서 받는 혜택 키워드('음식점 10% 할인')이고, 1년 순이득(연말정산 놓친 혜택과 같은 숫자)은 그 아래 한 줄이다.

표시 규칙 (2026-11-19 사용자 결정):
  카드날     : 카드 탭 + 가맹점 탭 (있는 것만, 카드 먼저)
  카드날 아님: 가맹점 탭. 프로모션이 없으면 카드 탭
  카드날 = 오늘 이전의 마지막 카드 추천에서 3일 이상 지났거나 기록이 없다.
           오늘 기록과 프로모션이 없어 대신 보여 준 카드(page_fallback) 기록은 세지 않는다.

오늘 볼 항목: 아직 끝나지 않은 오늘 일정. 없으면 최근 30일 현장 결제가 많은 3업종(평소 소비)을 그 업종의
중앙값 금액·평소 시각으로 만든다 (item_id 는 -1, -2, -3).
"""

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from collections.abc import Callable
from datetime import datetime, timedelta
from statistics import median

from engine.benefit_calc import SOLPAY, Card, CardMonth, evaluate
from engine.catalog import Catalog
from engine.domain import Payment, ScheduleItem
from engine.messages import KIND
from engine.params import Params
from engine.popup import PromotionOffer, promotion_offers, random_offer
from engine.recommend import candidates, missed_benefit

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
    keyword: str = ""           # 화면에 보여 줄 혜택 키워드: '음식점 10% 할인', '스타벅스 10% 할인', '모든 가맹점 1.5% 할인'
    specific: bool = False      # 이 업종·브랜드를 콕 집은 혜택인지 (모든 가맹점 혜택이면 False)
    at_least: bool = False      # 일정 금액이 혜택의 최소 결제 금액보다 작아 amount 를 최소 금액으로 올려 계산했는지 (2026-11-24)

    @property
    def gain(self) -> int:
        return self.value - self.owned_value


@dataclass(frozen=True)
class CardPick:
    card_id: int
    card_name: str
    annual_fee: int
    items: tuple[CardPickItem, ...]
    first_month_note: str | None
    # 지난 1년 결제에 이 카드가 있었다면 더 받았을 금액 (연회비 뺌, 연말정산 놓친 혜택과 같은 계산). 화면의 큰 금액.
    # 결제 이력이 두 달 미만이라 계산할 수 없으면(또는 Params.page_yearly=False) 모두 None
    yearly_gain: int | None = None
    yearly_months: int | None = None    # 계산한 개월 수 (첫 달은 실적만 쌓아 보통 11~12)
    yearly_basis: str | None = None     # add: 함께 썼다면 / swap: 가진 카드 하나 대신 썼다면
    replaces: str | None = None         # swap 일 때 대신 쓴 것으로 본 보유 카드 이름
    related: bool = False               # 관련 업종 카드 단계에서 골랐는지 (보유 카드보다 더 주는지 보지 않음, 2026-11-24)

    @property
    def gain(self) -> int:
        return sum(i.gain for i in self.items)

    @property
    def keywords(self) -> list[str]:
        """오늘 항목별 혜택 키워드 (대표 항목 먼저, 같은 말은 한 번)."""
        return list(dict.fromkeys(i.keyword for i in self.items if i.keyword))


def short_category(name: str) -> str:
    """업종 이름의 짧은 표기: '카페/커피전문점' → '카페', '대중교통(버스/지하철)' → '대중교통'."""
    return re.split(r"[/(]", name)[0].strip()


def benefit_keyword(b, category: str, brand: str | None, catalog: Catalog) -> tuple[str, bool]:
    """(혜택 키워드, 이 업종·브랜드를 콕 집은 혜택인지). '음식점 10% 할인' 처럼 어디서 + 얼마 + 혜택 종류.
    브랜드 한정 혜택이면 브랜드, 업종 혜택이면 업종(짧은 표기), 국내 전 가맹점 혜택이면 '모든 가맹점'."""
    short = short_category(catalog.category_name(category))
    if b.targets is not None:
        where = short if any(c == category and target is None for c, target in b.targets) else (brand or short)
    elif b.brands is not None:
        where = brand or short
    else:
        where = "모든 가맹점" if b.category == "*" else short
    if b.per_liter is not None:
        what = f"ℓ당 {b.per_liter:,}원"
    elif b.amount is not None:
        what = f"{b.amount:,}원"
    else:
        what = f"{(b.rate or 0) * 100:g}%"
    specific = b.targets is not None or b.brands is not None or b.category != "*"
    return f"{where} {what} {KIND.get(b.type, '혜택')}", specific


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
        keyword, specific = benefit_keyword(b, item.category, brand, catalog) if b is not None else (name, False)
        best = CardPickItem(item.item_id, item.start, item.end, item.category, item.amount, brand, name,
                            b.type if b is not None else "", b.min_prev if b is not None else 0, value, have,
                            keyword, specific)
    return best


def _related(b, category: str, brand: str | None) -> bool:
    """이 혜택이 그 업종(brand 가 있으면 그 브랜드)을 콕 집은 혜택인지. 전 업종(*) 혜택은 아니다."""
    if b.targets is not None:
        return any(c == category and (target is None or brand is None or target == brand) for c, target in b.targets)
    if b.category == "*" or (b.category != category and not (b.also is not None and category in b.also)):
        return False
    return b.brands is None or brand is None or brand in b.brands


def _related_row(state, card: Card, item: ScheduleItem, usual: str | None, owned) -> CardPickItem | None:
    """관련 업종 카드 단계 (2026-11-24 사용자 결정): 그 업종(직접 넣은 브랜드가 있으면 그 브랜드) 전용 혜택으로 받는 금액.
    보유 카드보다 더 주는지는 보지 않는다 (owned_value 는 같은 금액·브랜드의 보유 최고 혜택, 화면 참고용).
    브랜드: 직접 넣은 브랜드 → 평소 브랜드(카드가 그 브랜드에 혜택을 주거나 업종 전체 혜택일 때) → 카드가 혜택을 주는 브랜드.
    금액: 일정 금액에서 전용 혜택을 받으면 그 금액, 못 받으면(최소 결제 조건) 가장 작은 최소 결제 금액부터 올려 본다 (at_least).
    돌려받은 혜택이 전용 혜택이고 0원보다 클 때만 쓴다 (시간·요일 조건으로 일반 혜택이 잡히면 관련 카드가 아니다)."""
    related = [b for b in card.benefits if _related(b, item.category, item.brand)]
    if not related:
        return None
    catalog = state.catalog
    if item.brand is not None:
        brands = [item.brand]
    else:
        covered = _covered_brands(card, item.category)
        brands = [usual] if usual is not None and (usual in covered or not covered) else (covered or [None])
    amounts = [item.amount] + sorted({b.min_amount for b in related if b.min_amount > item.amount})
    prev = catalog.first_tier(card.card_id) or 0
    best = None
    for brand in brands:
        for amount in amounts:
            value, b = evaluate(card, item.category, amount, CardMonth(prev_perf=prev), item.start, brand, SOLPAY)
            if b is None or value <= 0 or not _related(b, item.category, brand):
                continue
            have = max((evaluate(c, item.category, amount, state.ledger.get(uc.user_card_id) or CardMonth(),
                                 item.start, brand, SOLPAY)[0] for uc, c in owned), default=0)
            if best is None or (value - have, value) > (best.gain, best.value):
                keyword, _ = benefit_keyword(b, item.category, brand, catalog)
                best = CardPickItem(item.item_id, item.start, item.end, item.category, amount, brand,
                                    b.name or f"{catalog.category_name(item.category)} 혜택", b.type, b.min_prev,
                                    value, have, keyword, True, amount > item.amount)
            break                                   # 이 브랜드에서 받는 가장 작은 금액을 찾았다
    return best


def _compare_brands(card: Card, item: ScheduleItem, usual: str | None, owned_cards: list[Card], params: Params) -> list:
    """오늘 보유 카드보다 더 주는지 비교할 브랜드: 직접 넣은 브랜드 → 평소 브랜드 → 카드가 혜택을 주는 브랜드.
    브랜드를 모르면 보유 카드가 혜택을 주는 브랜드도 함께 본다 (page_related_first, 2026-11-24: 보유 카드의 브랜드 혜택을
    0원으로 보고 일반 카드를 추천하지 않게). 아무 브랜드도 없으면 [None]."""
    if item.brand is not None:
        return [item.brand]
    if usual:
        return [usual]
    brands = set(_covered_brands(card, item.category))
    if params.page_related_first:
        for c in owned_cards:
            brands |= set(_covered_brands(c, item.category))
    return sorted(brands) or [None]


def yearly_gains(state, payments: list[Payment], card_ids: set[int], at: datetime, params: Params) -> dict[int, dict] | None:
    """card_id → 연말정산 놓친 혜택과 같은 계산 결과 (gain 은 연회비를 뺀 1년 순이득).
    지난 page_history_days 일 결제가 두 달에 못 미치면 계산할 수 없어 None."""
    since = at - timedelta(days=params.page_history_days)
    rows = [p for p in payments if since <= p.paid_at < at]
    if len({(p.paid_at.year, p.paid_at.month) for p in rows}) < 2:
        return None
    return {m["card_id"]: m for m in missed_benefit(state, rows, params.switch_threshold, only=card_ids)}


def pick_card(state, payments: list[Payment], items: list[ScheduleItem], history: list[dict], at: datetime,
              params: Params) -> CardPick | None:
    """아직 없는 신한카드 중 오늘 항목에서 보유 카드보다 더 주는 카드(0원이면 후보가 아니다)를 모으고,
    그중 지난 1년 소비로 따져 연회비를 빼고도 이득인 카드만 남긴다 (남는 카드가 없으면 추천하지 않는다).
    남은 카드 가운데 오늘 일정 업종·브랜드를 콕 집은 혜택이 있는 카드를 먼저 보고(page_schedule_first, 없으면 나머지에서),
    1년 순이득이 가장 큰 카드를 고른다. 같으면 오늘 더 받는 금액이 큰 카드, 그다음 card_id (2026-11-21 사용자 결정).
    결제 이력이 두 달 미만이거나 page_yearly=False 면 1년 계산 없이: 오늘 더 받는 금액 큰 순 → 연회비 낮은 순 → card_id.
    항목은 대표 항목이 맨 앞에 오게 둔다: 일정 업종 혜택 먼저, 그다음 더 받는 금액이 큰 순.
    자격 제한 카드는 뺀다. 3일 카드날 규칙(page_card_every_time=False)일 때만 2주(recommend_same_card_days) 안에
    추천한 카드(오늘 기록 제외)도 뺀다 — 매번 카드 탭이면 같은 카드를 다시 보여 준다 (2026-11-24 사용자 결정)."""
    catalog = state.catalog
    blocked = set() if params.page_card_every_time else recently_recommended(history, at, params)
    owned = [(uc, catalog.cards[uc.card_id]) for uc in state.cards if not uc.excluded]
    owned_cards = [c for _, c in owned]
    usual = {i.category: usual_brand(payments, catalog, i.category, at) for i in items}
    pool = [card for card in candidates(state) if card.card_id not in blocked]

    def gain_rows(card: Card, skip: set[int] = frozenset()) -> list[CardPickItem]:
        """오늘 보유 카드보다 더 주는 항목들 (skip 의 항목은 뺀다)."""
        return [row for item in items if item.item_id not in skip
                and (row := _item_gain(state, card, item, _compare_brands(card, item, usual[item.category], owned_cards, params),
                                       owned)) is not None]

    if params.page_related_first and params.page_schedule_first:
        # 1단계: 관련 업종 카드 (2026-11-24 사용자 결정). 함께 받는 혜택으로 나머지 항목에서 더 주는 것도 붙인다
        related = []
        for card in pool:
            rows = [r for item in items if (r := _related_row(state, card, item, usual[item.category], owned)) is not None]
            if rows:
                rows += gain_rows(card, {r.item_id for r in rows})
                related.append(_ranked(card, rows))
        picked = _choose(state, payments, related, at, params, related=True)
        if picked is not None:
            return picked
    # 2단계(관련 카드가 없거나 모두 1년 손해일 때): 오늘 보유 카드보다 더 주는 카드
    found = [_ranked(card, rows) for card in pool if (rows := gain_rows(card))]
    return _choose(state, payments, found, at, params, related=False)


def _ranked(card: Card, rows: list[CardPickItem]) -> tuple[int, Card, tuple[CardPickItem, ...]]:
    rows = sorted(rows, key=lambda r: (not r.specific, -r.gain, r.start))      # 대표 항목이 맨 앞
    return sum(r.gain for r in rows), card, tuple(rows)


def _choose(state, payments: list[Payment], found: list, at: datetime, params: Params, related: bool) -> CardPick | None:
    """1년 순이득이 page_min_yearly 보다 큰 카드만 남기고 (이력이 두 달 미만이면 계산 없이) 고른다."""
    if not found:
        return None
    catalog = state.catalog
    yearly = yearly_gains(state, payments, {card.card_id for _, card, _ in found}, at, params) if params.page_yearly else None
    if yearly is not None:
        found = [f for f in found if yearly[f[1].card_id]["gain"] > params.page_min_yearly]
        if not found:
            return None
    if params.page_schedule_first:                    # 오늘 일정 업종 혜택이 있는 카드 먼저. 없으면 나머지에서 고른다
        found = [f for f in found if any(r.specific for r in f[2])] or found
    if yearly is None:
        _, card, rows = min(found, key=lambda f: (-f[0], f[1].annual_fee, f[1].card_id))
        year = {}
    else:
        _, card, rows = min(found, key=lambda f: (-yearly[f[1].card_id]["gain"], -f[0], f[1].card_id))
        year = yearly[card.card_id]
    top = rows[0]
    first = evaluate(card, top.category, top.amount, CardMonth(prev_perf=0), top.start, top.brand, SOLPAY)[0]
    return CardPick(card.card_id, catalog.card_label(card.card_id), card.annual_fee, rows,
                    FIRST_MONTH_NOTE if first < top.value else None,
                    year.get("gain"), year.get("months"), year.get("basis"), year.get("replaces"), related)


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
            card = {"card_id": c.card_id, "card_name": c.card_name, "annual_fee": c.annual_fee,
                    # 화면의 큰 글씨: 대표 항목(items[0])에서 받는 혜택. keywords 는 오늘 항목별 키워드 (대표 먼저)
                    "keyword": c.items[0].keyword, "keywords": c.keywords,
                    "gain": c.gain, "related": c.related,
                    # 오늘 혜택 금액(원)을 문구에 쓰는지. 작으면 키워드만. 관련 업종 카드는 그 카드가 주는 금액으로 본다 (2026-11-24)
                    "show_amount": (c.items[0].value if c.related else c.gain) >= params.page_amount_min,
                    # 큰 글씨 아래 한 줄: 지난 1년 소비라면 더 받았을 금액 (연회비 뺌). 이력이 짧으면 None
                    "yearly_gain": c.yearly_gain, "yearly_months": c.yearly_months,
                    "yearly_basis": c.yearly_basis, "replaces": c.replaces, "first_month_note": c.first_month_note,
                    "items": [{"item_id": i.item_id, "start": i.start.isoformat(), "end": i.end.isoformat(),
                               "category": i.category, "category_name": names(i.category), "amount": i.amount,
                               "brand": i.brand, "benefit": i.benefit, "benefit_type": i.benefit_type,
                               "keyword": i.keyword, "specific": i.specific, "at_least": i.at_least,
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
    card_day = params.page_card_every_time or is_card_day(history, at, params)   # 2026-11-24: 기본은 매번 카드 탭
    offers = _unique(promotion_offers(state, items, promotions, at, params, excluded))[:params.popup_promotions]
    card = pick_card(state, payments, items, history, at, params) if card_day or not offers else None
    trigger = None if card is None else (CYCLE if card_day else FALLBACK)
    if not offers:                  # 일정과 맞는 행사가 없으면 받을 수 있는 행사 1건을 무작위로 (카드를 정한 뒤, 2026-11-24)
        extra = random_offer(state, promotions, at, params, excluded)
        offers = [extra] if extra is not None else []
    return Page(source, card_day, card, tuple(offers), trigger)


def merge_promotions(team: list, popup: list) -> list:
    """팀 DB 행사 + promotions.yml 행사. 두 목록은 같은 원본(data/generate/promotions.py)에서 같은 번호로 만들어지는데,
    응모·신규 조건처럼 엔진이 확인할 수 없는 행사는 yml 쪽에만 '확인 필요'(needs_check) 표시가 있다.
    yml 에서 확인 필요인 번호는 팀 DB 사본도 뺀다 (받을 수 없는 혜택을 보여 주지 않게)."""
    blocked = {p.promotion_id for p in popup if p.needs_check}
    return [p for p in team if p.promotion_id not in blocked] + list(popup)
