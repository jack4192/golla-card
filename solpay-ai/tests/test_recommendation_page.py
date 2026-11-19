"""맞춤 추천 페이지 (설계서 2026-11-19-recommendation-page-design.md)."""

from datetime import datetime, timedelta, timezone

from engine.benefit_calc import Benefit, Card
from engine.catalog import Catalog
from engine.domain import Merchant, Promotion, ScheduleItem, User, UserCard
from engine.params import Params
from engine.page import CYCLE, FALLBACK, is_card_day, pattern_items, today_items, usual_brand
from engine.state import UserState
from tests.conftest import KST, at, pay

MEGA, OTHER, STAR, GS = 50, 52, 53, 54
NOW = at(10, 7, 9)                                   # 2026-10-07(수) 09:00


def page_catalog() -> Catalog:
    """보유 1: 메가커피 10%(7~15시, 건당 1천 원) / 보유 3: KB 1%
    후보 9: 스타벅스·메가커피 10%(건당 1천 원, 전월 30만 원 이상), 연회비 12,000원
    후보 8: GS 주유 5%, 연회비 0원"""
    cards = {
        1: Card(1, "DP", "SHINHAN", "Discount Plan+", "credit", (), 0, {},
                (Benefit(1, "CAFE", "discount", rate=0.10, max_per_tx=1_000, hours=(7, 15), brands=frozenset({"MEGA"})),)),
        3: Card(3, "KA", "KB", "KB ALL", "credit", (), 0, {}, (Benefit(3, "*", "discount", rate=0.01),)),
        9: Card(9, "NEW_CAFE", "SHINHAN", "새 카페 카드", "credit", (), 12_000, {},
                (Benefit(9, "CAFE", "discount", rate=0.10, max_per_tx=1_000, min_prev=300_000,
                         brands=frozenset({"STAR", "MEGA"}), name="카페 10% 할인"),)),
        8: Card(8, "NEW_FUEL", "SHINHAN", "새 주유 카드", "credit", (), 0, {},
                (Benefit(8, "FUEL", "discount", rate=0.05, brands=frozenset({"GS"}), name="주유 5% 할인"),)),
    }
    merchants = {MEGA: Merchant(MEGA, "메가MGC커피 역삼점", "CAFE", brand="메가MGC커피", brand_code="MEGA"),
                 OTHER: Merchant(OTHER, "동네 카페", "CAFE"),
                 STAR: Merchant(STAR, "스타벅스 역삼점", "CAFE", brand="스타벅스", brand_code="STAR"),
                 GS: Merchant(GS, "GS칼텍스 역삼", "FUEL", brand="GS칼텍스", brand_code="GS")}
    return Catalog(cards, merchants, {"CAFE": "카페", "FUEL": "주유"})


CARDS = [UserCard(201, 1, "SHINHAN", 1), UserCard(203, 3, "KB", 2)]
OCT = (datetime(2026, 10, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))
PROMOS = [Promotion(1, "메가MGC커피", *OCT, frozenset({MEGA}), issuer="SHINHAN", amount=500, kind="event",
                    title="메가커피 500원 할인")]


def coffee(start_hour=14, amount=6_000, item_id=1):
    return ScheduleItem(item_id, 1, at(10, 7, start_hour), at(10, 7, start_hour + 1), "CAFE", amount)


def habit_payments():
    """최근 30일: 스타벅스 5번(9시, 4,000~6,000원), GS 주유 3번(19시, 5만 원). 30일 전 결제·온라인 결제는 세지 않는다."""
    rows = [pay(203, a, "CAFE", at(10, d, 9), merchant=STAR) for d, a in zip(range(1, 6), (4_000, 4_500, 5_000, 5_500, 6_000))]
    rows += [pay(203, 50_000, "FUEL", at(10, d, 19), merchant=GS) for d in (2, 4, 6)]
    rows += [pay(203, 9_000, "FUEL", at(9, 1, 19), merchant=GS) for _ in range(5)]          # 30일 전
    rows += [pay(203, 7_000, "CAFE", at(10, 3, 12), merchant=MEGA, channel="online")]       # 현장 결제 아님
    return rows


