from dataclasses import replace
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient

from engine.api import create_app
from engine.domain import RankRequest, User
from engine.params import Params
from engine.rules import parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import UnknownUser, UserContext
from tests.conftest import KST, USER_CARDS, at, online, pay

BANNED = ("더 쓰세요", "더 사용", "추가 결제")


class FakeStore:
    def __init__(self, user):
        self.profile = user
        self.logs = []
        self.rules = []
        self.payments = [online(uc, amount, at(9, 15)) for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000))]
        self.payments += [online(uc, amount, at(10, 1)) for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000))]
        self.days, self.recommended = {}, []

    def user(self, user_id):
        if user_id != self.profile.user_id:
            raise UnknownUser(user_id)
        return self.profile

    promotions = []

    def context(self, user_id, when):
        return UserContext(self.user(user_id), USER_CARDS, [p for p in self.payments if p.visible_at <= when], self.rules,
                           promotions=[p for p in self.promotions if p.active(when)],
                           schedules=self.schedules(user_id, when.date()))

    def put_schedule(self, user_id, day, items):
        self.user(user_id)
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
def svc(catalog, priors, params):
    store = FakeStore(User(1))
    return PlacementService(store, PlacementEngine(catalog, priors, params))


def client(service):
    return TestClient(create_app(service))


def test_강제_규칙은_1장만_보여주고_문구로_알린다(svc):
    rule = {"rule_type": "force", "target": {"user_card_ids": [103]}, "source_text": "교통카드로 해줘"}
    with client(svc) as c:
        assert c.put("/internal/users/1/rules", json=[rule]).json() == {"saved": 1}
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert body["cards"][0]["user_card_id"] == 103 and body["display_count"] == 1
    assert body["rule_applied"] == 1 and body["reason_code"] == "RULE"
    assert "설정하신 대로" in body["cards"][0]["message"]


def test_제외_규칙의_카드는_응답에_없다(svc):
    rule = {"rule_type": "exclude", "target": {"user_card_ids": [102]}}
    with client(svc) as c:
        c.put("/internal/users/1/rules", json=[rule])
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert 102 not in [card["user_card_id"] for card in body["cards"]]


def test_배치_응답에_예시_거래가_있다(svc):
    with client(svc) as c:
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    ex = body["example"]
    assert set(ex) == {"basis", "category_code", "category_name", "merchant_id", "name", "amount", "prob"}
    assert ex["basis"] in {"promotion", "benefit", "schedule", "likely"} and ex["amount"] > 0 and 0 < ex["prob"] <= 1


def test_잘못된_규칙은_422다(svc):
    with client(svc) as c:
        assert c.put("/internal/users/1/rules", json=[{"rule_type": "force"}]).status_code == 422


def test_없는_사용자는_404다(svc):
    with client(svc) as c:
        assert c.post("/internal/rank", json={"user_id": 999}).status_code == 404


def test_토큰을_설정하면_내부_호출을_검사한다(svc, monkeypatch):
    monkeypatch.setenv("SOLPAY_INTERNAL_TOKEN", "secret")
    with client(svc) as c:
        assert c.post("/internal/rank", json={"user_id": 1}).status_code == 401
        assert c.post("/internal/rank", json={"user_id": 1}, headers={"X-Internal-Token": "wrong"}).status_code == 401
        assert c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"},
                      headers={"X-Internal-Token": "secret"}).status_code == 200


def test_결제를_더하면_다음_배치에_반영된다(svc):
    payment = {"payment_id": 9001, "user_id": 1, "user_card_id": 102, "category_code": "REST", "channel": "offline_qr",
               "card_select_mode": "manual", "amount": 50_000, "merchant_id": 11, "paid_at": "2026-10-07T12:00:00+09:00"}
    with client(svc) as c:
        assert c.post("/internal/payments", json=payment).json() == {"saved": True}
    assert any(p.payment_id == 9001 for p in svc.store.payments)


def test_기본_카드가_바뀌면_한_번_안내한다(catalog, priors, params):
    from engine.state import UserState
    params = params.with_(switch_threshold=300)    # 안내 문구 확인용: 150원이면 카페 190원 차이로 교체되어 안내가 바뀐다
    engine = PlacementEngine(catalog, priors, params)
    state = UserState(User(1), USER_CARDS, catalog, params)
    state.apply(online(101, 600_000, at(9, 15)))
    state.apply(pay(101, 3_000_000, "CVS", at(9, 16)))
    state.apply(online(101, 300_000, at(10, 1)))
    result = engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=101)
    assert result.base_card == 102 and result.reason_code == "BASE_CHANGED"
    assert "오늘부터" in result.cards[0].message
    assert engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=102).reason_code != "BASE_CHANGED"


