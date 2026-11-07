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


def test_타사_실적_문구에는_어제까지_기준을_적는다(consent_state, catalog, priors, params, monkeypatch):
    fill_previous_month(consent_state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state = consent_state
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


def test_반복_구간이어도_실적_때문에_바꿨으면_실적_문구를_보여준다(consent_state, catalog, priors, params, monkeypatch):
    fill_previous_month(consent_state, {101: 600_000, 102: 400_000, 103: 300_000}, place=1_200_000)
    state = consent_state
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
    result = PlacementEngine(catalog, priors, params).rank_state(state, RankRequest(1, at(10, 29)))
    assert result.repeat_applied and result.swap_reason == "performance"
    assert result.reason_code == "PERFORMANCE" and "실적 달성까지" in result.cards[0].message
