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
# 1년 계산을 끈 값: 오늘 더 받는 금액으로만 고르는 이전 규칙 (이력이 짧을 때도 이 규칙). 1년 이득순은 파일 끝에서 본다
TODAY = Params(page_yearly=False)


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


def state_of(cards=CARDS, payments=(), catalog=None):
    state = UserState(User(1), cards, catalog or page_catalog(), Params())
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
    pick = pick_card(state_of(), habit_payments(), [coffee()], [], NOW, TODAY)
    assert (pick.card_id, pick.card_name, pick.annual_fee, pick.gain) == (9, "새 카페 카드", 12_000, 540)
    item = pick.items[0]
    assert (item.brand, item.benefit, item.min_prev, item.value, item.owned_value) == ("STAR", "카페 10% 할인", 300_000, 600, 60)
    assert pick.first_month_note == FIRST_MONTH_NOTE


def test_평소_소비_항목이면_주유_카드():
    items = pattern_items(habit_payments(), page_catalog(), NOW, 1)
    pick = pick_card(state_of(), habit_payments(), items, [], NOW, TODAY)
    assert (pick.card_id, pick.gain, pick.first_month_note) == (8, 2_000, None)       # 2,500 − KB 500
    assert [i.category for i in pick.items] == ["FUEL"]


def test_이력이_없으면_카드가_주는_브랜드_중_더_받는_곳():
    pick = pick_card(state_of(), [], [coffee()], [], NOW, TODAY)
    assert (pick.card_id, pick.items[0].brand, pick.gain) == (9, "STAR", 540)        # 메가커피는 보유 카드도 600원


def test_더_주는_카드가_없으면_None():
    # 카페 카드 9 는 5일 전에 추천해 빠지고, 남은 후보 8 은 카페 혜택이 없다
    assert pick_card(state_of(), [], [coffee()], [{"at": NOW - timedelta(days=5), "card_id": 9}], NOW, TODAY) is None


def test_2주_안에_추천한_카드는_빼고_오늘_기록은_막지_않는다():
    old = [{"at": NOW - timedelta(days=5), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], old, NOW, TODAY) is None
    today = [{"at": NOW - timedelta(hours=1), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], today, NOW, TODAY).card_id == 9


def test_같은_카드는_2주가_지나면_다시_추천한다():
    # 2026-11-21 사용자 결정: 같은 카드를 다시 추천하지 않는 기간 30일 → 2주
    assert Params().recommend_same_card_days == 14
    ago = lambda days: [{"at": NOW - timedelta(days=days), "card_id": 9, "trigger": CYCLE}]
    assert pick_card(state_of(), habit_payments(), [coffee()], ago(13), NOW, TODAY) is None
    assert pick_card(state_of(), habit_payments(), [coffee()], ago(14), NOW, TODAY).card_id == 9


def test_삭제한_보유_카드는_비교에서_뺀다():
    cards = [UserCard(201, 1, "SHINHAN", 1), UserCard(203, 3, "KB", 2, excluded=True)]
    pick = pick_card(state_of(cards), habit_payments(), [coffee()], [], NOW, TODAY)
    assert (pick.items[0].owned_value, pick.gain) == (0, 600)


# ---------- Task 3: 표시 규칙과 페이지 ----------
from engine.page import build_page

YESTERDAY = [{"at": NOW - timedelta(days=1), "card_id": 8, "trigger": CYCLE}]   # 어제 카드날 → 오늘은 카드날 아님


def test_카드날은_두_탭():
    page = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, TODAY)
    assert (page.card_day, page.tabs, page.trigger, page.card.card_id) == (True, ["card", "merchant"], CYCLE, 9)
    assert [(o.brand, o.user_card_id, o.total) for o in page.offers] == [("메가MGC커피", 201, 1_100)]


def test_카드날_아니면_가맹점_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, TODAY)
    assert (page.card_day, page.tabs, page.card, page.trigger) == (False, ["merchant"], None, None)


def test_프로모션이_없으면_카드_탭만():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, [], NOW, TODAY)
    assert (page.tabs, page.trigger, page.card.card_id) == (["card"], FALLBACK, 9)


def test_둘_다_없으면_빈_탭():
    blocked = YESTERDAY + [{"at": NOW - timedelta(days=2), "card_id": 9, "trigger": FALLBACK}]
    page = build_page(state_of(), [], [coffee()], blocked, [], NOW, TODAY)
    assert page.tabs == [] and page.card is None


def test_같은_행사가_두_번_있어도_한_번():
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, PROMOS + PROMOS, NOW, TODAY)
    assert len(page.offers) == 1