def test_미래_결제는_문맥에_들어가지_않는다(svc):
    svc.store.payments.append(pay(101, 777_000, when=at(10, 20)))
    state = svc.build_state(svc.store.context(1, at(10, 7)))
    assert state.perf(101) == 600_000


class FullStore(FakeStore):
    """FakeStore 에 사용자·동의·규칙 조회·초기화를 더한 저장소."""

    def __init__(self, user):
        super().__init__(user)
        self.raw = []

    def raw_rules(self, user_id):
        return self.raw

    def save_rules(self, user_id, rules):
        super().save_rules(user_id, rules)
        self.raw = list(rules)

    def reset(self):
        self.raw = []


@pytest.fixture
def full(catalog, priors, params):
    store = FullStore(User(1))
    service = PlacementService(store, PlacementEngine(catalog, priors, params))
    return service


def test_추천_근거를_요청하면_함께_준다(full):
    with client(full) as c:
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00", "explain": True}).json()
        plain = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert body["explanation"]["base_card"] == 101
    assert {s["category_name"] for s in body["explanation"]["scenarios"]} <= {"음식점", "카페"}
    assert set(body["explanation"]["card_scores"]) == {"101", "102", "103"}
    assert plain["explanation"] is None


def test_카드_실적_현황(full):
    with client(full) as c:
        rows = c.get("/internal/users/1/cards", params={"at": "2026-10-07T12:20:00+09:00"}).json()
    first = rows[0]
    assert first["prev_perf"] == 600_000 and first["perf"] == 600_000
    assert first["tiers"] == [300_000, 500_000] and first["next_tier"] is None and first["eligible_tier"] == 500_000
    kb = next(r for r in rows if r["issuer"] == "KB")
    assert kb["synced_note"] is True


def test_결제_평가는_카드별_혜택과_최적_카드를_준다(full):
    with client(full) as c:
        r = c.post("/internal/payments/evaluate", json={"user_id": 1, "category_code": "REST", "amount": 15_000,
                                                       "at": "2026-10-07T12:20:00+09:00", "user_card_id": 101}).json()
    assert r["best_card"] == 102 and r["best_benefit"] == 1_500 and r["used_benefit"] == 0


def test_저장한_규칙을_조회한다(full):
    rule = {"rule_type": "exclude", "target": {"user_card_ids": [102]}}
    with client(full) as c:
        c.put("/internal/users/1/rules", json=[rule])
        assert c.get("/internal/users/1/rules").json() == [rule]


def test_가맹점_목록은_현장_가맹점만_주고_좌표는_주지_않는다(full):
    with client(full) as c:
        rows = c.get("/internal/merchants").json()
    assert {r["merchant_id"] for r in rows} == {10, 11, 12}
    assert all("lat" not in r and "lng" not in r for r in rows)


def test_결제_평가는_가맹점이_있으면_프로모션을_더한다(full):
    from engine.domain import Promotion
    full.store.promotions = [Promotion(1, "식당", at(10, 1), at(10, 31, 23, 59), frozenset({11}), issuer="SHINHAN",
                                       amount=None, rate=0.10, max_amount=1_000, kind="myshop")]
    with client(full) as c:
        r = c.post("/internal/payments/evaluate", json={"user_id": 1, "category_code": "REST", "amount": 15_000,
                                                       "at": "2026-10-07T12:20:00+09:00", "user_card_id": 103,
                                                       "merchant_id": 11}).json()
    by = {row["user_card_id"]: row for row in r["cards"]}
    assert by[102]["benefit"] == 2_500 and by[102]["promotion"] == 1_000 and by[102]["promotion_label"] == "식당 마이샵 10%"
    assert by[103]["promotion"] == 0 and r["best_card"] == 102 and r["used_promotion"] == 0


NOW = "2026-10-07T09:00:00+09:00"


