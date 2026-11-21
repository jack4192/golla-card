from engine.domain import RankRequest
from engine.messages import benefit_text, when_text, with_object_particle
from engine.scenarios import Scenario, ScenarioSet
from engine.service import PlacementEngine
from tests.conftest import at, benefit, fill_previous_month, online


def test_혜택_표현():
    assert benefit_text(benefit(1, "CAFE", rate=0.10), 0) == "10% 할인"
    assert benefit_text(benefit(1, "CAFE", amount=2000, type="cashback"), 0) == "2,000원 캐시백"
    assert benefit_text(benefit(1, "TRANSIT", rate=0.05, type="point"), 0) == "5% 적립"


def test_시간_조건_표현():
    assert when_text(benefit(1, "REST", rate=0.1, days=(0, 1, 2, 3, 4), hours=(11, 14))) == "평일 11~14시"
    assert when_text(benefit(1, "FUEL", rate=0.1, days=(5, 6))) == "주말"
    assert when_text(benefit(1, "TRANSIT", amount=1000, days=(0,))) == "월요일"


def test_타사_실적_문구에는_어제까지_기준을_적는다(state, catalog, priors, params, monkeypatch):
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state = state
    state.apply(online(101, 600_000, at(10, 1)))
    state.apply(online(102, 400_000, at(10, 1)))
    from engine import perf_value
    plan = perf_value.month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[103] = [(200_000, 30_000)]
    state.ledger[103].perf = 120_000
    fixed = ScenarioSet([Scenario("CVS", 1.0, (30_000,))], "time", (False, 3))
    monkeypatch.setattr("engine.service.build", lambda *a, **k: fixed)
    result = PlacementEngine(catalog, priors, params).rank_state(state, RankRequest(1, at(10, 29)))
    assert result.reason_code == "PERFORMANCE"
    assert result.cards[0].message == "국민 교통 실적 달성까지 80,000원 남았어요! (어제까지 기준)"


def test_카드_이름에_맞는_조사를_붙인다():
    assert with_object_particle("신한 생활 신용") == "신한 생활 신용을"
    assert with_object_particle("KB국민 체크") == "KB국민 체크를"
    assert with_object_particle("BC") == "BC를"


def test_반복_구간이어도_실적_때문에_바꿨으면_실적_문구를_보여준다(state, catalog, priors, params, monkeypatch):
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state = state
    state.apply(online(101, 600_000, at(10, 1)))
    state.ledger[102].perf = 120_000          # 기본 카드는 카드 2, 걸린 혜택 없음
    from engine import perf_value
    plan = perf_value.month_plan(state)
    plan.daily_fixed.clear()
    plan.gains[102] = [(300_000, 0)]
    plan.gains[103] = [(200_000, 30_000)]
    state.ledger[103].perf = 120_000
    repeat = ScenarioSet([Scenario("CVS", 1.0, (30_000,))], "repeat", (False, 3), repeat_category="CVS")
    monkeypatch.setattr("engine.service.build", lambda *a, **k: repeat)
    result = PlacementEngine(catalog, priors, params.with_(month_end_days=0)).rank_state(state, RankRequest(1, at(10, 29)))
    assert result.repeat_applied and result.swap_reason == "performance"
    assert result.reason_code == "PERFORMANCE" and "실적 달성까지" in result.cards[0].message


def test_프로모션_문구는_이벤트_이름과_금액을_말한다(state, catalog, priors, params, monkeypatch):
    from engine.domain import Promotion
    from tests.conftest import fill_previous_month
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    fixed = ScenarioSet([Scenario("CVS", 1.0, (5_000,), {10: 1.0})], "confirmed", (False, 3))
    monkeypatch.setattr("engine.service.build", lambda *a, **k: fixed)
    promo = Promotion(1, "카페", at(10, 1), at(10, 31, 23, 59), frozenset({10}), issuer="KB", amount=2_000, kind="myshop")
    result = PlacementEngine(catalog, priors, params).rank_state(state, RankRequest(1, at(10, 2)), promotions=[promo])
    assert result.cards[0].user_card_id == 103 and result.reason_code == "PROMOTION"
    assert result.cards[0].message == "카페 마이샵 2,000원으로 약 2,000원을 더 받을 수 있어요!"


