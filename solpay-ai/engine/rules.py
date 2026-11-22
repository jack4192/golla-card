"""1단계 사용자 규칙. 챗봇이 사용자에게 확인을 받아 저장한 규칙만 들어온다."""

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from engine.benefit_calc import DAYS
from engine.domain import UserCard
from engine.params import BASE_ORDER_TOP_TIER, SELECTABLE, Params

# no_fill: 실적을 채우지 않을 카드 (2026-11-19 결정). 기본 카드 후보에서 빼고 건당 혜택으로만 경쟁한다.
RULE_TYPES = ("force", "exclude", "preference", "order", "no_fill")


class RuleError(ValueError):
    pass


@dataclass(frozen=True)
class Rule:
    rule_id: int
    rule_type: str
    days: tuple[int, ...] | None = None
    hours: tuple[int, int] | None = None     # [시작, 끝)
    issuer: str | None = None
    user_card_ids: tuple[int, ...] = ()
    w1: float | None = None
    w2: float | None = None
    base_order: str | None = None
    priority: int = 0
    source_text: str = ""
    created_seq: int = 0                     # 클수록 최근 규칙
    active: bool = True
    created_at: datetime | None = None       # 만든 시각 (모르면 None). 지난달 효과는 그때 있던 규칙만 쓴다 (rules_at)

    @property
    def specificity(self) -> int:
        return int(self.days is not None) + int(self.hours is not None)

    def matches(self, at: datetime) -> bool:
        if not self.active:
            return False
        if self.days is not None and at.weekday() not in self.days:
            return False
        return self.hours is None or self.hours[0] <= at.hour < self.hours[1]

    def targets(self, cards: list[UserCard]) -> list[UserCard]:
        return [c for c in cards
                if c.user_card_id in self.user_card_ids or (self.issuer is not None and c.issuer == self.issuer)]