def test_일정을_넣으면_그_시간에는_일정_업종으로_배치한다(svc):
    with client(svc) as c:
        r = c.put("/internal/users/1/schedules/2026-10-07", params={"at": NOW},
                  json={"items": [{"start": "12:00", "end": "13:00", "category": "REST", "amount": 15000}]})
        assert r.status_code == 200 and r.json()["items"][0]["category"] == "REST"
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert body["version"] == "schedule" and body["scenario_mode"] == "schedule"
    assert body["cards"][0]["user_card_id"] == 102                       # 음식점 10% 카드


def test_위치는_받지도_저장하지도_않는다(svc):
    with client(svc) as c:
        body = c.post("/internal/rank", json={"user_id": 1, "lat": 37.51, "lng": 127.0,
                                              "at": "2026-10-07T12:20:00+09:00"}).json()
    assert "merchant_chips" not in body and body["version"] == "pattern"
    assert all(k not in svc.store.logs[0] for k in ("lat", "lng", "chips"))


@pytest.mark.parametrize("item", [
    {"start": "12:00", "end": "13:00", "category": "없는업종", "amount": 1000},
    {"start": "13:00", "end": "12:00", "category": "REST", "amount": 1000},
    {"start": "12:00", "end": "13:00", "category": "REST", "amount": 0},
])
def test_잘못된_일정은_422다(svc, item):
    with client(svc) as c:
        r = c.put("/internal/users/1/schedules/2026-10-07", params={"at": NOW}, json={"items": [item]})
    assert r.status_code == 422


def test_지난_날의_일정은_넣을_수_없다(svc):
    with client(svc) as c:
        r = c.put("/internal/users/1/schedules/2026-10-06", params={"at": NOW},
                  json={"items": [{"start": "12:00", "end": "13:00", "category": "REST", "amount": 1000}]})
    assert r.status_code == 422


def test_일정은_시간_업종_금액만_받는다(svc):
    with client(svc) as c:
        c.put("/internal/users/1/schedules/2026-10-07", params={"at": NOW},
              json={"items": [{"start": "12:00", "end": "13:00", "category": "REST", "amount": 1000,
                               "memo": "강남 회식", "place": "OO식당"}]})
        got = c.get("/internal/users/1/schedules/2026-10-07").json()["items"][0]
    assert set(got) == {"start", "end", "category", "amount", "brand"} and got["brand"] is None   # 메모·장소는 버린다


def test_신규_카드_추천은_이득이_기준보다_작으면_하지_않는다(svc):
    with client(svc) as c:
        r = c.post("/internal/users/1/card-recommendation", json={"at": "2026-10-07T09:00:00+09:00"}).json()
    assert r == {"recommend": False}


def test_신규_카드_추천과_같은_날_다시_추천하지_않는다(catalog, priors, params):
    store = FakeStore(User(1))
    for day in range(1, 7):
        store.payments.append(pay(101, 30_000, "CVS", at(10, day, 12)))
    service = PlacementService(store, PlacementEngine(catalog, priors, params.with_(recommend_min_monthly=0)))
    with client(service) as c:
        first = c.post("/internal/users/1/card-recommendation", json={"at": "2026-10-07T09:00:00+09:00"}).json()
        again = c.post("/internal/users/1/card-recommendation", json={"at": "2026-10-07T18:00:00+09:00"}).json()
    assert first["recommend"] and first["card_id"] == 4 and first["trigger"] in ("repeat", "regular")
    assert again == {"recommend": False}


def test_사용자가_확정한_방식은_월간_맞춤이_바꾸지_않는다(svc, tmp_path):
    from engine.strategy_store import StrategyStore
    svc.store.strategy_store = StrategyStore(tmp_path / "s.sqlite")
    svc.store.strategy_store.confirm_change(1, "none")
    state = svc.build_state(svc.store.context(1, at(10, 7)), at(10, 7))
    assert state.fixed_strategy == "none" and state.month_strategy is None
    assert svc.monthly_strategy(1, at(10, 7))["status"] == "user_confirmed"


def test_최초_추천_방식은_월간_맞춤을_거친다(svc, tmp_path):
    from engine.strategy_store import StrategyStore
    svc.store.strategy_store = StrategyStore(tmp_path / "s.sqlite")
    svc.store.strategy_store.initialize(1, "value")
    out = svc.monthly_strategy(1, at(10, 7))
    assert out["status"] in ("ready", "insufficient_history") and out["strategy"] in ("value", "main_top", "first_tier", "none")


