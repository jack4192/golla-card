"""하루 일정 팝업: 3일마다 카드 추천, 그 외의 날은 일정에 맞는 프로모션 추천 (설계서 v4.1 예시 4)."""

from datetime import datetime, timedelta

import pytest

from engine.benefit_calc import Benefit, Card
from engine.catalog import Catalog
from engine.domain import Merchant, Promotion, ScheduleItem, User, UserCard
from engine.params import Params
from engine.popup import promotion_offers, schedule_popup
from engine.state import UserState
from tests.conftest import KST, at, pay

MEGA, HOLLYS, OTHER = 50, 51, 52


def cafe_catalog() -> Catalog:
    """1: Discount Plan+ 처럼 오전 7시~오후 3시 메가커피 10%(건당 최대 1천 원)
    2: 모두의카드처럼 2만 원 이상 메가커피 5%(건당 최대 3천 원)
    3: KB 국내 1%
    9: 아직 없는 신한카드 (카페 10%) — 카드 추천 후보"""
    cards = {
        1: Card(1, "DP", "SHINHAN", "Discount Plan+", "credit", (), 0, {},
                (Benefit(1, "CAFE", "discount", rate=0.10, max_per_tx=1_000, hours=(7, 15), brands=frozenset({"MEGA"})),)),
        2: Card(2, "MO", "SHINHAN", "모두의카드", "credit", (), 0, {},
                (Benefit(2, "CAFE", "discount", rate=0.05, min_amount=20_000, max_per_tx=3_000,
                         brands=frozenset({"MEGA"})),)),
        3: Card(3, "KA", "KB", "KB ALL", "credit", (), 0, {}, (Benefit(3, "*", "discount", rate=0.01),)),
        9: Card(9, "NEW", "SHINHAN", "새 카페 카드", "credit", (), 0, {}, (Benefit(9, "CAFE", "discount", rate=0.10),)),
    }
    merchants = {MEGA: Merchant(MEGA, "메가MGC커피 역삼점", "CAFE", brand="메가MGC커피", brand_code="MEGA"),
                 HOLLYS: Merchant(HOLLYS, "할리스 역삼점", "CAFE", brand="할리스", brand_code="HOLLYS"),
                 OTHER: Merchant(OTHER, "동네 카페", "CAFE")}
    return Catalog(cards, merchants, {"CAFE": "카페", "REST": "음식점"})


CARDS = [UserCard(201, 1, "SHINHAN", 1), UserCard(202, 2, "SHINHAN", 2), UserCard(203, 3, "KB", 3)]
NOV = (datetime(2026, 10, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))
PROMOS = [Promotion(1, "메가MGC커피", *NOV, frozenset({MEGA}), issuer="SHINHAN", amount=500, kind="event"),
          Promotion(2, "할리스", *NOV, frozenset({HOLLYS}), issuer="SHINHAN", rate=0.10, max_amount=20_000, kind="myshop")]


def coffee(start_hour=14, end_hour=15, amount=6_000, item_id=1):
    return ScheduleItem(item_id, 1, at(10, 7, start_hour), at(10, 7, end_hour), "CAFE", amount)


def state_of(cards=CARDS, payments=()):
    state = UserState(User(1), cards, cafe_catalog(), Params())
    for p in payments:
        state.apply(p)
    state.roll_to("2026-10")
    return state


def test_카페_일정이면_메가커피_행사와_할인_카드를_고른다():
    offers = promotion_offers(state_of(), [coffee()], PROMOS, at(10, 7, 9), Params())
    assert [(o.brand, o.user_card_id, o.promo_value, o.card_value, o.total) for o in offers] == [
        ("메가MGC커피", 201, 500, 600, 1_100),     # 500포인트 + 10% 600원
        ("할리스", 201, 600, 0, 600),              # 할리스는 할인 브랜드가 아님 → 행사 10%만
    ]
    assert offers[0].alternatives == ((202, 500),)  # 모두의카드는 2만 원 미만이라 행사만


