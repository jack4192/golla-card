from engine.domain import User
from engine.state import UserState
from tests.conftest import USER_CARDS, at, online, pay


def test_달이_바뀌면_실적이_전월_실적이_된다(state):
    state.apply(pay(101, 400_000, when=at(9, 1)))
    state.apply(pay(101, 1_000, when=at(10, 1)))
    assert state.ledger[101].prev_perf == 400_000
    assert state.ledger[101].perf == 1_000


def test_두_달을_건너뛰면_전월_실적은_0이다(state):
    state.apply(pay(101, 400_000, when=at(8, 1)))
    state.apply(pay(101, 1_000, when=at(10, 1)))
    assert state.ledger[101].prev_perf == 0


def test_패턴_이력에는_현장_결제만_들어간다(state):
    state.apply(pay(101, when=at(10, 1)))
    state.apply(online(101, when=at(10, 1)))
    state.apply(pay(101, category="TRANSIT", mode="default_card", channel="transit_nfc", when=at(10, 2)))
    assert sum(state.history.category_counts.values()) == 1


def test_온라인_결제도_쓴_카드의_실적에_그대로_반영된다(state):
    state.apply(online(102, 70_000, at(10, 1)))
    assert state.perf(102) == 70_000


def test_늦게_도착한_지난달_타사_결제는_전월_실적에_더한다(state):
    state.apply(pay(103, 100_000, when=at(9, 30)))
    state.apply(pay(103, 1_000, when=at(10, 1)))
    state.apply(online(103, 50_000, at(9, 30, 23), synced_at=at(10, 1, 6)))
    assert state.ledger[103].prev_perf == 150_000
    assert state.perf(103) == 1_000


def test_첫_달은_혜택을_계산하지_않는다(catalog, params):
    state = UserState(User(1), USER_CARDS, catalog, params, benefit_start="2026-08")
    assert state.apply(pay(101, 300_000, when=at(7, 1))) == 0
    assert state.apply(pay(101, 300_000, when=at(7, 2))) == 0
    state.apply(pay(101, 10_000, when=at(8, 1)))
    assert state.ledger[101].discount == 1_000


def test_타사_결제의_공개_시각(catalog):
    assert online(103, when=at(10, 1), synced_at=at(10, 2, 6)).visible_at == at(10, 2, 6)
    assert pay(103, when=at(10, 1), synced_at=at(10, 2, 6)).visible_at == at(10, 1)