# ---------- 입력 검사·카드 없는 사용자 (2026-11-22 재검토 1~3번, 사용자 결정) ----------
AT = "2026-10-07T12:20:00+09:00"


def test_내_카드가_아닌_결제는_문맥에서_빠져_배치와_리포트가_멈추지_않는다(svc):
    # 지운 카드나 잘못 들어온 결제가 저장소에 있어도 (예전에는 그 사용자의 배치·리포트가 계속 500)
    svc.store.payments.append(pay(999, 5_000, when=at(10, 6)))
    assert all(p.user_card_id != 999 for p in svc.store.context(1, at(10, 7)).payments)
    with client(svc) as c:
        assert c.post("/internal/rank", json={"user_id": 1, "at": AT}).status_code == 200
        assert c.get("/internal/users/1/monthly-report", params={"at": AT}).status_code == 200


def test_내_카드가_아닌_결제는_저장하지_않고_422다(svc):
    body = {"payment_id": 9001, "user_id": 1, "user_card_id": 999, "merchant_id": 10, "category_code": "CAFE",
            "channel": "offline_qr", "card_select_mode": "manual", "amount": 5000, "paid_at": "2026-10-06T11:00:00+09:00"}
    before = len(svc.store.payments)
    with client(svc) as c:
        r = c.post("/internal/payments", json=body)
        assert r.status_code == 422 and "보유하지 않은 카드" in r.json()["detail"]
        assert len(svc.store.payments) == before
        assert c.post("/internal/payments", json={**body, "user_card_id": 101}).json() == {"saved": True}


def test_record_false면_같은_배치를_주고_기록은_남기지_않는다(svc):
    # 홈 일정 카드 미리보기 (2026-11-23 설계서 home-schedule-ai): 기록이 '직전 기본 카드'를 바꾸지 않게
    with client(svc) as c:
        preview = c.post("/internal/rank", json={"user_id": 1, "at": AT, "record": False}).json()
        assert svc.store.logs == [] and preview["recommendation_id"] is None
        real = c.post("/internal/rank", json={"user_id": 1, "at": AT}).json()
    assert real["recommendation_id"] == 1 and len(svc.store.logs) == 1      # 기본값은 기록을 남긴다
    assert [x["user_card_id"] for x in preview["cards"]] == [x["user_card_id"] for x in real["cards"]]
    assert preview["example"] == real["example"] and preview["reason_code"] == real["reason_code"]


def _no_cards(svc):
    from engine.domain import User
    svc.store.context = lambda user_id, when: UserContext(User(1), [], [])


def test_카드가_없는_사용자의_배치는_빈_목록이다(svc):
    _no_cards(svc)
    with client(svc) as c:
        r = c.post("/internal/rank", json={"user_id": 1, "at": AT, "explain": True})
    assert r.status_code == 200
    body = r.json()
    assert body["cards"] == [] and body["display_count"] == 0 and body["reason_code"] == "NO_CARD"
    assert body["recommendation_id"] is None and svc.store.logs == []          # 추천 기록은 남기지 않는다
    assert body["example"] is None                                             # 예시 거래도 없다


def test_카드가_없는_사용자의_리포트와_결제_평가도_200이다(svc):
    _no_cards(svc)
    with client(svc) as c:
        report = c.get("/internal/users/1/monthly-report", params={"at": AT})
        assert report.status_code == 200
        r = report.json()
        assert r["cards"] == [] and r["solpay_effect"] is None and r["summary"]["headline"]
        assert r["strategy"]["base_card"] is None and r["strategy"]["current_order"] == []
        assert r["summary"]["strategy"] == [] and r["summary"]["effect"] == []     # 카드가 없으면 방식 이야기를 하지 않는다
        ev = c.post("/internal/payments/evaluate", json={"user_id": 1, "category_code": "CAFE", "amount": 5000, "at": AT})
        assert ev.status_code == 200
        assert ev.json()["cards"] == [] and ev.json()["best_card"] is None