def _is_int(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _object(value, name: str) -> dict:
    """condition·target·settings 칸: 없으면 빈 객체, 객체가 아니면 RuleError (형식이 틀려도 500 이 나지 않게)."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise RuleError(f"{name} 은 객체여야 합니다: {value!r}")
    return value


def _parse_days(values) -> tuple[int, ...] | None:
    if not values:
        return None
    if not isinstance(values, (list, tuple)):
        raise RuleError(f"요일은 목록이어야 합니다: {values!r}")
    out: list[int] = []
    for value in values:
        if not isinstance(value, str) or value not in DAYS:
            raise RuleError(f"알 수 없는 요일: {value}")
        day = DAYS[value]
        out.extend(day if isinstance(day, tuple) else (day,))
    return tuple(sorted(set(out)))


def _parse_hours(values) -> tuple[int, int] | None:
    if not values:
        return None
    if (not isinstance(values, (list, tuple)) or len(values) != 2 or not all(_is_int(v) for v in values)
            or not 0 <= values[0] < values[1] <= 24):
        raise RuleError(f"시각은 [시작, 끝] 형식의 정수 두 개여야 합니다 (0~24): {values!r}")
    return int(values[0]), int(values[1])


def _parse_time(value) -> datetime | None:
    """만든 시각: ISO 문자열이나 datetime. 시간대가 없으면 한국 시간으로 본다."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            raise RuleError(f"created_at 은 날짜·시각이어야 합니다: {value!r}")
    if not isinstance(value, datetime):
        raise RuleError(f"created_at 은 날짜·시각이어야 합니다: {value!r}")
    return value.replace(tzinfo=ZoneInfo("Asia/Seoul")) if value.tzinfo is None else value


def rules_at(rules, when: datetime) -> list[Rule]:
    """when 에 이미 있던 규칙 (만든 시각을 모르는 규칙은 늘 있던 것으로 본다)."""
    return [r for r in rules if r.created_at is None or r.created_at <= when]


def parse_rule(data: dict, rule_id: int = 0, created_seq: int = 0) -> Rule:
    """user_rules 한 행(또는 챗봇이 만든 JSON)을 검증해 Rule 로 바꾼다."""
    if not isinstance(data, dict):
        raise RuleError(f"규칙은 객체여야 합니다: {data!r}")
    rule_type = data.get("rule_type")
    if not isinstance(rule_type, str) or rule_type not in RULE_TYPES:
        raise RuleError(f"알 수 없는 규칙 종류: {rule_type}")
    condition = _object(data.get("condition"), "condition")
    target = _object(data.get("target"), "target")
    settings = _object(data.get("settings"), "settings")
    ids = target.get("user_card_ids") or ()
    if not isinstance(ids, (list, tuple)) or not all(_is_int(i) for i in ids):
        raise RuleError(f"user_card_ids 는 카드 번호(정수) 목록이어야 합니다: {ids!r}")
    user_card_ids = tuple(ids)
    issuer = target.get("issuer")
    if issuer is not None and not isinstance(issuer, str):
        raise RuleError(f"issuer 는 카드사 코드(문자열)여야 합니다: {issuer!r}")
    for name in ("w1", "w2"):
        if settings.get(name) is not None and not _is_number(settings[name]):
            raise RuleError(f"{name} 은 숫자여야 합니다: {settings[name]!r}")
    if not _is_int(data.get("priority", 0)):
        raise RuleError(f"priority 는 정수여야 합니다: {data.get('priority')!r}")
    if not isinstance(data.get("active", True), bool):
        raise RuleError(f"active 는 true/false 여야 합니다: {data.get('active')!r}")
    if rule_type in ("force", "exclude", "no_fill") and not (issuer or user_card_ids):
        raise RuleError(f"{rule_type} 규칙에는 대상 카드가 필요합니다")
    base_order = settings.get("base_order")
    # 실적 채우기 방식: 첫 구간 우선 / 주력 카드 우선 / 가치 최대 / 실적 안 채움 (+ 1번 카드 최고 구간)
    if rule_type == "order" and base_order not in (*SELECTABLE, BASE_ORDER_TOP_TIER):
        raise RuleError(f"알 수 없는 기본 카드 순서: {base_order}")
    return Rule(
        rule_id=data.get("rule_id", rule_id), rule_type=rule_type,
        days=_parse_days(condition.get("days")), hours=_parse_hours(condition.get("hours")),
        issuer=issuer, user_card_ids=user_card_ids,
        w1=settings.get("w1"), w2=settings.get("w2"), base_order=base_order,
        priority=data.get("priority", 0), source_text=data.get("source_text", ""),
        created_seq=data.get("created_seq", created_seq), active=data.get("active", True),
        created_at=_parse_time(data.get("created_at")),
    )


@dataclass
class RuleOutcome:
    forced: list[UserCard]
    forced_rule: Rule | None
    excluded: set[int]
    params: Params
    no_fill: set[int] = None                 # 실적을 채우지 않을 카드 (기본 카드 후보에서 뺀다)
    order_rule: Rule | None = None           # 지금 적용된 실적 채우기 방식 규칙


def resolve(rules: list[Rule], cards: list[UserCard], at: datetime, params: Params) -> RuleOutcome:
    """지금 시각에 맞는 규칙을 적용한다. 조건이 구체적인 규칙이 먼저이고, 같으면 최근 규칙이다."""
    matched = sorted((r for r in rules if r.matches(at)),
                     key=lambda r: (r.specificity, r.priority, r.created_seq), reverse=True)
    forced, forced_rule, excluded, no_fill, order_rule = [], None, set(), set(), None
    changes: dict = {}
    for rule in matched:
        if rule.rule_type == "exclude":
            excluded |= {c.user_card_id for c in rule.targets(cards)}
        elif rule.rule_type == "no_fill":
            no_fill |= {c.user_card_id for c in rule.targets(cards)}
        elif rule.rule_type == "preference" and "w1" not in changes:
            for name, value in (("w1", rule.w1), ("w2", rule.w2)):
                if value is not None:
                    changes[name] = min(max(value, params.weight_min), params.weight_max)
        elif rule.rule_type == "order" and "base_order" not in changes:
            changes["base_order"] = rule.base_order
            order_rule = rule
    for rule in matched:
        if rule.rule_type == "force":
            usable = [c for c in rule.targets(cards) if c.user_card_id not in excluded]
            if usable:                       # 지정 카드를 더 이상 보유하지 않으면 건너뛴다
                forced, forced_rule = usable, rule
                break
    return RuleOutcome(forced, forced_rule, excluded, params.with_(**changes) if changes else params, no_fill,
                       order_rule)
