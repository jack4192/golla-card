import pytest
from fastapi.testclient import TestClient

from engine.api import create_app
from engine.domain import RankRequest, User
from engine.rules import parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import UnknownUser, UserContext
from tests.conftest import USER_CARDS, at, online, pay

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
    assert set(got) == {"start", "end", "category", "amount"}


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