@pytest.mark.parametrize("rule", [
    {"rule_type": "force", "condition": {"hours": ["9", "18"]}, "target": {"user_card_ids": [101]}},
    {"rule_type": "force", "condition": {"days": 3}, "target": {"user_card_ids": [101]}},
    {"rule_type": "force", "target": "신한"},
    {"rule_type": "force", "target": {"user_card_ids": "101"}},
    {"rule_type": "preference", "settings": {"w1": "많이"}},
])
def test_형식이_틀린_규칙은_422다(svc, rule):
    with client(svc) as c:
        assert c.put("/internal/users/1/rules", json=[rule]).status_code == 422
    assert svc.store.rules == []


def test_내_카드가_아닌_규칙은_저장하지_않고_422다(svc):
    rule = {"rule_type": "force", "target": {"user_card_ids": [999]}}
    with client(svc) as c:
        r = c.put("/internal/users/1/rules", json=[rule])
        assert r.status_code == 422 and "보유하지 않은 카드" in r.json()["detail"]
        assert svc.store.rules == []
        ok = {"rule_type": "force", "target": {"user_card_ids": [103]}}
        assert c.put("/internal/users/1/rules", json=[ok]).json() == {"saved": 1}


# ---------- 기록을 못 남겨도 추천은 준다 (2026-11-22 재검토 5번, 사용자 결정) ----------
def _boom(*args, **kwargs):
    raise RuntimeError("read-only transaction")


def test_추천_기록을_못_남겨도_배치는_돌려준다(svc, caplog):
    svc.store.log_recommendation = _boom              # 읽기 전용 DB 계정처럼 쓰기가 실패
    with client(svc) as c:
        r = c.post("/internal/rank", json={"user_id": 1, "at": AT})
    assert r.status_code == 200
    assert r.json()["recommendation_id"] is None and r.json()["cards"]
    assert "추천 기록" in caplog.text


def test_카드_추천_기록을_못_남겨도_멈추지_않는다(svc, caplog):
    svc.store.log_card_recommendation = _boom
    svc._log_card({"user_id": 1, "at": at(10, 7), "card_id": 4, "trigger": "pattern", "gain": 1000})
    assert "카드 추천 기록" in caplog.text


# ---------- 확인 필요 행사 (2026-11-22 재검토 9번) ----------
def test_확인_필요_행사는_팀_DB_사본도_배치와_결제_평가에서_뺀다(svc):
    # 팝업용 목록(promotions.yml)에서 '확인 필요'(응모·신규 조건)인 번호는 팀 DB 사본에 그 표시가 없어도 계산에서 뺀다
    from dataclasses import replace
    from datetime import datetime

    from engine.domain import Promotion
    from tests.conftest import KST
    span = (datetime(2026, 9, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))
    apply_first = Promotion(5, "카페", *span, frozenset({10}), issuer="SHINHAN", amount=2_000, title="응모하면 2천 원")
    plain = Promotion(6, "식당", *span, frozenset({11}), issuer="SHINHAN", amount=700, title="식당 700원")
    svc.store.promotions = [apply_first, plain]
    svc.popup_promotions = [replace(apply_first, needs_check=True)]
    context = svc.store.context(1, at(10, 7))
    assert [p.promotion_id for p in svc._all_promotions(context) if not p.needs_check] == [6]
    cafe = svc.evaluate_payment(1, at(10, 7), "CAFE", 10_000, None, 10)
    assert all(c["promotion"] == 0 for c in cafe["cards"])
    rest = svc.evaluate_payment(1, at(10, 7), "REST", 20_000, None, 11)
    assert max(c["promotion"] for c in rest["cards"]) == 700


def test_가맹점을_찾을_수_없는_행사는_어느_가맹점에도_적용하지_않는다(catalog):
    # 브랜드도 업종도 없는 행사 행: 예전에는 모든 가맹점에 적용됐다
    from datetime import datetime

    from engine.loader import promotion_from_row
    from tests.conftest import KST
    row = {"promotion_id": 1, "brand": "이름만 있는 행사", "match_brand": None, "category_code": None, "issuer_code": "SHINHAN",
           "amount": 1_000, "starts_at": datetime(2026, 9, 1, tzinfo=KST), "ends_at": datetime(2026, 10, 31, tzinfo=KST)}
    assert promotion_from_row(row, catalog).merchant_ids == frozenset()
    assert promotion_from_row({**row, "category_code": "CAFE"}, catalog).merchant_ids == frozenset({10})     # 업종 행사는 그대로


