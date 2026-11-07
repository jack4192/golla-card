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

    def user(self, user_id):
        if user_id != self.profile.user_id:
            raise UnknownUser(user_id)
        return self.profile

    def context(self, user_id, when):
        return UserContext(self.user(user_id), USER_CARDS, [p for p in self.payments if p.visible_at <= when], self.rules)

    def log_recommendation(self, record):
        self.logs.append(record)
        return len(self.logs)

    def save_rules(self, user_id, rules):
        self.rules = [parse_rule(r, i + 1, i) for i, r in enumerate(rules)]

    def add_payment(self, payment):
        self.payments.append(payment)


@pytest.fixture
def consent(catalog, priors, params):
    store = FakeStore(User(1, True, True))
    return PlacementService(store, PlacementEngine(catalog, priors, params))


@pytest.fixture
def no_consent(catalog, priors, params):
    store = FakeStore(User(1))
    return PlacementService(store, PlacementEngine(catalog, priors, params))


def client(service):
    return TestClient(create_app(service))


def test_확정_가맹점이면_그_업종_혜택_카드가_1순위다(consent):
    with client(consent) as c:
        res = c.post("/internal/rank", json={"user_id": 1, "lat": 37.5100, "lng": 127.0, "accuracy_m": 20,
                                             "at": "2026-10-07T12:20:00+09:00"})
    body = res.json()
    assert res.status_code == 200
    assert body["cards"][0]["user_card_id"] == 102 and body["scenario_mode"] == "confirmed"
    assert body["version"] == "consent" and body["display_count"] == 1
    assert "음식점에서 10,000원 이상 결제하면 10% 할인" in body["cards"][0]["message"]
    assert not any(word in card["message"] for card in body["cards"] for word in BANNED)


def test_미동의_사용자의_위치는_쓰지도_저장하지도_않는다(no_consent):
    with client(no_consent) as c:
        body = c.post("/internal/rank", json={"user_id": 1, "lat": 37.5100, "lng": 127.0, "accuracy_m": 20,
                                              "at": "2026-10-07T12:20:00+09:00"}).json()
    log = no_consent.store.logs[0]
    assert body["version"] == "no_consent" and body["merchant_chips"] == []
    assert log["lat"] is None and log["lng"] is None


def test_강제_규칙은_1장만_보여주고_문구로_알린다(consent):
    rule = {"rule_type": "force", "target": {"user_card_ids": [103]}, "source_text": "교통카드로 해줘"}
    with client(consent) as c:
        assert c.put("/internal/users/1/rules", json=[rule]).json() == {"saved": 1}
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert body["cards"][0]["user_card_id"] == 103 and body["display_count"] == 1
    assert body["rule_applied"] == 1 and body["reason_code"] == "RULE"
    assert "설정하신 대로" in body["cards"][0]["message"]


def test_제외_규칙의_카드는_응답에_없다(consent):
    rule = {"rule_type": "exclude", "target": {"user_card_ids": [102]}}
    with client(consent) as c:
        c.put("/internal/users/1/rules", json=[rule])
        body = c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"}).json()
    assert 102 not in [card["user_card_id"] for card in body["cards"]]


def test_잘못된_규칙은_422다(consent):
    with client(consent) as c:
        assert c.put("/internal/users/1/rules", json=[{"rule_type": "force"}]).status_code == 422


def test_없는_사용자는_404다(consent):
    with client(consent) as c:
        assert c.post("/internal/rank", json={"user_id": 999}).status_code == 404


def test_잘못된_좌표는_422다(consent):
    with client(consent) as c:
        assert c.post("/internal/rank", json={"user_id": 1, "lat": 100}).status_code == 422


def test_토큰을_설정하면_내부_호출을_검사한다(consent, monkeypatch):
    monkeypatch.setenv("SOLPAY_INTERNAL_TOKEN", "secret")
    with client(consent) as c:
        assert c.post("/internal/rank", json={"user_id": 1}).status_code == 401
        assert c.post("/internal/rank", json={"user_id": 1}, headers={"X-Internal-Token": "wrong"}).status_code == 401
        assert c.post("/internal/rank", json={"user_id": 1, "at": "2026-10-07T12:20:00+09:00"},
                      headers={"X-Internal-Token": "secret"}).status_code == 200


def test_결제를_더하면_다음_배치에_반영된다(consent):
    payment = {"payment_id": 9001, "user_id": 1, "user_card_id": 102, "category_code": "REST", "channel": "offline_qr",
               "card_select_mode": "manual", "amount": 50_000, "merchant_id": 11, "paid_at": "2026-10-07T12:00:00+09:00"}
    with client(consent) as c:
        assert c.post("/internal/payments", json=payment).json() == {"saved": True}
    assert any(p.payment_id == 9001 for p in consent.store.payments)


def test_기본_카드가_바뀌면_한_번_안내한다(catalog, priors, params):
    from engine.state import UserState
    engine = PlacementEngine(catalog, priors, params)
    state = UserState(User(1), USER_CARDS, catalog, params)
    state.apply(online(101, 600_000, at(9, 15)))
    state.apply(pay(101, 3_000_000, "CVS", at(9, 16)))
    state.apply(online(101, 300_000, at(10, 1)))
    result = engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=101)
    assert result.base_card == 102 and result.reason_code == "BASE_CHANGED"
    assert "오늘부터" in result.cards[0].message
    assert engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=102).reason_code != "BASE_CHANGED"


def test_미래_결제는_문맥에_들어가지_않는다(consent):
    consent.store.payments.append(pay(101, 777_000, when=at(10, 20)))
    state = consent.build_state(consent.store.context(1, at(10, 7)))
    assert state.perf(101) == 600_000


class FullStore(FakeStore):
    """FakeStore 에 사용자·동의·규칙 조회·초기화를 더한 저장소."""

    def __init__(self, user):
        super().__init__(user)
        self.raw = []

    def set_consent(self, user_id, consent, feature):
        self.user(user_id)
        self.profile = User(user_id, consent, feature)

    def raw_rules(self, user_id):
        return self.raw

    def save_rules(self, user_id, rules):
        super().save_rules(user_id, rules)
        self.raw = list(rules)

    def reset(self):
        self.raw = []


@pytest.fixture
def full(catalog, priors, params):
    store = FullStore(User(1, True, True))
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


def test_위치_동의를_바꾸면_다음_요청부터_미동의_버전이다(full):
    with client(full) as c:
        assert c.get("/internal/users/1").json()["version"] == "consent"
        assert c.put("/internal/users/1/consent", json={"loc_consent": False, "loc_feature_on": True}).json()["version"] == "no_consent"
        body = c.post("/internal/rank", json={"user_id": 1, "lat": 37.51, "lng": 127.0, "accuracy_m": 20,
                                              "at": "2026-10-07T12:20:00+09:00"}).json()
    assert body["version"] == "no_consent" and body["merchant_chips"] == []


def test_저장한_규칙을_조회한다(full):
    rule = {"rule_type": "exclude", "target": {"user_card_ids": [102]}}
    with client(full) as c:
        c.put("/internal/users/1/rules", json=[rule])
        assert c.get("/internal/users/1/rules").json() == [rule]


def test_가맹점_목록은_위치가_있는_가맹점만_준다(full):
    with client(full) as c:
        rows = c.get("/internal/merchants").json()
    assert {r["merchant_id"] for r in rows} == {10, 11, 12}
