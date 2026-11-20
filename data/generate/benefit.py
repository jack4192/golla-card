"""카드 혜택 계산.

생성기(받은 혜택, 사후 최적 카드)와 배치 엔진(예상 혜택)이 같은 규칙을 쓰도록 계산은 이 파일 하나에만 둔다.
solpay-ai/engine/benefit_calc.py 는 이 파일과 글자 하나까지 같아야 한다 (tests/test_real_data.py).

규칙 (최종 카드 DB config/card_db 기준, 2026-11-15)
- 혜택 행마다 전월 실적 구간 [min_prev, max_prev)이 있다. 원본의 혜택×구간 한 줄이 계산용 한 행이 되고,
  한 달에는 전월 실적으로 정해진 구간 하나만 쓰므로 횟수·한도가 구간 사이에 섞이지 않는다.
  한도 묶음(cap_group)의 구간 표가 있으면 그 구간도 넘어야 한다.
- 대상(targets)은 (업종, 브랜드) 목록이다. 브랜드가 비어 있으면 그 업종 전체, 대상이 없으면 국내 전 업종.
- 한도 기준(basis)이 usage 이면 건당·영역 한도가 혜택액이 아니라 이용금액 한도다.
- 카드 월 통합 한도(total_caps)는 그 카드의 모든 혜택 합계에 걸린다.
- 결제수단 조건(pay): PAY=간편결제만, NOPAY=간편결제 제외, SOLPAY 등=그 페이만. SOL페이 현장 결제는 SOLPAY.
- 한 결제에는 혜택 하나만 붙고, 붙을 수 있는 것 중 금액이 가장 큰 것을 고른다 (카드사 '중복 불가' 기본값).
- 비율 혜택은 10원 미만을 버린다. 건당 한도(max_per_tx)·행 월 한도(row_cap)·묶음 월 한도를 차례로 적용한다.
- 묶음 한도 단위가 usage 이면 혜택액이 아니라 혜택 대상 이용금액의 월 한도다.
- 브랜드 한정 혜택(brands)은 가맹점 브랜드가 맞을 때만 붙고, 업종이 달라도 브랜드가 맞으면 붙는다.
- also 에 적힌 세부 업종(동물병원·골프연습장 등)에도 붙는다. 상품설명서에 '포함'이라고 적힌 경우만 해당한다.
- ℓ당 할인은 결제액을 휘발유 가격(FUEL_PRICE)으로 나눠 리터로 바꾼다.
- Plan Day: 매월 정한 날 그 묶음의 첫 할인 거래는 할인율에 배율을 곱한다.
- 월 리워드(전월 실적만 보고 주는 정액)는 결제 혜택이 아니라 month_reward 로 따로 더한다.
"""

import math
from dataclasses import dataclass, field
from datetime import date, datetime

DAY_NAMES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAYS = {**{name: i for i, name in enumerate(DAY_NAMES)}, "weekday": (0, 1, 2, 3, 4), "weekend": (5, 6)}
FUEL_PRICE = 1700               # ℓ당 휘발유 가격 가정값 (원)
SOLPAY = "SOLPAY"


def pay_method(channel: str, select_mode: str) -> str | None:
    """결제수단. SOL페이 결제화면을 연 현장 결제(앱에서 고른 교통 포함)는 SOL페이 간편결제, 나머지는 간편결제가 아니다."""
    if select_mode == "app_selected" or (select_mode == "manual" and channel != "online"):
        return SOLPAY
    return None