# ---------- 개인정보 가리기·시간대 (2026-11-22 재검토 10·11번) ----------
@pytest.mark.parametrize("text, label", [
    ("제 카드번호1234-5678-9012-3456입니다", "카드번호"),
    ("카드 1234567890123456으로 결제", "카드번호"),
    ("전화01012345678로 연락 주세요", "전화번호"),
    ("번호는010-1234-5678이에요", "전화번호"),
    ("주민번호900101-1234567이고", "주민등록번호"),
    ("계좌110-123-456789로 보내 줘", "계좌번호"),
    ("메일abc.def@naver.com으로 보내 줘", "이메일"),
])
def test_한글에_붙은_개인정보도_가린다(text, label):
    from engine.privacy import redact
    out = redact(text)
    assert f"[{label}]" in out and not any(ch.isdigit() for ch in out) and "@" not in out, out


def test_금액과_짧은_숫자는_가리지_않는다():
    from engine.privacy import redact
    for text in ("스타벅스에서 5000원 결제하면", "이번 달 1,500,000원 썼어", "3번 카드 실적 40만원", "오전 9시부터 18시까지"):
        assert redact(text) == text


def test_시간대_없는_시각은_한국_시간으로_본다(svc, monkeypatch):
    # 서버 시간대가 UTC 여도 '2026-10-07T12:20:00' 은 한국 시간 12시 20분이다 (예전에는 9시간 밀려 21시 20분이 됐다)
    import time
    monkeypatch.setenv("TZ", "UTC")
    time.tzset()
    try:
        with client(svc) as c:
            naive = c.get("/internal/users/1/monthly-report", params={"at": "2026-10-07T12:20:00"}).json()
            aware = c.get("/internal/users/1/monthly-report", params={"at": "2026-10-07T03:20:00Z"}).json()
            body = {"payment_id": 9002, "user_id": 1, "user_card_id": 101, "merchant_id": 10, "category_code": "CAFE",
                    "channel": "offline_qr", "card_select_mode": "manual", "amount": 5000, "paid_at": "2026-10-06T11:00:00"}
            assert c.post("/internal/payments", json=body).json() == {"saved": True}
    finally:
        monkeypatch.undo()
        time.tzset()
    assert naive["at"] == "2026-10-07T12:20:00+09:00" and aware["at"] == "2026-10-07T12:20:00+09:00"
    assert svc.store.payments[-1].paid_at.isoformat() == "2026-10-06T11:00:00+09:00"


# 2026-11-24 연말 결산: 시작일(올해 1월 1일)부터, 1만 원 미만은 숨긴다
NOV_MAR = [(2025, 11), (2025, 12), (2026, 1), (2026, 2), (2026, 3)]
AT = "2026-03-20T12:00:00+09:00"


def _cvs(months, amount):
    return [pay(101, amount, "CVS", datetime(y, m, d, 12, tzinfo=KST)) for (y, m) in months for d in (10, 11, 12, 13)]


def test_놓친_혜택은_시작일을_주면_그_달부터_센다(svc):
    svc.store.payments = _cvs(NOV_MAR, 1_000_000)
    with client(svc) as c:
        r = c.get("/internal/users/1/missed-benefit", params={"at": AT, "start": "2026-01-01"}).json()
    assert [(m["card_id"], m["months"], m["gain"]) for m in r] == [(4, 3, 60_000)]
    assert r[0]["message"] == "그때 이 카드를 발급받으셨다면 3개월 동안 60,000원을 더 받으셨어요"
    # 연말 결산 화면이 '1월 1일부터 3월 20일까지'처럼 기간을 밝히게 (2026-11-24 수정사항)
    assert (r[0]["from"], r[0]["until"]) == ("2026-01-01", "2026-03-20")


def test_놓친_혜택은_시작일이_없으면_지금처럼_days_로_센다(svc):
    svc.store.payments = _cvs(NOV_MAR, 1_000_000)
    with client(svc) as c:
        r = c.get("/internal/users/1/missed-benefit", params={"at": AT}).json()
    assert [(m["card_id"], m["months"], m["gain"]) for m in r] == [(4, 4, 80_000)]
    assert (r[0]["from"], r[0]["until"]) == ("2025-03-20", "2026-03-20")