def test_신한카드가_없으면_카드_탭만():
    kb_only = [UserCard(203, 3, "KB", 1)]
    page = build_page(state_of(kb_only), habit_payments(), [coffee()], YESTERDAY, PROMOS, NOW, TODAY)
    assert page.tabs == ["card"]


def test_일정이_없으면_평소_소비로_행사와_카드():
    # 평소 소비 카페 항목(09~10시, 5,000원)에 메가커피 행사: 500 + 보유 1 메가 10% 500 = 1,000원
    page = build_page(state_of(), habit_payments(), [], [], PROMOS, NOW, TODAY)
    assert page.source == "pattern" and page.card.card_id == 8
    assert [(o.item_id, o.brand, o.total) for o in page.offers] == [(-1, "메가MGC커피", 1_000)]


def test_to_dict_형식():
    d = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, TODAY).to_dict(page_catalog(), TODAY)
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
    service = PlacementService(PageStore(), PlacementEngine(page_catalog(), Priors({}, {}), Params(base_order="first_tier", page_yearly=False)))
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
    page = build_page(state_of(), habit_payments(), [coffee()], YESTERDAY, merged, NOW, TODAY)
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
    d = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, TODAY).to_dict(page_catalog(), TODAY)
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
    small = build_page(state_of(), habit_payments(), [coffee(amount=4_000)], [], PROMOS, NOW, TODAY)
    assert small.card.gain == 360                                   # 스타벅스 4,000원: 새 카드 400 − KB 40
    assert small.to_dict(page_catalog(), TODAY)["card"]["show_amount"] is False
    assert small.to_dict(page_catalog(), TODAY.with_(page_amount_min=0))["card"]["show_amount"] is True
    big = build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, TODAY)
    assert big.to_dict(page_catalog(), TODAY)["card"]["show_amount"] is True     # 540원


# ---------- 1년 이득순 (2026-11-21 사용자 결정: 오늘 더 주는 카드 중 지난 1년 소비로 가장 이득인 카드) ----------
def year_payments():
    """8~10월 KB 로: 스타벅스 10,000원을 달마다 20번(10월은 5번) + 마트 20만 원, 10월 6일 GS 주유 5만 원.
    1년 계산(첫 달 8월은 실적만, 9~10월 두 달): 보유 카드로 7,000원.
    새 카페 카드: KB 대신 썼다면 25,000원 → 16,000원 이득(연회비 2개월분 2,000원 뺌). 함께 쓰면 실적을 못 채워 −2,000원.
    새 주유 카드: 주유 한 번에 2,000원 더 (연회비 없음)."""
    rows = []
    for month, days in ((8, range(1, 21)), (9, range(1, 21)), (10, range(1, 6))):
        rows += [pay(203, 10_000, "CAFE", at(month, d, 9), merchant=STAR) for d in days]
        rows.append(pay(203, 200_000, "MART", at(month, 1, 18), merchant=None))
    rows.append(pay(203, 50_000, "FUEL", at(10, 6, 19), merchant=GS))
    return sorted(rows, key=lambda r: r.paid_at)


# 오늘 더 받는 금액: 새 카페 카드 900원(스타벅스 1,000 − KB 100), 새 주유 카드 2,000원(GS 2,500 − KB 500)
TWO_ITEMS = [ScheduleItem(1, 1, at(10, 7, 14), at(10, 7, 15), "CAFE", 10_000),
             ScheduleItem(2, 1, at(10, 7, 19), at(10, 7, 20), "FUEL", 50_000)]


def test_오늘_더_주는_카드_중_1년_이득이_가장_큰_카드를_고른다():
    pick = pick_card(state_of(payments=year_payments()), year_payments(), TWO_ITEMS, [], NOW, Params())
    assert (pick.card_id, pick.gain) == (9, 900)                       # 오늘 금액은 주유 카드(2,000원)가 더 크다
    assert (pick.yearly_gain, pick.yearly_months, pick.yearly_basis, pick.replaces) == (16_000, 2, "swap", "KB ALL")


def test_1년_계산을_끄면_오늘_금액이_큰_카드를_고른다():
    pick = pick_card(state_of(payments=year_payments()), year_payments(), TWO_ITEMS, [], NOW, TODAY)
    assert (pick.card_id, pick.gain, pick.yearly_gain) == (8, 2_000, None)