@dataclass(frozen=True)
class Benefit:
    benefit_id: int
    category: str                                   # "*" 는 전 업종
    type: str                                       # discount / cashback / point
    rate: float | None = None
    amount: int | None = None                       # 정액 (결제액보다 클 수 없음)
    per_liter: int | None = None                    # ℓ당 할인액
    min_amount: int = 0                             # 건당 최소 결제액
    min_prev: int = 0                               # 전월 실적 하한
    max_per_tx: int | None = None                   # 건당 최대 혜택
    monthly_count: int | None = None
    daily_count: int | None = None
    cap_group: str | None = None
    cap_unit: str = "krw"                           # krw: 혜택액 한도, usage: 이용금액 한도
    row_cap: int | None = None                      # 이 행만의 월 한도
    days: tuple[int, ...] | None = None             # 적용 요일 (월=0 ~ 일=6)
    month_days: tuple[int, ...] | None = None       # 적용 날짜 (매월 1일, 10일 등)
    hours: tuple[int, int] | None = None            # 적용 시각 [시작, 끝)
    brands: frozenset[str] | None = None            # 브랜드 한정 혜택의 브랜드 코드
    plan_day: tuple[int, float] | None = None       # (날짜, 배율) 그날 묶음 첫 할인 거래의 할인율 배율
    also: frozenset[str] | None = None              # 이 업종들에도 붙는다 (상품설명서의 '포함' 예외)
    name: str = ""
    targets: tuple[tuple[str, str | None], ...] | None = None   # (업종, 브랜드|None). None 이면 category·brands 규칙
    max_prev: int | None = None                     # 전월 실적 상한 (이 금액 이상이면 다음 구간 행을 쓴다)
    basis: str = "benefit"                          # benefit: 한도가 혜택액 / usage: 한도가 이용금액
    pay: str | None = None                          # 결제수단 조건 (PAY / NOPAY / SOLPAY / KBPAY / SAMSUNGPAY / NHPAY)
    source_id: int | None = None                    # 원본 혜택 ID (같은 혜택의 구간별 행이 공유)

    def applies_at(self, when: datetime | None) -> bool:
        """시간 조건이 있는 혜택은 결제 시각을 알아야 적용한다."""
        if self.days is None and self.hours is None and self.month_days is None:
            return True
        if when is None:
            return False
        if self.days is not None and when.weekday() not in self.days:
            return False
        if self.month_days is not None and when.day not in self.month_days:
            return False
        return self.hours is None or self.hours[0] <= when.hour < self.hours[1]

    def pays_with(self, pay: str | None) -> bool:
        if self.pay is None:
            return True
        if self.pay == "PAY":
            return pay is not None
        if self.pay == "NOPAY":
            return pay is None
        return pay == self.pay

    def categories(self) -> frozenset[str]:
        if self.targets is not None:
            return frozenset(c for c, _ in self.targets)
        return frozenset({self.category} | set(self.also or ()))

    def matches(self, category: str, brand: str | None) -> bool:
        if self.targets is not None:
            return any(c == category and (b is None or b == brand) for c, b in self.targets)
        if self.brands is not None:
            return brand in self.brands
        return self.category in (category, "*") or (self.also is not None and category in self.also)


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
    rewards: tuple[tuple[int, int], ...] = ()                   # (전월 실적 하한, 월 리워드)
    total_caps: tuple[tuple[int, int | None], ...] = ()         # (전월 실적 하한, 카드 월 통합 한도). 비면 없음

    def benefits_for(self, category: str, brand: str | None = None) -> tuple[Benefit, ...]:
        """이 업종·브랜드에 걸리는 혜택. 카드는 바뀌지 않으므로 (업종, 브랜드)마다 한 번만 고른다
        (2026-11-19: 월간 맞춤 방식 계산이 같은 매칭을 수백만 번 반복해 첫 배치 요청이 0.8초를 넘었다).
        캐시는 데이터클래스 필드가 아니라 카드 비교·해시에 끼지 않는다."""
        cache = self.__dict__.get("_benefits_for")
        if cache is None:
            cache = {}
            object.__setattr__(self, "_benefits_for", cache)
        key = (category, brand)
        found = cache.get(key)
        if found is None:
            found = cache[key] = tuple(b for b in self.benefits if b.matches(category, brand))
        return found

    def advertises(self, category: str) -> bool:
        """그 업종을 콕 집은 혜택이 있는지. 사람이 '이 카드 카페 할인되지'라고 아는 수준."""
        return any(category in b.categories() and b.category != "*" for b in self.benefits)

    def perf_tiers(self) -> tuple[int, ...]:
        """혜택이 달라지는 전월 실적 하한 전부 (0 제외)."""
        lows = {lo for group in self.cap_tiers.values() for lo, _ in group}
        lows |= {b.min_prev for b in self.benefits} | {lo for lo, _ in self.rewards} | {lo for lo, _ in self.total_caps}
        return tuple(sorted(lo for lo in lows if lo > 0))


@dataclass
class CardMonth:
    """카드 한 장의 이번 달 상태."""
    prev_perf: int = 0
    perf: int = 0
    discount: int = 0
    txn: int = 0
    cap_used: dict[str, int] = field(default_factory=dict)     # 묶음별 쓴 혜택액 (usage 묶음은 이용금액)
    count_used: dict[int, int] = field(default_factory=dict)
    row_used: dict[int, int] = field(default_factory=dict)
    day: date | None = None
    day_count: dict[int, int] = field(default_factory=dict)
    plan_used: set[str] = field(default_factory=set)

    def roll(self) -> "CardMonth":
        return CardMonth(prev_perf=self.perf)


def cap_for(card: Card, cap_group: str, prev_perf: int) -> tuple[bool, int | None]:
    """(혜택 대상인지, 이번 달 한도). 한도 None 은 무제한."""
    ok = [cap for lo, cap in card.cap_tiers[cap_group] if prev_perf >= lo]
    if not ok:
        return False, 0
    return True, ok[-1]