def state_of(cards=CARDS, payments=()):
    state = UserState(User(1), cards, page_catalog(), Params())
    for p in payments:
        state.apply(p)
    state.roll_to("2026-10")
    return state


# ---------- Task 1: 오늘 볼 항목과 카드날 ----------
def test_자주_간_브랜드():
    assert usual_brand(habit_payments(), page_catalog(), "CAFE", NOW) == "STAR"
    assert usual_brand([], page_catalog(), "CAFE", NOW) is None


def test_평소_소비_항목은_상위_업종_중앙값():
    items = pattern_items(habit_payments(), page_catalog(), NOW, 1)
    assert [(i.item_id, i.category, i.amount, i.start, i.end) for i in items] == [
        (-1, "CAFE", 5_000, at(10, 7, 9), at(10, 7, 10)),
        (-2, "FUEL", 50_000, at(10, 7, 19), at(10, 7, 20)),
    ]


def test_지난_시각이면_지금부터_1시간():
    items = pattern_items(habit_payments(), page_catalog(), at(10, 7, 10, 25), 1)
    assert (items[0].start, items[0].end) == (at(10, 7, 10, 25), at(10, 7, 11, 25))


def test_일정이_있으면_일정():
    assert today_items([coffee()], habit_payments(), page_catalog(), NOW, Params(), 1) == ("schedule", [coffee()])


def test_남은_일정이_없으면_평소_소비():
    source, items = today_items([coffee(7)], habit_payments(), page_catalog(), at(10, 7, 9), Params(), 1)
    assert source == "pattern" and [i.item_id for i in items] == [-1, -2]


def test_카드날():
    p = Params()
    assert is_card_day([], NOW, p)
    assert not is_card_day([{"at": NOW - timedelta(days=2), "card_id": 9, "trigger": CYCLE}], NOW, p)
    assert is_card_day([{"at": NOW - timedelta(days=3), "card_id": 9, "trigger": CYCLE}], NOW, p)


def test_오늘_기록과_대신_보여준_카드는_세지_않는다():
    p = Params()
    assert is_card_day([{"at": NOW - timedelta(hours=1), "card_id": 9, "trigger": CYCLE}], NOW, p)
    history = [{"at": NOW - timedelta(days=4), "card_id": 9, "trigger": CYCLE},
               {"at": NOW - timedelta(days=1), "card_id": 8, "trigger": FALLBACK}]
    assert is_card_day(history, NOW, p)


def test_UTC_기록도_KST_날짜로_센다():
    # KST 10/4 23:30 = UTC 10/4 14:30. KST 기준 3일 전이므로 카드날
    utc = datetime(2026, 10, 4, 14, 30, tzinfo=timezone.utc)
    assert is_card_day([{"at": utc, "card_id": 9, "trigger": CYCLE}], NOW, Params())
    # KST 10/5 00:30 = UTC 10/4 15:30. KST 기준 2일 전이므로 카드날 아님
    utc2 = datetime(2026, 10, 4, 15, 30, tzinfo=timezone.utc)
    assert not is_card_day([{"at": utc2, "card_id": 9, "trigger": CYCLE}], NOW, Params())


# ---------- Task 2: 카드 고르기 ----------
from engine.page import FIRST_MONTH_NOTE, pick_card


def test_일정에서_더_주는_카드를_고른다():
    pick = pick_card(state_of(), habit_payments(), [coffee()], [], NOW, Params())
    assert (pick.card_id, pick.card_name, pick.annual_fee, pick.gain) == (9, "새 카페 카드", 12_000, 540)
    item = pick.items[0]
    assert (item.brand, item.benefit, item.min_prev, item.value, item.owned_value) == ("STAR", "카페 10% 할인", 300_000, 600, 60)
    assert pick.first_month_note == FIRST_MONTH_NOTE


def test_평소_소비_항목이면_주유_카드():
    items = pattern_items(habit_payments(), page_catalog(), NOW, 1)
    pick = pick_card(state_of(), habit_payments(), items, [], NOW, Params())
    assert (pick.card_id, pick.gain, pick.first_month_note) == (8, 2_000, None)       # 2,500 − KB 500
    assert [i.category for i in pick.items] == ["FUEL"]