def test_1년으로_손해인_카드는_오늘_더_줘도_추천하지_않는다():
    # 새 카페 카드는 오늘 540원을 더 주지만, 지난 결제로는 실적(30만 원)을 못 채워 연회비만 나간다
    assert pick_card(state_of(), habit_payments(), [coffee()], [], NOW, Params()) is None
    assert pick_card(state_of(), habit_payments(), [coffee()], [], NOW, Params(page_min_yearly=-5_000)).card_id == 9


def test_결제_이력이_두_달_미만이면_오늘_금액으로_고른다():
    pick = pick_card(state_of(), [], [coffee()], [], NOW, Params())
    assert (pick.card_id, pick.gain, pick.yearly_gain, pick.yearly_months, pick.replaces) == (9, 540, None, None, None)


def test_응답에_오늘_혜택_키워드와_1년_금액을_함께_준다():
    page = build_page(state_of(payments=year_payments()), year_payments(), TWO_ITEMS, [], [], NOW, Params())
    card = page.to_dict(page_catalog(), Params())["card"]
    assert (card["keyword"], card["keywords"]) == ("STAR 10% 할인", ["STAR 10% 할인"])      # 화면의 큰 글씨
    assert (card["yearly_gain"], card["yearly_months"], card["yearly_basis"], card["replaces"]) == (16_000, 2, "swap", "KB ALL")
    assert card["gain"] == 900 and card["show_amount"] is True         # 오늘 금액을 문구에 쓴다 (500원 이상)
    assert (card["items"][0]["keyword"], card["items"][0]["specific"]) == ("STAR 10% 할인", True)
    assert "monthly_gain" not in card and "headline" not in card


def test_이력이_짧으면_1년_금액_없이_오늘_혜택만_준다():
    big = build_page(state_of(), [], [coffee()], [], [], NOW, Params()).to_dict(page_catalog(), Params())["card"]
    assert (big["keyword"], big["yearly_gain"], big["show_amount"]) == ("STAR 10% 할인", None, True)   # 540원
    small = build_page(state_of(), [], [coffee(amount=4_000)], [], [], NOW, Params()).to_dict(page_catalog(), Params())["card"]
    assert (small["keyword"], small["show_amount"]) == ("STAR 10% 할인", False)                        # 360원: 금액은 숨긴다


def test_서비스는_1년으로_손해인_카드를_보여_주지_않는다():
    svc = PlacementService(PageStore(), PlacementEngine(page_catalog(), Priors({}, {}), Params(base_order="first_tier")))
    svc.popup_promotions = []
    _save_coffee(svc)
    page = svc.recommendation_page(1, NOW)
    assert page["tabs"] == [] and page["card"] is None and svc.store.recommended == []


def test_실제_데이터에서_1년_금액은_연말정산_화면과_같다():
    """시연 1~5번: 추천한 카드의 1년 금액이 0원보다 크고, 같은 시각의 연말정산 놓친 혜택 계산과 같은 숫자다."""
    from engine.loader import ARTIFACTS
    from engine.recommend import missed_benefit
    from engine.team_db import team_db_dir
    if not (team_db_dir() / "payments.csv").exists() or not (ARTIFACTS / "priors.json").exists():
        pytest.skip("팀 DB CSV 또는 artifacts 가 없습니다")
    os.environ["SOLPAY_STORE"] = "teamdb"
    from engine.api import build_service
    svc = build_service()
    when = datetime(2026, 11, 5, 8, 0, tzinfo=KST)
    shown = 0
    for user_id in range(1, 6):
        card = svc.recommendation_page(user_id, when)["card"]
        if card is None:
            continue
        shown += 1
        context = svc.store.context(user_id, when)
        rows = [p for p in context.payments if when - timedelta(days=365) <= p.paid_at < when]
        yearly = {m["card_id"]: m for m in missed_benefit(svc.build_state(context, when), rows,
                                                         svc.engine.params.switch_threshold)}
        assert card["keyword"] and card["yearly_gain"] > 0 and card["gain"] > 0
        assert (card["yearly_gain"], card["yearly_months"]) == (yearly[card["card_id"]]["gain"], yearly[card["card_id"]]["months"])
    assert shown >= 4


# ---------- 오늘 일정 혜택 중심 (2026-11-21 사용자 결정: 일정 업종 혜택이 있는 카드 먼저, 그 안에서 1년 이득순. 큰 글씨는 오늘 혜택) ----------
from engine.page import benefit_keyword

NAMES = {"CAFE": "카페/커피전문점", "FUEL": "주유", "TRANSIT": "대중교통(버스/지하철)", "MART": "대형마트"}


