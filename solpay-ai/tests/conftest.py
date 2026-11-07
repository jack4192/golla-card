from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from engine.benefit_calc import Benefit, Card
from engine.catalog import Catalog
from engine.domain import Merchant, Payment, User, UserCard
from engine.params import Params
from engine.priors import Priors
from engine.state import UserState

KST = ZoneInfo("Asia/Seoul")


def benefit(i, category, rate=None, amount=None, min_amount=0, group="G", **kw):
    return Benefit(i, category, kw.pop("type", "discount"), rate, kw.pop("rate_by_tier", None), amount, min_amount,
                   kw.pop("monthly_count", None), group, **kw)


def card(card_id, name, issuer, tiers, benefits):
    return Card(card_id, f"C{card_id}", issuer, name, "credit", ("credit",), 0, {"G": tiers}, tuple(benefits))


@pytest.fixture
def catalog() -> Catalog:
    cards = {
        1: card(1, "생활(가칭)", "SHINHAN", ((300_000, 10_000), (500_000, 20_000)), [benefit(1, "CAFE", rate=0.10)]),
        2: card(2, "외식(가칭)", "SHINHAN", ((300_000, 20_000),), [benefit(2, "REST", rate=0.10, min_amount=10_000)]),
        3: card(3, "국민 교통(가칭)", "KB", ((200_000, 5_000),), [benefit(3, "TRANSIT", rate=0.05)]),
        4: card(4, "무실적(가칭)", "SHINHAN", ((0, None),), [benefit(4, "*", rate=0.005)]),
    }
    merchants = {
        10: Merchant(10, "카페", "CAFE", 37.5000, 127.0000),
        11: Merchant(11, "식당", "REST", 37.50018, 127.0000),      # 카페에서 20m
        12: Merchant(12, "먼 식당", "REST", 37.5100, 127.0000),
        20: Merchant(20, "지하철", "TRANSIT", is_online=True),
    }
    return Catalog(cards, merchants, {"CAFE": "카페", "REST": "음식점", "TRANSIT": "버스·지하철", "CVS": "편의점"})


@pytest.fixture
def params() -> Params:
    return Params()


@pytest.fixture
def priors() -> Priors:
    return Priors({"0|3": {"REST": 60, "CAFE": 40}, "0|1": {"CAFE": 100}},
                  {"REST": [9000, 12000, 15000], "CAFE": [4000, 5000, 6000]})


USER_CARDS = [UserCard(101, 1, "SHINHAN", 1), UserCard(102, 2, "SHINHAN", 2), UserCard(103, 3, "KB", 3)]


@pytest.fixture
def cards() -> list[UserCard]:
    return list(USER_CARDS)


@pytest.fixture
def consent_state(catalog, params) -> UserState:
    return UserState(User(1, True, True), USER_CARDS, catalog, params)


@pytest.fixture
def no_consent_state(catalog, params) -> UserState:
    return UserState(User(2), USER_CARDS, catalog, params)


def at(month=10, day=7, hour=12, minute=0) -> datetime:     # 2026-10-07 수요일
    return datetime(2026, month, day, hour, minute, tzinfo=KST)


_seq = iter(range(1, 1_000_000))


def pay(card=101, amount=10_000, category="CAFE", when=None, mode="manual", channel="offline_qr", merchant=10,
        user=1, synced_at=None) -> Payment:
    return Payment(next(_seq), user, card, merchant, category, channel, mode, amount, when or at(), synced_at)


def online(card=101, amount=10_000, when=None, synced_at=None) -> Payment:
    return pay(card, amount, "ONLINE", when, "manual", "online", None, synced_at=synced_at)


def fill_previous_month(state: UserState, per_card: dict[int, int], month=9, place: int = 0) -> None:
    """지난달 실적을 만든다. 달을 넘기면 prev_perf 가 된다."""
    for uc, amount in per_card.items():
        state.apply(online(uc, amount, at(month, 15)))
    if place:
        state.apply(pay(101, place, "CVS", at(month, 16)))
    state.roll_to(f"2026-{month + 1:02d}")


__all__ = ["at", "pay", "online", "fill_previous_month", "timedelta"]
