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
    return Benefit(i, category, kw.pop("type", "discount"), rate=rate, amount=amount, min_amount=min_amount,
                   cap_group=group, **kw)


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
        10: Merchant(10, "카페 강남점", "CAFE", 37.5000, 127.0000, brand="카페"),
        11: Merchant(11, "식당", "REST", 37.50018, 127.0000),      # 카페에서 20m
        12: Merchant(12, "먼 식당", "REST", 37.5100, 127.0000),
        20: Merchant(20, "지하철", "TRANSIT", is_online=True),
    }
    return Catalog(cards, merchants, {"CAFE": "카페", "REST": "음식점", "TRANSIT": "버스·지하철", "CVS": "편의점"})


@pytest.fixture
def params() -> Params:
    """단위 테스트는 전략 A(모든 첫 구간 먼저)로 고정한다. 자동 선택은 test_strategy.py 에서 따로 본다.
    기존 테스트는 v3 결정(점수에 실적 가치·프로모션, 150원 교체, 두 장, 사용자 카드 순서, 구간 지키기 끔)을 확인한다.
    v4.1 결정은 tests/test_v41.py 에서 Params() 기본값으로 본다."""
    return Params(base_order="first_tier", **V3)


V3 = dict(engine="v3", first_tier_order="user", hold_tiers=False, hold_worth_check=False, max_display=2)


@pytest.fixture
def priors() -> Priors:
    return Priors({"0|3": {"REST": 60, "CAFE": 40}, "0|1": {"CAFE": 100}},
                  {"REST": 12000, "CAFE": 5000})


USER_CARDS = [UserCard(101, 1, "SHINHAN", 1), UserCard(102, 2, "SHINHAN", 2), UserCard(103, 3, "KB", 3)]


@pytest.fixture
def cards() -> list[UserCard]:
    return list(USER_CARDS)


@pytest.fixture
def state(catalog, params) -> UserState:
    return UserState(User(1), USER_CARDS, catalog, params)


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
