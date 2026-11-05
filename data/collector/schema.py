"""AI 구조화 스키마. 금액은 원, 비율은 0~1 (10% → 0.10), 시각은 "HH:MM" (승인 시각 기준)."""

from typing import Literal

from pydantic import BaseModel, Field

# categories.yml 의 업종 코드 + ALL(전 가맹점) + OVERSEAS(해외) + OTHER(그 밖)
CategoryCode = Literal[
    "CAFE", "CVS", "REST", "FASTFOOD", "BAKERY", "DELIVERY", "MART", "SUPER", "ONLINE", "FUEL",
    "MOVIE", "BOOK", "BEAUTY", "APPAREL", "MEDICAL", "EDU", "TRANSIT", "TAXI", "TELECOM", "SUBSCR", "UTILITY",
    "ALL", "OVERSEAS", "OTHER",
]
Weekday = Literal["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

# 숫자 칸의 범위. 모델이 0을 끝없이 반복하는 경우가 있어서 스키마에 상한을 둔다.
MAX_WON = 100_000_000
MAX_COUNT = 1_000


class TimeWindow(BaseModel):
    start: str = Field(description="시작 시각 HH:MM. 예: DAY(07~15시) → 07:00")
    end: str = Field(description="끝 시각 HH:MM")


class Tier(BaseModel):
    min_prev_spend: int = Field(ge=0, le=MAX_WON, description="전월 실적 하한(원), 이상")
    max_prev_spend: int | None = Field(None, ge=0, le=MAX_WON, description="전월 실적 상한(원), 미만. 없으면 null")
    cap_amount: int | None = Field(None, ge=0, le=MAX_WON, description="이 구간의 월 혜택 한도(원). 한도 없음이면 null")
    count_limit: int | None = Field(None, ge=0, le=MAX_COUNT, description="이 구간의 월 혜택 횟수 제한")


class CapGroup(BaseModel):
    code: str = Field(description="한도 묶음 이름. 예: TIME_PLAN, 통합")
    description: str = Field(description="어떤 혜택들이 이 한도를 함께 쓰는지")
    tiers: list[Tier] = Field(description="전월 실적 구간별 한도. 실적 조건 없이 한도만 있으면 min_prev_spend=0 한 줄")


class Benefit(BaseModel):
    title: str = Field(description="원문의 혜택 이름")
    categories: list[CategoryCode] = Field(description="해당 업종 코드")
    tags: list[str] = Field(default_factory=list, description="업종 코드로 못 담는 주제. 예: 공항라운지, 항공, 보험, 공과금")
    merchants: list[str] = Field(default_factory=list, description="대상 가맹점·브랜드. 업종 전체면 빈 목록")
    benefit_type: Literal["discount", "cashback", "point", "mileage", "fee_waiver", "installment", "service", "other"] = Field(
        description="discount 청구할인, cashback 캐시백, point 포인트 적립, mileage 항공 마일리지, fee_waiver 수수료·연회비 면제, "
                    "installment 무이자 할부, service 라운지·바우처·보험 같은 서비스, other 그 밖")
    rate: float | None = Field(None, ge=0, le=1, description="비율 0~1")
    amount: int | None = Field(None, ge=0, le=MAX_WON, description="정액 혜택(원)")
    time_window: TimeWindow | None = None
    weekdays: list[Weekday] | None = Field(None, description="적용 요일. 매일이면 null")
    channel: Literal["any", "offline", "online", "pay_app"] = Field(
        "any", description="offline=오프라인 매장만, online=온라인·앱만, pay_app=지정 간편결제로 결제할 때만")
    pay_apps: list[str] = Field(default_factory=list)
    min_txn_amount: int | None = Field(None, ge=0, le=MAX_WON, description="건당 최소 결제액(원)")
    max_eligible_amount_per_txn: int | None = Field(None, ge=0, le=MAX_WON, description="할인 전 이용금액 기준 1회 이 금액까지")
    max_benefit_per_txn: int | None = Field(None, ge=0, le=MAX_WON, description="건당 최대 혜택액(원)")
    daily_count: int | None = Field(None, ge=0, le=MAX_COUNT)
    monthly_count: int | None = Field(None, ge=0, le=MAX_COUNT)
    requires_prev_spend: int | None = Field(None, ge=0, le=MAX_WON, description="이 혜택에만 따로 붙는 전월 실적 조건(원)")
    cap_group: str | None = Field(None, description="이 혜택이 쓰는 CapGroup.code")
    excludes: list[str] = Field(default_factory=list, description="제외 조건 (임대매장, 현장결제 등)")
    notes: str | None = Field(None, description="필드로 못 담은 조건")
    quote: str = Field(description="근거 원문 문장을 그대로 짧게 (80자 이내)")
    needs_review: bool = Field(description="조건이 애매하거나 원문에서 확인 못 한 값이 있으면 true")


class CardExtract(BaseModel):
    """모델이 원문에서 채우는 부분."""
    card_name: str | None = Field(None, description="원문에 적힌 카드 이름")
    card_type: Literal["credit", "check"] | None = None
    annual_fee_domestic: int | None = Field(None, ge=0, le=MAX_WON, description="국내전용 기본 연회비(원)")
    annual_fee_note: str | None = None
    prev_spend_basis: str | None = Field(None, description="전월 실적 산정 기준 요약")
    perf_exclusions: list[str] = Field(default_factory=list, description="전월 실적에서 빠지는 항목")
    cap_groups: list[CapGroup] = Field(default_factory=list)
    benefits: list[Benefit]