def test_기본_카드를_유지해도_프로모션이_가장_크면_프로모션_문구다(state, catalog, priors, params, monkeypatch):
    from engine.domain import Promotion
    from tests.conftest import fill_previous_month
    fill_previous_month(state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    for uc, amount in ((101, 600_000), (102, 400_000), (103, 300_000)):
        state.apply(online(uc, amount, at(10, 1)))
    fixed = ScenarioSet([Scenario("CVS", 1.0, (5_000,), {10: 1.0})], "confirmed", (False, 3))
    monkeypatch.setattr("engine.service.build", lambda *a, **k: fixed)
    promo = Promotion(1, "카페", at(10, 1), at(10, 31, 23, 59), frozenset({10}), issuer="SHINHAN", amount=2_000, kind="myshop")
    result = PlacementEngine(catalog, priors, params).rank_state(state, RankRequest(1, at(10, 2)), promotions=[promo])
    assert result.cards[0].user_card_id == 101 and not result.swapped      # 신한 카드 둘 다 같은 혜택이라 기본 카드 유지
    assert result.reason_code == "PROMOTION" and "카페 마이샵" in result.cards[0].message


# ---------- 2026-11-21 사용자 결정: 사실과 어긋나던 문구 세 가지 ----------
# 1년 재생(189,250건)에서 행사 문구의 41.5%가 100원 미만이었고, 습관 문구는 실제 습관 카드와 54%만 맞았고,
# 카드 변경 문구는 달이 바뀐 첫 화면·고정 규칙 뒤에도 나갔다.
from engine.messages import BASE_CHANGED, GENERAL_BENEFIT, HABIT, NEUTRAL, PROMOTION, card_message, previous_base_filled
from engine.params import Params
from engine.ranker import CardScore, Decision
from tests.conftest import V3, pay

CAFE = ScenarioSet([Scenario("CAFE", 1.0, (5_000,))], "time", (False, 3))
CVS = ScenarioSet([Scenario("CVS", 1.0, (5_000,))], "time", (False, 3))


def _decision(first, promotion=0.0, label=None, swapped=False, base=None):
    scores = {uc: CardScore(uc, 0.0, 0.0, 0.0, 0.0, {"CAFE": 0.0, "CVS": 0.0}) for uc in (101, 102, 103)}
    scores[first] = CardScore(first, 30.0, 0.0, promotion, 30.0 + promotion, {"CAFE": 30.0 + promotion, "CVS": promotion}, label)
    return Decision(base or first, first, None, [first] + [uc for uc in scores if uc != first], scores, swapped,
                    "benefit" if swapped else None, False, 0.0, 1.0)


def _message(state, catalog, decision, scenarios=CAFE, when=None, params=Params()):
    return card_message(state, catalog, decision, scenarios, decision.first, when or at(10, 7, 12, 30), params, False)


def test_행사_기대_금액이_100원_미만이면_행사_문구_대신_카드_혜택을_말한다(state, catalog):
    fill_previous_month(state, {101: 600_000})                       # 카드 1: 카페 10% 를 받는 구간
    small = _message(state, catalog, _decision(101, promotion=40.0, label="카페 마이샵 500원"))
    assert (small.code, small.text) == (GENERAL_BENEFIT, "카페에서 결제하면 10% 할인을 받을 수 있어요!")
    assert _message(state, catalog, _decision(101, promotion=94.0, label="카페 마이샵 500원")).code == GENERAL_BENEFIT   # 화면엔 약 90원
    assert _message(state, catalog, _decision(101, promotion=95.0, label="카페 마이샵 500원")).code == PROMOTION         # 약 100원
    assert Params().promo_message_min == 100


def test_행사_문구의_조사는_금액과_비율에_맞춘다(state, catalog):
    fill_previous_month(state, {101: 600_000})
    won = _message(state, catalog, _decision(101, promotion=150.0, label="카페 마이샵 500원"))
    assert (won.code, won.text) == (PROMOTION, "카페 마이샵 500원으로 약 150원을 더 받을 수 있어요!")
    rate = _message(state, catalog, _decision(101, promotion=150.0, label="올리브영 마이샵 25%"))
    assert rate.text == "올리브영 마이샵 25%로 약 150원을 더 받을 수 있어요!"


def test_행사_때문에_바꾼_카드도_기대_금액이_작으면_카드_혜택을_말한다(state, catalog):
    fill_previous_month(state, {101: 600_000})
    swapped = _decision(101, promotion=40.0, label="카페 마이샵 500원", swapped=True, base=102)
    assert _message(state, catalog, swapped).code == GENERAL_BENEFIT
    assert _message(state, catalog, _decision(101, promotion=300.0, label="카페 마이샵 500원", swapped=True, base=102)).code == PROMOTION
    assert _message(state, catalog, _decision(101, promotion=40.0, label="카페 마이샵 500원"), params=Params(**V3)).code == GENERAL_BENEFIT


def test_습관_문구는_그_시간대에_그_카드를_가장_많이_썼을_때만_쓴다(state, catalog):
    for day in (1, 2, 6):                                            # 평일 점심(11~14시)에 카드 102 로 세 번 (10/5 는 대체공휴일)
        state.apply(pay(102, 10_000, "CVS", at(10, day, 12)))
    state.apply(pay(101, 10_000, "CVS", at(10, 7, 11)))
    usual = _message(state, catalog, _decision(102), CVS)
    assert (usual.code, usual.text) == (HABIT, "보통 지금 시간대에 이 카드로 계산하셨어요!")
    other = _message(state, catalog, _decision(101), CVS)            # 이 시간대에 한 번 쓴 카드
    assert (other.code, other.text) == (NEUTRAL, "지금은 카드마다 혜택 차이가 크지 않아요.")
    assert _message(state, catalog, _decision(102), CVS, at(10, 7, 19)).code == NEUTRAL      # 저녁에는 쓴 적이 없다
    assert _message(state, catalog, _decision(103), CVS, params=Params(**V3)).code == NEUTRAL


def test_두_번_쓴_정도로는_습관이라고_하지_않는다(state, catalog):
    for day in (1, 2):
        state.apply(pay(102, 10_000, "CVS", at(10, day, 12)))
    assert _message(state, catalog, _decision(102), CVS).code == NEUTRAL


def test_앞_카드가_실적_구간을_채웠는지(state, catalog):
    fill_previous_month(state, {101: 600_000})                       # 카드 1(구간 30만·50만): 지난달 60만 원 → 50만 원 구간을 받는 중
    state.ledger[101].perf = 350_000
    assert not previous_base_filled(state, catalog, 101, Params())                      # 지켜야 할 50만 원 구간에 못 미침
    assert previous_base_filled(state, catalog, 101, Params(hold_tiers=False))          # 구간 지키기를 끄면 첫 구간만 본다
    state.ledger[101].perf = 500_000
    assert previous_base_filled(state, catalog, 101, Params())
    assert not previous_base_filled(state, catalog, 103, Params())                      # 이번 달 실적 0원
    assert not previous_base_filled(state, catalog, 999, Params())                      # 더는 없는 카드


def test_기본_카드_변경_문구는_앞_카드가_구간을_채웠을_때만_나간다(catalog, priors, params):
    from engine.domain import User
    from engine.state import UserState
    from tests.conftest import USER_CARDS
    params = params.with_(switch_threshold=300)
    engine = PlacementEngine(catalog, priors, params)
    state = UserState(User(1), USER_CARDS, catalog, params)
    state.apply(online(101, 600_000, at(9, 15)))
    state.apply(pay(101, 3_000_000, "CVS", at(9, 16)))
    state.apply(online(101, 300_000, at(10, 1)))
    # 직전 기본 카드가 103(이번 달 실적 0원)이었다면: 달이 바뀐 첫 화면이나 고정 규칙이 끝난 직후와 같다
    result = engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=103)
    assert result.base_card == 102 and result.reason_code != BASE_CHANGED
    state.ledger[103].perf = 250_000                                 # 103 이 20만 원 구간을 채운 뒤라면 사실이다
    result = engine.rank_state(state, RankRequest(1, at(10, 2)), last_base=103)
    assert result.reason_code == BASE_CHANGED and "앞 카드 실적을 채워" in result.cards[0].message