def test_놓친_혜택은_기준_금액_이상만_남긴다(catalog, priors, params):
    for min_gain, expected in ((60_000, [4]), (60_001, [])):
        store = FakeStore(User(1))
        store.payments = _cvs(NOV_MAR, 1_000_000)
        s = PlacementService(store, PlacementEngine(catalog, priors, replace(params, missed_min_gain=min_gain)))
        got = s.missed_benefit(1, datetime(2026, 3, 20, 12, tzinfo=KST), start=date(2026, 1, 1))
        assert [m["card_id"] for m in got] == expected


def test_놓친_혜택은_기본_1만_원_미만이면_빈_목록이다(svc):
    svc.store.payments = _cvs(NOV_MAR, 100_000)                      # 3개월 6,000원
    with client(svc) as c:
        assert c.get("/internal/users/1/missed-benefit", params={"at": AT, "start": "2026-01-01"}).json() == []
    assert Params().missed_min_gain == 10_000


def test_놓친_혜택은_시작_달의_전달_결제만_실적_준비로_쓴다(svc, monkeypatch):
    """12월 결제는 1월 실적을 알기 위해서만 넣고 11월 결제는 넣지 않는다 (설계서 결정 2)."""
    import engine.recommend as recommend
    real, seen = recommend.missed_benefit, {}

    def spy(state, rows, *args, **kwargs):
        seen["months"] = sorted({(p.paid_at.year, p.paid_at.month) for p in rows})
        seen["kwargs"] = kwargs
        return real(state, rows, *args, **kwargs)

    monkeypatch.setattr(recommend, "missed_benefit", spy)
    svc.store.payments = _cvs(NOV_MAR, 1_000_000)
    svc.missed_benefit(1, datetime(2026, 3, 20, 12, tzinfo=KST), start=date(2026, 1, 1))
    assert seen["months"] == [(2025, 12), (2026, 1), (2026, 2), (2026, 3)]
    assert seen["kwargs"] == {"count_from": (2026, 1), "months": 3}


# ---------- 내부 API 보호 (2026-11-24 점검 문제 7) ----------
# 사용자 결정: 토큰이 없으면 같은 컴퓨터(127.0.0.1·::1)에서 온 요청만, 개발 화면·시연 API 는 SOLPAY_DEV_TOOLS=on 일 때만.
# 이 파일의 다른 시험은 conftest 가 SOLPAY_ALLOW_NO_TOKEN=1·SOLPAY_DEV_TOOLS=on 을 켜 둔 상태로 돈다.

def test_토큰이_없으면_다른_컴퓨터에서_온_내부_호출은_막는다(svc, monkeypatch):
    monkeypatch.delenv("SOLPAY_INTERNAL_TOKEN", raising=False)
    monkeypatch.delenv("SOLPAY_ALLOW_NO_TOKEN", raising=False)
    body = {"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}
    with TestClient(create_app(svc), client=("10.0.0.7", 50000)) as c:
        assert c.post("/internal/rank", json=body).status_code == 401
    with TestClient(create_app(svc), client=("127.0.0.1", 50000)) as c:
        assert c.post("/internal/rank", json=body).status_code == 200
    with TestClient(create_app(svc), client=("::1", 50000)) as c:
        assert c.post("/internal/rank", json=body).status_code == 200


def test_토큰이_있으면_같은_컴퓨터라도_토큰이_있어야_한다(svc, monkeypatch):
    monkeypatch.setenv("SOLPAY_INTERNAL_TOKEN", "secret")
    with TestClient(create_app(svc), client=("127.0.0.1", 50000)) as c:
        assert c.post("/internal/rank", json={"user_id": 1}).status_code == 401


def test_개발_화면과_시연_API는_SOLPAY_DEV_TOOLS_가_켜졌을_때만(svc, monkeypatch):
    monkeypatch.delenv("SOLPAY_DEV_TOOLS", raising=False)
    with TestClient(create_app(svc), client=("127.0.0.1", 50000)) as c:
        for path in ("/dev", "/docs", "/openapi.json", "/redoc"):
            assert c.get(path).status_code == 404, path
        assert c.post("/internal/dev/reset").status_code == 404
        assert c.post("/internal/payments", json={}).status_code == 404
        assert c.get("/health").status_code == 200
    monkeypatch.setenv("SOLPAY_DEV_TOOLS", "on")
    with TestClient(create_app(svc), client=("127.0.0.1", 50000)) as c:
        assert c.get("/dev").status_code == 200
        assert c.get("/openapi.json").status_code == 200
