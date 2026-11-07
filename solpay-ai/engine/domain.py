"""엔진이 주고받는 값. 데이터베이스와 API 형식에 묶이지 않게 따로 둔다."""

from dataclasses import dataclass, field
from datetime import datetime

MODE_APP_SELECTED = "app_selected"
MODE_MANUAL = "manual"


@dataclass(frozen=True)
class User:
    user_id: int
    loc_consent: bool = False
    loc_feature_on: bool = False

    @property
    def location_enabled(self) -> bool:
        """위치 동의와 기능 설정이 모두 켜져 있어야 동의 버전을 쓴다."""
        return self.loc_consent and self.loc_feature_on


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
    promotion_id: int
    merchant_id: int
    starts_at: datetime
    ends_at: datetime
    card_id: int | None = None          # 없으면 모든 카드
    amount: int | None = None           # 정액 혜택
    rate: float | None = None           # 비율 혜택
    min_amount: int = 0
    title: str = ""

    def value(self, card_id: int, amount: int, at: datetime) -> int:
        if not self.starts_at <= at <= self.ends_at or amount < self.min_amount:
            return 0
        if self.card_id is not None and self.card_id != card_id:
            return 0
        if self.amount is not None:
            return min(self.amount, amount)
        return int(amount * (self.rate or 0.0) / 10) * 10


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
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    selected_merchant_id: int | None = None     # 후보 칩을 눌렀을 때


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
    merchant_chips: list[dict]
    reason_code: str
    rule_applied: int | None
    version: str                        # consent / no_consent
    scenario_mode: str
    base_card: int
    swapped: bool = False
    swap_reason: str | None = None      # benefit / performance
    repeat_applied: bool = False
    top_category: str | None = None
    scenarios: list[dict] = field(default_factory=list)
    card_scores: dict[int, dict] = field(default_factory=dict)
