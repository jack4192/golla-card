"""저장소 인터페이스와 가상 데이터용 구현. 운영 DB 구현은 pg_store.py 에 있다."""

from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

from engine import loader
from engine.catalog import Catalog
from engine.domain import Payment, Promotion, ScheduleItem, User, UserCard, UserWeights
from engine.rules import Rule, parse_rule


class UnknownUser(LookupError):
    pass


@dataclass
class UserContext:
    user: User
    cards: list[UserCard]
    payments: list[Payment]             # 배치 시각에 앱이 아는 결제만, 시간순
    rules: list[Rule] = field(default_factory=list)
    weights: UserWeights | None = None
    promotions: list[Promotion] = field(default_factory=list)
    last_base: int | None = None
    benefit_start: str | None = None
    schedules: list[ScheduleItem] = field(default_factory=list)     # 그날 일정

    def __post_init__(self):
        # 내 카드가 아닌 결제(지운 카드, 잘못 들어온 결제)는 어느 카드의 실적·혜택에도 넣을 수 없으니 뺀다.
        # 예전에는 이런 결제가 하나라도 있으면 그 사용자의 배치·리포트가 계속 500 이었다 (state.apply 의 KeyError).
        owned = {c.user_card_id for c in self.cards}
        if any(p.user_card_id not in owned for p in self.payments):
            self.payments = [p for p in self.payments if p.user_card_id in owned]


class Store(Protocol):
    def load_catalog(self) -> Catalog: ...
    def context(self, user_id: int, at: datetime) -> UserContext: ...
    def user(self, user_id: int) -> User: ...
    def log_recommendation(self, record: dict) -> int: ...
    def save_rules(self, user_id: int, rules: list[dict]) -> None: ...
    def raw_rules(self, user_id: int) -> list[dict]: ...
    def put_schedule(self, user_id: int, day: date, items: list[ScheduleItem]) -> None: ...
    def schedules(self, user_id: int, day: date) -> list[ScheduleItem]: ...
    def purge_schedules(self, today: date) -> int: ...
    def recommendation_history(self, user_id: int) -> list[dict]: ...
    def log_card_recommendation(self, record: dict) -> None: ...
    def add_payment(self, payment: Payment) -> None: ...
    def reset(self) -> None: ...


class ParquetStore:
    """가상 데이터를 메모리에 올려 쓴다. 시연과 로컬 실행용이다."""
    BENEFIT_START = "2025-12"           # 첫 달은 전월 실적이 없어 혜택 없이 실적만 쌓는다

    def __init__(self, directory: Path | None = None):
        self.directory = directory
        self.cards = loader.load_user_cards(directory)
        self.reset()

    def reset(self) -> None:
        """시연 중 더한 결제, 규칙, 일정, 카드 추천 기록을 지우고 가상 데이터 상태로 돌아간다."""
        self.users = loader.load_users(self.directory)
        self.payments = loader.payments_from_frame(loader.read_payments(self.directory))
        self.rules: dict[int, list[Rule]] = {}
        self.rules_raw: dict[int, list[dict]] = {}
        self.logs: list[dict] = []
        self.last_bases: dict[int, int] = {}
        self.schedule_items: dict[tuple[int, date], list[ScheduleItem]] = {}   # 메모리에만 둔다 (재시작하면 사라짐)
        self.card_recommendations: dict[int, list[dict]] = {}
        self.drafts: dict[int, dict] = {}       # 챗봇 규칙 초안 (DB 저장소는 app.chat_rule_drafts)

    def user(self, user_id: int) -> User:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        return self.users[user_id]

    def put_schedule(self, user_id: int, day: date, items: list[ScheduleItem]) -> None:
        self.user(user_id)
        if items:
            self.schedule_items[(user_id, day)] = list(items)
        else:
            self.schedule_items.pop((user_id, day), None)

    def schedules(self, user_id: int, day: date) -> list[ScheduleItem]:
        return list(self.schedule_items.get((user_id, day), []))

    def purge_schedules(self, today: date) -> int:
        """지난 날의 일정을 지운다 (최소 보관)."""
        old = [k for k in self.schedule_items if k[1] < today]
        for k in old:
            del self.schedule_items[k]
        return len(old)

    def recommendation_history(self, user_id: int) -> list[dict]:
        return list(self.card_recommendations.get(user_id, []))

    def log_card_recommendation(self, record: dict) -> None:
        self.card_recommendations.setdefault(record["user_id"], []).append(record)

    def raw_rules(self, user_id: int) -> list[dict]:
        self.user(user_id)
        return list(self.rules_raw.get(user_id, []))

    def load_catalog(self) -> Catalog:
        self.catalog = loader.load_catalog(self.directory)
        self.promotions = loader.load_promotions(self.catalog, self.directory)
        return self.catalog

    def context(self, user_id: int, at: datetime) -> UserContext:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        visible = [p for p in self.payments.get(user_id, []) if p.visible_at <= at]
        active = [p for p in getattr(self, "promotions", []) if p.active(at)]
        self.purge_schedules(at.date())
        return UserContext(self.users[user_id], self.cards[user_id], visible, self.rules.get(user_id, []),
                           promotions=active, last_base=self.last_bases.get(user_id), benefit_start=self.BENEFIT_START,
                           schedules=self.schedules(user_id, at.date()))

    def log_recommendation(self, record: dict) -> int:
        self.logs.append(record)
        self.last_bases[record["user_id"]] = record["base_card"]
        return len(self.logs)

    def save_rules(self, user_id: int, rules: list[dict]) -> None:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        for r in rules:
            parse_rule(r)
        # 만든 시각을 규칙에 적어 둔다 (이미 적힌 규칙은 그대로: add_rule 은 앞 규칙을 다시 저장한다). DB 저장소는 표의 created_at
        now = datetime.now(ZoneInfo("Asia/Seoul")).isoformat(timespec="seconds")
        rules = [r if r.get("created_at") else {**r, "created_at": now} for r in rules]
        self.rules[user_id] = [parse_rule(r, i + 1, i) for i, r in enumerate(rules)]
        self.rules_raw[user_id] = list(rules)

    def recommendation(self, user_id: int, recommendation_id: int) -> dict | None:
        if not 1 <= recommendation_id <= len(self.logs):
            return None
        record = self.logs[recommendation_id - 1]
        return record if record.get("user_id") == user_id else None

    def add_rule(self, user_id: int, rule: dict) -> int:
        rules = self.raw_rules(user_id) + [rule]
        self.save_rules(user_id, rules)
        return len(rules)

    def save_draft(self, user_id: int, session_id: str | None, rule: dict, summary: str) -> int:
        draft_id = len(self.drafts) + 1
        self.drafts[draft_id] = {"draft_id": draft_id, "user_id": user_id, "session_id": session_id, "rule": rule,
                                 "summary": summary, "status": "pending"}
        return draft_id

    def draft(self, draft_id: int) -> dict | None:
        return self.drafts.get(draft_id)

    def decide_draft(self, draft_id: int, status: str) -> None:
        self.drafts[draft_id]["status"] = status

    def add_payment(self, payment: Payment) -> None:
        if payment.user_id not in self.users:
            raise UnknownUser(payment.user_id)
        if any(p.payment_id == payment.payment_id for p in self.payments.get(payment.user_id, [])):
            return                                   # 같은 결제를 두 번 보내도 한 번만 반영한다
        rows = self.payments.setdefault(payment.user_id, [])
        rows.append(payment)
        rows.sort(key=lambda p: p.paid_at)