def test_이력이_없으면_카드가_주는_브랜드_중_더_받는_곳():
    pick = pick_card(state_of(), [], [coffee()], [], NOW, Params())
    assert (pick.card_id, pick.items[0].brand, pick.gain) == (9, "STAR", 540)        # 메가커피는 보유 카드도 600원


def test_더_주는_카드가_없으면_None():
    # 카페 카드 9 는 5일 전에 추천해 빠지고, 남은 후보 8 은 카페 혜택이 없다
    assert pick_card(state_of(), [], [coffee()], [{"at": NOW - timedelta(days=5), "card_id": 9}], NOW, Params()) is None


def test_30일_안에_추천한_카드는_빼고_오늘_기록은_막지_않는다():
    old = [{"at": NOW - timedelta(days=5), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], old, NOW, Params()) is None
    today = [{"at": NOW - timedelta(hours=1), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], today, NOW, Params()).card_id == 9


def test_삭제한_보유_카드는_비교에서_뺀다():
    cards = [UserCard(201, 1, "SHINHAN", 1), UserCard(203, 3, "KB", 2, excluded=True)]
    pick = pick_card(state_of(cards), habit_payments(), [coffee()], [], NOW, Params())
    assert (pick.items[0].owned_value, pick.gain) == (0, 600)


# ---------- Task 3: 표시 규칙과 페이지 ----------
from engine.page import build_page

YESTERDAY = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE}]   # 어제 카드날 → 오늘은 카드날 아님


def test_카드날은_두_탭():
    page = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params())
    assert (page.card_day, page.tabs, page.trigger, page.card.card_id) == (True, ["card", "merchant"], CYCLE, 9)
    assert [(o.brand, o.user_card_id, o.total) for o in page.offers] == [("메가MGC커피", 201, 1_100)]


def test_카드날_아니면_가맹점_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, Params())
    assert (page.card_day, page.tabs, page.card, page.trigger) == (False, ["merchant"], None, None)


def test_프로모션이_없으면_카드_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, [], NOW, Params())
    assert (page.tabs, page.trigger, page.card.card_id) == (["card"], FALLBACK, 9)


def test_둘_다_없으면_빈_탭():
    blocked = YESTERDAY + [{"at": NOW - timedelta(days=2), "card_id": 9, "trigger": FALLBACK}]
    page = build_page(state_of(), [], [coffee()], blocked, [], NOW, Params())
    assert page.tabs == [] and page.card is None


def test_같은_행사가_두_번_있어도_한_번():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS + PROMOS, NOW, Params())
    assert len(page.offers) == 1


def test_신한카드가_없으면_카드_탭만():
    kb_only = [UserCard(203, 3, "KB", 1)]
    page = build_page(state_of(kb_only), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, Params())
    assert page.tabs == ["card"]


def test_일정이_없으면_평소_소비로_행사와_카드():
    # 평소 소비 카페 항목(09~10시, 5,000원)에 메가커피 행사: 500 + 보유 1 메가 10% 500 = 1,000원
    page = build_page(state_of(), habit_payments(), [], [], PROMOS, NOW, Params())
    assert page.source == "pattern" and page.card.card_id == 8
    assert [(o.item_id, o.brand, o.total) for o in page.offers] == [(-1, "메가MGC커피", 1_000)]


def test_to_dict_형식():
    d = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params()).to_dict(page_catalog(), Params())
    assert d["tabs"] == ["card", "merchant"] and d["source"] == "schedule"
    assert d["card"]["items"][0]["category_name"] == "카페" and d["card"]["items"][0]["gain"] == 540
    assert d["card"]["items"][0]["start"] == "2026-10-07T14:00:00+09:00"
    assert d["merchant"]["offers"][0]["category_name"] == "카페" and d["merchant"]["offers"][0]["total"] == 1_100


# ---------- Task 5: 서비스·API ----------
import json
from datetime import date, time

import pytest
from fastapi.testclient import TestClient

