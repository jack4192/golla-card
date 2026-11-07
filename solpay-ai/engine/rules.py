"""1단계 사용자 규칙. 챗봇이 사용자에게 확인을 받아 저장한 규칙만 들어온다."""

from dataclasses import dataclass
from datetime import datetime

from engine.benefit_calc import DAYS
from engine.domain import UserCard
from engine.params import BASE_ORDER_FIRST_TIER, BASE_ORDER_TOP_TIER, Params

RULE_TYPES = ("force", "exclude", "preference", "order")


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


def _parse_days(values) -> tuple[int, ...] | None:
    if not values:
        return None
    out: list[int] = []
    for value in values:
        if value not in DAYS:
            raise RuleError(f"알 수 없는 요일: {value}")
        day = DAYS[value]
        out.extend(day if isinstance(day, tuple) else (day,))
    return tuple(sorted(set(out)))


def _parse_hours(values) -> tuple[int, int] | None:
    if not values:
        return None
    if len(values) != 2 or not 0 <= values[0] < values[1] <= 24:
        raise RuleError(f"시각은 [시작, 끝] 형식이어야 합니다: {values}")
    return int(values[0]), int(values[1])


def parse_rule(data: dict, rule_id: int = 0, created_seq: int = 0) -> Rule:
    """user_rules 한 행(또는 챗봇이 만든 JSON)을 검증해 Rule 로 바꾼다."""
    rule_type = data.get("rule_type")
    if rule_type not in RULE_TYPES:
        raise RuleError(f"알 수 없는 규칙 종류: {rule_type}")
    condition = data.get("condition") or {}
    target = data.get("target") or {}
    settings = data.get("settings") or {}
    user_card_ids = tuple(target.get("user_card_ids") or ())
    issuer = target.get("issuer")
    if rule_type in ("force", "exclude") and not (issuer or user_card_ids):
        raise RuleError(f"{rule_type} 규칙에는 대상 카드가 필요합니다")
    base_order = settings.get("base_order")
    if rule_type == "order" and base_order not in (BASE_ORDER_FIRST_TIER, BASE_ORDER_TOP_TIER):
        raise RuleError(f"알 수 없는 기본 카드 순서: {base_order}")
    return Rule(
        rule_id=data.get("rule_id", rule_id), rule_type=rule_type,
        days=_parse_days(condition.get("days")), hours=_parse_hours(condition.get("hours")),
        issuer=issuer, user_card_ids=user_card_ids,
        w1=settings.get("w1"), w2=settings.get("w2"), base_order=base_order,
        priority=data.get("priority", 0), source_text=data.get("source_text", ""),
        created_seq=data.get("created_seq", created_seq), active=data.get("active", True),
    )


@dataclass
class RuleOutcome:
    forced: list[UserCard]
    forced_rule: Rule | None
    excluded: set[int]
    params: Params


def resolve(rules: list[Rule], cards: list[UserCard], at: datetime, params: Params) -> RuleOutcome:
    """지금 시각에 맞는 규칙을 적용한다. 조건이 구체적인 규칙이 먼저이고, 같으면 최근 규칙이다."""
    matched = sorted((r for r in rules if r.matches(at)),
                     key=lambda r: (r.specificity, r.priority, r.created_seq), reverse=True)
    forced, forced_rule, excluded = [], None, set()
    changes: dict = {}
    for rule in matched:
        if rule.rule_type == "exclude":
            excluded |= {c.user_card_id for c in rule.targets(cards)}
        elif rule.rule_type == "preference" and "w1" not in changes:
            for name, value in (("w1", rule.w1), ("w2", rule.w2)):
                if value is not None:
                    changes[name] = min(max(value, params.weight_min), params.weight_max)
        elif rule.rule_type == "order" and "base_order" not in changes:
            changes["base_order"] = rule.base_order
    for rule in matched:
        if rule.rule_type == "force":
            usable = [c for c in rule.targets(cards) if c.user_card_id not in excluded]
            if usable:                       # 지정 카드를 더 이상 보유하지 않으면 건너뛴다
                forced, forced_rule = usable, rule
                break
    return RuleOutcome(forced, forced_rule, excluded, params.with_(**changes) if changes else params)