def test_신한카드가_없으면_프로모션을_추천하지_않는다():
    kb_only = [UserCard(203, 3, "KB", 1)]
    assert promotion_offers(state_of(kb_only), [coffee()], PROMOS, at(10, 7, 9), Params()) == []


def test_지난_일정과_응모가_필요한_행사는_뺀다():
    past = coffee(8, 9)                                       # 9:30 이후면 끝난 일정 (끝 + 30분)
    assert promotion_offers(state_of(), [past], PROMOS, at(10, 7, 10), Params()) == []
    check = [Promotion(3, "메가MGC커피", *NOV, frozenset({MEGA}), issuer="SHINHAN", amount=500, needs_check=True)]
    assert promotion_offers(state_of(), [coffee()], check, at(10, 7, 9), Params()) == []


def test_3일이_지났으면_카드_추천_아니면_프로모션():
    rows = [pay(203, 30_000, "CAFE", at(9, 10) + timedelta(days=d), merchant=OTHER) for d in range(0, 50)]
    state = state_of(payments=[])
    now = at(10, 7, 9)
    first = schedule_popup(state, rows, [coffee()], [], PROMOS, now, Params())
    assert first["kind"] == "card" and first["recommendation"].card_id == 9
    yesterday = [{"at": now - timedelta(days=1), "card_id": 9}]
    second = schedule_popup(state, rows, [coffee()], yesterday, PROMOS, now, Params())
    assert second["kind"] == "promotion" and [o.brand for o in second["offers"]] == ["메가MGC커피", "할리스"]
    nothing = schedule_popup(state, rows, [], yesterday, PROMOS, now, Params())
    assert nothing["kind"] == "none"


def test_yaml_프로모션을_읽는다():
    from engine import loader
    try:
        catalog = loader.load_catalog()
    except FileNotFoundError:
        pytest.skip("가상 데이터가 없습니다")
    promos = loader.load_popup_promotions(catalog)
    assert len(promos) == 31
    assert sum(p.needs_check for p in promos) == 4
    assert all(p.issuer == "SHINHAN" for p in promos)
    mega = next(p for p in promos if p.brand == "메가MGC커피")
    assert mega.amount == 500 and mega.merchant_ids


# ---------- Task 5: 서비스·API (팝업 저장, 프로모션 카드) ----------
from datetime import date, time

from fastapi.testclient import TestClient

from engine.api import create_app
from engine.domain import RankRequest
from engine.messages import PROMOTION_CARD, RULE
from engine.rules import parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import UnknownUser, UserContext

NOW = at(10, 7, 9)


class PopupStore:
    def __init__(self):
        self.payments = [pay(203, 8_000, "CAFE", at(9, d), merchant=OTHER) for d in range(1, 29)]
        self.rules, self.days, self.recommended, self.logs = [], {}, [], []
        self.recommended = [{"at": NOW - timedelta(days=1), "card_id": 9}]    # 어제 카드 추천 → 오늘은 프로모션 날

    def user(self, user_id):
        if user_id != 1:
            raise UnknownUser(user_id)
        return User(1)

    def context(self, user_id, when):
        return UserContext(self.user(user_id), CARDS, [p for p in self.payments if p.visible_at <= when], self.rules,
                           schedules=list(self.days.get(when.date(), [])), last_base=getattr(self, "last_base", None))

    def put_schedule(self, user_id, day, items):
        self.days[day] = list(items)

    def schedules(self, user_id, day):
        return list(self.days.get(day, []))

    def recommendation_history(self, user_id):
        return list(self.recommended)

    def log_card_recommendation(self, record):
        self.recommended.append(record)

    def log_recommendation(self, record):
        self.logs.append(record)
        return len(self.logs)

    def save_rules(self, user_id, rules):
        self.rules = [parse_rule(r, i + 1, i) for i, r in enumerate(rules)]

    def add_payment(self, payment):
        self.payments.append(payment)


@pytest.fixture
def popup_svc(priors):
    store = PopupStore()
    service = PlacementService(store, PlacementEngine(cafe_catalog(), priors, Params(base_order="first_tier")))
    service.popup_promotions = PROMOS
    service.put_schedule(1, date(2026, 10, 7), [{"start": time(14), "end": time(15), "category": "CAFE",
                                                 "amount": 6_000}], NOW)
    return service