from engine.api import create_app
from engine.priors import Priors
from engine.service import PlacementEngine, PlacementService
from engine.store import UnknownUser, UserContext


class PageStore:
    def __init__(self):
        self.payments, self.rules, self.days, self.recommended, self.logs = habit_payments(), [], {}, [], []
        self.promotions = []

    def user(self, user_id):
        if user_id != 1:
            raise UnknownUser(user_id)
        return User(1)

    def context(self, user_id, when):
        return UserContext(self.user(user_id), CARDS, [p for p in self.payments if p.visible_at <= when], self.rules,
                           schedules=list(self.days.get(when.date(), [])), promotions=list(self.promotions))

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


@pytest.fixture
def page_svc():
    service = PlacementService(PageStore(), PlacementEngine(page_catalog(), Priors({}, {}), Params(base_order="first_tier")))
    service.popup_promotions = PROMOS
    return service


def _save_coffee(svc, hour=14):
    svc.put_schedule(1, date(2026, 10, 7), [{"start": time(hour), "end": time(hour + 1), "category": "CAFE",
                                             "amount": 6_000}], NOW)


def test_서비스_카드날_두_탭과_기록(page_svc):
    _save_coffee(page_svc)
    page = page_svc.recommendation_page(1, NOW)
    assert page["tabs"] == ["card", "merchant"] and page["copy_source"] == "template" and page["cached"] is False
    assert page["day"] == "2026-10-07" and page["card"]["copy"]["title"]
    assert [(r["card_id"], r["trigger"]) for r in page_svc.store.recommended] == [(9, CYCLE)]
    assert (1, date(2026, 10, 7)) in page_svc.popups                      # 일정 행사는 결제 화면 1순위에 쓴다


def test_같은_날_다시_부르면_그대로(page_svc):
    from engine.chat.page_copy import PageCopyWriter
    from tests.test_page_copy import GOOD, FakeClient
    _save_coffee(page_svc)
    client = FakeClient([json.dumps(GOOD, ensure_ascii=False)])
    first = page_svc.recommendation_page(1, NOW, PageCopyWriter(client))
    second = page_svc.recommendation_page(1, NOW + timedelta(hours=2), PageCopyWriter(client))
    assert second["cached"] is True and second["card"] == first["card"] and len(client.requests) == 1
    assert len(page_svc.store.recommended) == 1


def test_일정을_바꾸면_다시_계산하고_같은_카드는_한_번만_기록(page_svc):
    _save_coffee(page_svc)
    page_svc.recommendation_page(1, NOW)
    _save_coffee(page_svc, 10)
    again = page_svc.recommendation_page(1, NOW)
    assert again["cached"] is False and again["card_day"] is True and again["card"]["card_id"] == 9
    assert len(page_svc.store.recommended) == 1


def test_평소_소비_행사는_결제_화면에_쓰지_않는다(page_svc):
    page = page_svc.recommendation_page(1, NOW)
    assert page["source"] == "pattern" and page["merchant"]["offers"][0]["item_id"] == -1
    assert (1, date(2026, 10, 7)) not in page_svc.popups


def test_대신_보여준_카드_기록(page_svc):
    page_svc.store.recommended = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE}]
    page_svc.popup_promotions = []
    _save_coffee(page_svc)
    page = page_svc.recommendation_page(1, NOW)
    assert page["tabs"] == ["card"] and page_svc.store.recommended[-1]["trigger"] == FALLBACK


def test_추천_페이지_API(page_svc):
    from tests.test_page_copy import GOOD, FakeClient
    _save_coffee(page_svc)
    with TestClient(create_app(page_svc, chat_client=FakeClient([json.dumps(GOOD, ensure_ascii=False)]))) as c:
        r = c.post("/internal/users/1/recommendation-page", json={"at": NOW.isoformat()})
        missing = c.post("/internal/users/2/recommendation-page", json={"at": NOW.isoformat()})
        c.delete("/internal/users/1/schedules/2026-10-07")
        after = c.post("/internal/users/1/recommendation-page", json={"at": NOW.isoformat()}).json()
    body = r.json()
    assert r.status_code == 200 and body["copy_source"] == "llm" and body["card"]["copy"] == GOOD["card"]
    assert body["merchant"]["offers"][0]["copy"] == GOOD["merchant"]["offers"][0]
    assert missing.status_code == 404
    assert after["cached"] is False and after["source"] == "pattern"