def test_혜택_키워드는_업종이나_브랜드에_혜택을_붙인다():
    cat = Catalog({}, {}, NAMES)
    kw = lambda b, category="CAFE", brand="STAR": benefit_keyword(b, category, brand, cat)
    assert kw(Benefit(1, "CAFE", "discount", rate=0.10, targets=(("CAFE", None),))) == ("카페 10% 할인", True)       # 업종 혜택
    assert kw(Benefit(1, "CAFE", "discount", rate=0.10, targets=(("CAFE", "STAR"),))) == ("STAR 10% 할인", True)    # 브랜드 한정
    assert kw(Benefit(1, "CAFE", "discount", rate=0.10, brands=frozenset({"STAR"}))) == ("STAR 10% 할인", True)
    assert kw(Benefit(1, "TRANSIT", "cashback", amount=1_000), "TRANSIT", None) == ("대중교통 1,000원 캐시백", True)
    assert kw(Benefit(1, "FUEL", "discount", per_liter=60), "FUEL", "GS") == ("주유 ℓ당 60원 할인", True)
    assert kw(Benefit(1, "*", "point", rate=0.015), "MART", None) == ("모든 가맹점 1.5% 적립", False)                # 일정과 무관한 혜택


def generic_catalog():
    """후보 7: 모든 가맹점 5% (연회비 없음). 지난 결제로는 1년 이득이 가장 크지만(28,000원) 오늘 일정 업종을 집은 혜택은 아니다."""
    base = page_catalog()
    cards = {**base.cards, 7: Card(7, "NEW_ALL", "SHINHAN", "새 범용 카드", "credit", (), 0, {},
                                   (Benefit(7, "*", "discount", rate=0.05, name="모든 가맹점 5% 할인"),))}
    return Catalog(cards, base.merchants, base.category_names)


def test_일정_업종_혜택이_있는_카드를_먼저_고른다():
    state = state_of(payments=year_payments(), catalog=generic_catalog())
    pick = pick_card(state, year_payments(), TWO_ITEMS, [], NOW, Params())
    assert (pick.card_id, pick.yearly_gain, pick.items[0].keyword) == (9, 16_000, "STAR 10% 할인")
    before = pick_card(state, year_payments(), TWO_ITEMS, [], NOW, Params(page_schedule_first=False))
    assert (before.card_id, before.yearly_gain) == (7, 28_000)         # 끄면 1년 이득순 (2026-11-21 오전 규칙)
    assert [(i.keyword, i.specific) for i in before.items] == [("모든 가맹점 5% 할인", False)] * 2


def test_일정_업종_혜택이_있는_카드가_없으면_1년_이득순으로_고른다():
    mart = [ScheduleItem(1, 1, at(10, 7, 18), at(10, 7, 19), "MART", 200_000)]      # 마트를 집은 혜택은 어느 후보에도 없다
    pick = pick_card(state_of(payments=year_payments(), catalog=generic_catalog()), year_payments(), mart, [], NOW, Params())
    assert (pick.card_id, pick.items[0].keyword, pick.items[0].specific) == (7, "모든 가맹점 5% 할인", False)


def test_대표_항목은_일정_업종_혜택이_먼저다():
    """새 카드 6: 카페는 스타벅스 10%(일정 업종 혜택, 900원 더), 주유는 모든 가맹점 5%(2,000원 더). 금액이 작아도 카페가 대표다."""
    base = page_catalog()
    card6 = Card(6, "NEW_MIX", "SHINHAN", "새 혼합 카드", "credit", (), 0, {},
                 (Benefit(61, "CAFE", "discount", rate=0.10, max_per_tx=1_000, brands=frozenset({"STAR"}), name="카페 10% 할인"),
                  Benefit(62, "*", "discount", rate=0.05, name="모든 가맹점 5% 할인")))
    cat = Catalog({1: base.cards[1], 3: base.cards[3], 6: card6}, base.merchants, base.category_names)
    pick = pick_card(state_of(payments=year_payments(), catalog=cat), year_payments(), TWO_ITEMS, [], NOW, Params())
    assert [(i.category, i.keyword, i.gain) for i in pick.items] == [("CAFE", "STAR 10% 할인", 900), ("FUEL", "모든 가맹점 5% 할인", 2_000)]
    card = build_page(state_of(payments=year_payments(), catalog=cat), year_payments(), TWO_ITEMS, [], [], NOW,
                      Params()).to_dict(cat, Params())["card"]
    assert (card["keyword"], card["keywords"]) == ("STAR 10% 할인", ["STAR 10% 할인", "모든 가맹점 5% 할인"])