def test_팝업_뒤_일정_시간에는_프로모션_카드가_1순위(popup_svc):
    popup = popup_svc.schedule_popup(1, NOW)
    assert popup["kind"] == "promotion"
    assert [(o["brand"], o["user_card_id"], o["total"]) for o in popup["offers"]] == [("메가MGC커피", 201, 1_100),
                                                                                    ("할리스", 201, 600)]
    _, result = popup_svc.rank(RankRequest(1, at(10, 7, 14, 10)))
    assert (result.cards[0].user_card_id, result.display_count, result.reason_code) == (201, 1, PROMOTION_CARD)
    assert "메가MGC커피" in result.cards[0].message and "1,100원" in result.cards[0].message
    # 결제 화면 예시 거래: 일정에 브랜드가 없어도(백엔드는 brand 를 보내지 않는다) 행사 가게로 계산해야 문구와 맞는다
    assert (result.example["basis"], result.example["merchant_id"], result.example["name"]) == ("schedule", MEGA, "메가MGC커피")


def test_일정_시간_밖에서는_평소_계산(popup_svc):
    popup_svc.schedule_popup(1, NOW)
    _, result = popup_svc.rank(RankRequest(1, at(10, 7, 11)))
    assert result.reason_code != PROMOTION_CARD


def test_프로모션_카드가_제외_규칙이면_다음_신한카드(popup_svc):
    popup_svc.store.save_rules(1, [{"rule_type": "exclude", "target": {"user_card_ids": [201]}}])
    popup_svc.schedule_popup(1, NOW)
    _, result = popup_svc.rank(RankRequest(1, at(10, 7, 14, 10)))
    assert (result.cards[0].user_card_id, result.reason_code) == (202, PROMOTION_CARD)


def test_고정_규칙이_프로모션_카드보다_우선(popup_svc):
    popup_svc.store.save_rules(1, [{"rule_type": "force", "target": {"user_card_ids": [203]}}])
    popup_svc.schedule_popup(1, NOW)
    _, result = popup_svc.rank(RankRequest(1, at(10, 7, 14, 10)))
    assert (result.cards[0].user_card_id, result.reason_code) == (203, RULE)


def test_같은_업종_결제가_있으면_프로모션_카드를_끈다(popup_svc):
    popup_svc.schedule_popup(1, NOW)
    popup_svc.store.add_payment(pay(201, 6_000, "CAFE", at(10, 7, 14, 5), merchant=MEGA))
    _, result = popup_svc.rank(RankRequest(1, at(10, 7, 14, 10)))
    assert result.reason_code != PROMOTION_CARD


def test_schedule_popup_api(popup_svc):
    with TestClient(create_app(popup_svc)) as c:
        r = c.post("/internal/users/1/schedule-popup", json={"at": NOW.isoformat()}).json()
        s = c.get("/internal/users/1/strategy", params={"at": NOW.isoformat()}).json()
    assert r["kind"] == "promotion" and r["offers"][0]["window_from"].startswith("2026-10-07T13:30")
    assert "strategy" in s


def test_제외_규칙의_카드는_팝업에도_보여주지_않는다(popup_svc):
    popup_svc.store.save_rules(1, [{"rule_type": "exclude", "target": {"user_card_ids": [201]}}])
    popup = popup_svc.schedule_popup(1, NOW)
    assert popup["offers"] and all(o["user_card_id"] != 201 for o in popup["offers"])


def test_프로모션_카드를_보여줘도_기본_카드_변경으로_치지_않는다(popup_svc):
    from engine.messages import BASE_CHANGED
    _, before = popup_svc.rank(RankRequest(1, at(10, 7, 11)))
    popup_svc.store.last_base = before.base_card
    popup_svc.schedule_popup(1, NOW)
    _, promo = popup_svc.rank(RankRequest(1, at(10, 7, 14, 10)))
    assert promo.reason_code == PROMOTION_CARD and promo.base_card == before.base_card