def total_cap(card: Card, prev_perf: int) -> int | None:
    """카드 월 통합 한도. None 은 무제한."""
    caps = [cap for lo, cap in card.total_caps if prev_perf >= lo]
    return caps[-1] if caps else None


def _usage_base(b: Benefit, amount: int, st: CardMonth) -> int:
    """이용금액 기준 한도를 적용한 혜택 계산 대상 금액."""
    base = amount
    if b.basis == "usage":
        if b.max_per_tx is not None:
            base = min(base, b.max_per_tx)
        if b.row_cap is not None:
            base = max(min(base, b.row_cap - st.row_used.get(b.benefit_id, 0)), 0)
    return base


def month_reward(card: Card, prev_perf: int) -> int:
    """전월 실적만으로 받는 월 리워드. 구간이 여러 개면 가장 높은 것 하나."""
    return max((r for lo, r in card.rewards if prev_perf >= lo), default=0)


def _factor(b: Benefit, st: CardMonth, when: datetime | None) -> float:
    if b.plan_day is None or when is None or when.day != b.plan_day[0] or b.cap_group in st.plan_used:
        return 1.0
    return b.plan_day[1]


def _value(b: Benefit, base: int, factor: float) -> int:
    if b.per_liter is not None:
        raw = math.floor(base / FUEL_PRICE * b.per_liter / 10) * 10
    elif b.amount is not None:
        raw = min(b.amount, base)
    else:
        raw = math.floor(base * (b.rate or 0.0) * factor / 10) * 10
    if b.max_per_tx is not None and b.basis != "usage":
        raw = min(raw, int(b.max_per_tx * factor))
    return raw


def evaluate(card: Card, category: str, amount: int, st: CardMonth,
             when: datetime | None = None, brand: str | None = None, pay: str | None = None) -> tuple[int, Benefit | None]:
    """이 카드로 지금 결제하면 받을 혜택(원)과 적용될 혜택. 상태는 바꾸지 않는다. pay 는 결제수단 (pay_method)."""
    best_amt, best_b = 0, None
    today = when.date() if when is not None else None
    card_cap = total_cap(card, st.prev_perf)
    if card_cap is not None and card_cap - st.discount <= 0:
        return 0, None
    for b in card.benefits_for(category, brand):
        if amount < b.min_amount or st.prev_perf < b.min_prev or not b.applies_at(when):
            continue
        if (b.max_prev is not None and st.prev_perf >= b.max_prev) or not b.pays_with(pay):
            continue
        if b.monthly_count is not None and st.count_used.get(b.benefit_id, 0) >= b.monthly_count:
            continue
        if b.daily_count is not None and st.day == today and st.day_count.get(b.benefit_id, 0) >= b.daily_count:
            continue
        cap = None
        if b.cap_group is not None and b.cap_group in card.cap_tiers:
            eligible, cap = cap_for(card, b.cap_group, st.prev_perf)
            if not eligible:
                continue
        used = st.cap_used.get(b.cap_group, 0) if b.cap_group is not None else 0
        base = _usage_base(b, amount, st)
        if cap is not None and b.cap_unit == "usage":
            base = max(min(base, cap - used), 0)
        raw = _value(b, base, _factor(b, st, when))
        if cap is not None and b.cap_unit != "usage":
            raw = min(raw, cap - used)
        if b.row_cap is not None and b.basis != "usage":
            raw = min(raw, b.row_cap - st.row_used.get(b.benefit_id, 0))
        if card_cap is not None:
            raw = min(raw, card_cap - st.discount)
        if raw > best_amt:
            best_amt, best_b = raw, b
    return best_amt, best_b


def apply(st: CardMonth, amount: int, got: int, b: Benefit | None, counts_for_perf: bool = True,
          when: datetime | None = None) -> None:
    st.txn += 1
    if counts_for_perf:
        st.perf += amount
    if when is not None and st.day != when.date():
        st.day, st.day_count = when.date(), {}
    if b is None or got <= 0:
        return
    if b.cap_group is not None:
        st.cap_used[b.cap_group] = st.cap_used.get(b.cap_group, 0) + (amount if b.cap_unit == "usage" else got)
        if _factor(b, st, when) != 1.0:
            st.plan_used.add(b.cap_group)
    st.discount += got
    if b.monthly_count is not None:
        st.count_used[b.benefit_id] = st.count_used.get(b.benefit_id, 0) + 1
    if b.daily_count is not None:
        st.day_count[b.benefit_id] = st.day_count.get(b.benefit_id, 0) + 1
    if b.row_cap is not None:
        st.row_used[b.benefit_id] = st.row_used.get(b.benefit_id, 0) + (_usage_base(b, amount, st) if b.basis == "usage" else got)