# ---------- 최종 검토 수정 ----------
import os
import sys

from engine.page import merge_promotions

NEEDS_CHECK = dict(issuer="SHINHAN", amount=5_000, title="신규 정기결제 캐시백")


def test_확인이_필요한_행사는_팀_DB_사본도_뺀다():
    team = [Promotion(7, "메가MGC커피", *OCT, frozenset({MEGA}), **NEEDS_CHECK)]
    popup = [Promotion(7, "메가MGC커피", *OCT, frozenset({MEGA}), needs_check=True, **NEEDS_CHECK)] + PROMOS
    merged = merge_promotions(team, popup)
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, merged, NOW, Params())
    assert [o.promotion_id for o in page.offers] == [1]


def test_서비스도_확인이_필요한_행사를_뺀다(page_svc):
    page_svc.store.promotions = [Promotion(7, "메가MGC커피", *OCT, frozenset({MEGA}), **NEEDS_CHECK)]
    page_svc.popup_promotions = [Promotion(7, "메가MGC커피", *OCT, frozenset({MEGA}), needs_check=True, **NEEDS_CHECK)] + PROMOS
    _save_coffee(page_svc)
    page = page_svc.recommendation_page(1, NOW)
    assert [o["promotion_id"] for o in page["merchant"]["offers"]] == [1]


def test_탭이_비면_OpenAI를_부르지_않는다(page_svc):
    from engine.chat.page_copy import PageCopyWriter
    from tests.test_page_copy import FakeClient
    page_svc.store.recommended = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE},
                                  {"at": NOW - timedelta(days=2), "card_id": 9, "trigger": FALLBACK}]
    page_svc.popup_promotions = []
    _save_coffee(page_svc)
    client = FakeClient([])
    page = page_svc.recommendation_page(1, NOW, PageCopyWriter(client))
    assert page["tabs"] == [] and page["copy_source"] == "none" and client.requests == []


def test_평가_스크립트는_개인_DB를_쓰지_않는다(monkeypatch):
    import engine.api
    from evaluation import page_eval

    class Stop(Exception):
        pass

    seen = {}

    def fake_build():
        seen["store"] = os.environ.get("SOLPAY_STORE")
        raise Stop

    monkeypatch.setenv("SOLPAY_STORE", "db")
    monkeypatch.setattr(engine.api, "build_service", fake_build)
    monkeypatch.setattr(sys, "argv", ["page_eval"])
    with pytest.raises(Stop):
        page_eval.main()
    assert seen["store"] == "teamdb"


def test_혜택_종류를_함께_준다():
    d = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params()).to_dict(page_catalog(), Params())
    assert d["card"]["items"][0]["benefit_type"] == "discount"
    assert d["merchant"]["offers"][0]["card_benefit_type"] == "discount"


def test_개발용_테스트_화면(page_svc):
    with TestClient(create_app(page_svc, chat_client=None)) as c:
        r = c.get("/dev")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
    assert '"CAFE": "카페"' in r.text and "/*CATEGORIES*/" not in r.text
    assert "recommendation-page" in r.text and "/internal/chat" in r.text and "/internal/rank" in r.text
    assert "왜 이 카드가 1순위야?" in r.text


# ---------- 작은 금액은 숨기기 (2026-11-19 사용자 결정: 500원 미만) ----------
def test_작은_금액이면_금액을_숨긴다():
    small = build_page(state_of(), habit_payments(), [coffee(amount=4_000)], [], PROMOS, NOW, Params())
    assert small.card.gain == 360                                   # 스타벅스 4,000원: 새 카드 400 − KB 40
    assert small.to_dict(page_catalog(), Params())["card"]["show_amount"] is False
    assert small.to_dict(page_catalog(), Params(page_amount_min=0))["card"]["show_amount"] is True
    big = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, Params())
    assert big.to_dict(page_catalog(), Params())["card"]["show_amount"] is True     # 540원
