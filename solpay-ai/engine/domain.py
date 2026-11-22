"""엔진이 주고받는 값. 데이터베이스와 API 형식에 묶이지 않게 따로 둔다."""

from dataclasses import dataclass, field
from datetime import datetime

MODE_APP_SELECTED = "app_selected"
MODE_MANUAL = "manual"


@dataclass(frozen=True)
class User:
    user_id: int


@dataclass(frozen=True)
class UserCard:
    user_card_id: int
    card_id: int
    issuer: str
    display_order: int
    excluded: bool = False


@dataclass(frozen=True)
class Merchant:
    merchant_id: int
    name: str
    category: str
    lat: float | None = None
    lng: float | None = None
    is_online: bool = False
    zone: str | None = None
    brand: str | None = None
    brand_code: str | None = None       # 혜택 계산용 실제 브랜드 코드 (STARBUCKS, CU …). 없으면 브랜드 한정 혜택 대상 아님

    def is_brand(self, brand: str) -> bool:
        """이벤트는 브랜드 단위다. 브랜드명이 같거나 가맹점 이름이 브랜드명으로 시작하면 그 브랜드로 본다."""
        return self.brand == brand or self.name.startswith(brand)


@dataclass(frozen=True)
class Payment:
    payment_id: int
    user_id: int
    user_card_id: int
    merchant_id: int | None
    category: str
    channel: str
    card_select_mode: str
    amount: int
    paid_at: datetime
    synced_at: datetime | None = None
    # 그 결제에서 실제로 받은 프로모션 금액 (팀 DB payments.promotion_amount). 기록이 없는 결제(시연 결제 등)는 None
    promotion_amount: int | None = None

    @property
    def pay(self) -> str | None:
        """결제수단 조건용. SOL페이 결제화면을 연 결제는 SOL페이 간편결제, 나머지는 간편결제가 아니다 (benefit_calc.pay_method 와 같다)."""
        return "SOLPAY" if self.is_placement else None

    @property
    def is_placement(self) -> bool:
        """결제화면을 연 현장 결제만 배치 대상이다."""
        if self.card_select_mode == MODE_APP_SELECTED:
            return True
        return self.card_select_mode == MODE_MANUAL and self.channel != "online"

    @property
    def visible_at(self) -> datetime:
        """앱에서 결제하면 바로 알고, 그 밖의 결제는 동기화 시각 이후에 안다."""
        if self.is_placement or self.synced_at is None:
            return self.paid_at
        return self.synced_at


@dataclass(frozen=True)
class Promotion:
    """카드사 이벤트·마이샵 혜택. 브랜드 단위이며 merchant_ids 는 그 브랜드로 매칭된 가맹점이다.

    포인트·캐시백·즉시할인은 모두 1P = 1원으로 본다. max_amount 는 결제 한 건의 상한이다.
    """
    promotion_id: int
    brand: str
    starts_at: datetime
    ends_at: datetime
    merchant_ids: frozenset[int] = frozenset()
    issuer: str | None = None           # 없으면 모든 카드사
    card_id: int | None = None          # 없으면 그 카드사의 모든 카드
    amount: int | None = None           # 정액 혜택
    rate: float | None = None           # 비율 혜택
    min_amount: int = 0
    max_amount: int | None = None
    title: str = ""
    kind: str = "event"                 # event / myshop
    needs_check: bool = False           # 엔진이 확인할 수 없는 조건이 있어 계산에서 뺀다

    def active(self, at: datetime) -> bool:
        return self.starts_at <= at <= self.ends_at

    def applies(self, merchant_id: int, card_issuer: str, card_id: int, at: datetime) -> bool:
        if self.needs_check or not self.active(at) or merchant_id not in self.merchant_ids:
            return False
        if self.issuer is not None and self.issuer != card_issuer:
            return False
        return self.card_id is None or self.card_id == card_id

    def value(self, merchant_id: int, card_issuer: str, card_id: int, amount: int, at: datetime) -> int:
        if amount < self.min_amount or not self.applies(merchant_id, card_issuer, card_id, at):
            return 0
        got = min(self.amount, amount) if self.amount is not None else int(amount * (self.rate or 0.0) / 10) * 10
        return min(got, self.max_amount) if self.max_amount is not None else got

    def label(self) -> str:
        what = f"{self.amount:,}원" if self.amount is not None else f"{(self.rate or 0) * 100:g}%"
        kind = "마이샵" if self.kind == "myshop" else "이벤트"
        return f"{self.brand} {kind} {what}"


@dataclass(frozen=True)
class UserWeights:
    """사용자별 설정. 비어 있으면 기본값을 쓴다."""
    w1: float | None = None
    w2: float | None = None
    switch_threshold: int | None = None
    base_order: str | None = None


@dataclass(frozen=True)
class RankRequest:
    user_id: int
    at: datetime


@dataclass(frozen=True)
class ScheduleItem:
    """하루 일정 한 줄. 최소 수집: 시간·업종·예상 금액만 받고 장소·메모 같은 자유 입력은 받지 않는다.
    그날이 지나면 지운다 (store.purge_schedules)."""
    item_id: int
    user_id: int
    start: datetime
    end: datetime
    category: str
    amount: int


@dataclass(frozen=True)
class KnownPayment:
    """평가 전용: 결제를 미리 안다고 가정한 상한을 잴 때 쓴다."""
    category: str
    amount: int
    merchant_id: int | None = None


@dataclass
class RankedCard:
    user_card_id: int
    rank: int
    score_won: int
    message: str


@dataclass
class RankResult:
    cards: list[RankedCard]
    display_count: int
    reason_code: str
    rule_applied: int | None
    version: str                        # schedule (일정으로 정함) / pattern (소비 패턴으로 정함)
    scenario_mode: str
    base_card: int
    swapped: bool = False
    swap_reason: str | None = None      # benefit / performance
    repeat_applied: bool = False
    top_category: str | None = None
    scenarios: list[dict] = field(default_factory=list)
    card_scores: dict[int, dict] = field(default_factory=dict)
    hold: bool = False                  # 기본 카드를 구간 지키기로 정했는지 (ranker.Decision.hold, 월간 리포트 base_reason)
    # 기본 카드를 정한 단계 (ranker.choose_base: loss_guard·month_end·hold·strategy·nothing, 실적 채울 카드가 없으면 no_fill,
    # 고정 규칙 화면 forced, 프로모션 카드 화면 promotion(기본 카드를 다시 정하지 않고 직전 값). 월간 리포트 전략 문장)
    base_source: str | None = None
