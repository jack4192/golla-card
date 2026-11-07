"""저장소 인터페이스와 가상 데이터용 구현. 운영 DB 구현은 pg_store.py 에 있다."""

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Protocol

from engine import loader
from engine.catalog import Catalog
from engine.domain import Payment, Promotion, User, UserCard, UserWeights
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


class Store(Protocol):
    def load_catalog(self) -> Catalog: ...
    def context(self, user_id: int, at: datetime) -> UserContext: ...
    def user(self, user_id: int) -> User: ...
    def log_recommendation(self, record: dict) -> int: ...
    def save_rules(self, user_id: int, rules: list[dict]) -> None: ...
    def raw_rules(self, user_id: int) -> list[dict]: ...
    def set_consent(self, user_id: int, loc_consent: bool, loc_feature_on: bool) -> None: ...
    def add_payment(self, payment: Payment) -> None: ...
    def reset(self) -> None: ...


class ParquetStore:
    """가상 데이터를 메모리에 올려 쓴다. 시연과 로컬 실행용이다."""
    BENEFIT_START = "2026-08"           # 첫 달은 전월 실적이 없어 혜택 없이 실적만 쌓는다

    def __init__(self, directory: Path | None = None):
        self.directory = directory
        self.cards = loader.load_user_cards(directory)
        self.reset()

    def reset(self) -> None:
        """시연 중 더한 결제, 규칙, 위치 설정을 지우고 가상 데이터 상태로 돌아간다."""
        self.users = loader.load_users(self.directory)
        self.payments = loader.payments_from_frame(loader.read_payments(self.directory))
        self.rules: dict[int, list[Rule]] = {}
        self.rules_raw: dict[int, list[dict]] = {}
        self.logs: list[dict] = []
        self.last_bases: dict[int, int] = {}

    def user(self, user_id: int) -> User:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        return self.users[user_id]

    def set_consent(self, user_id: int, loc_consent: bool, loc_feature_on: bool) -> None:
        self.user(user_id)
        self.users[user_id] = User(user_id, loc_consent, loc_feature_on)

    def raw_rules(self, user_id: int) -> list[dict]:
        self.user(user_id)
        return list(self.rules_raw.get(user_id, []))

    def load_catalog(self) -> Catalog:
        return loader.load_catalog(self.directory)

    def context(self, user_id: int, at: datetime) -> UserContext:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        visible = [p for p in self.payments.get(user_id, []) if p.visible_at <= at]
        return UserContext(self.users[user_id], self.cards[user_id], visible, self.rules.get(user_id, []),
                           last_base=self.last_bases.get(user_id), benefit_start=self.BENEFIT_START)

    def log_recommendation(self, record: dict) -> int:
        self.logs.append(record)
        self.last_bases[record["user_id"]] = record["base_card"]
        return len(self.logs)

    def save_rules(self, user_id: int, rules: list[dict]) -> None:
        if user_id not in self.users:
            raise UnknownUser(user_id)
        self.rules[user_id] = [parse_rule(r, i + 1, i) for i, r in enumerate(rules)]
        self.rules_raw[user_id] = list(rules)

    def add_payment(self, payment: Payment) -> None:
        if payment.user_id not in self.users:
            raise UnknownUser(payment.user_id)
        if any(p.payment_id == payment.payment_id for p in self.payments.get(payment.user_id, [])):
            return                                   # 같은 결제를 두 번 보내도 한 번만 반영한다
        rows = self.payments.setdefault(payment.user_id, [])
        rows.append(payment)
        rows.sort(key=lambda p: p.paid_at)
