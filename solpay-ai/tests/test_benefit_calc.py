"""실제 카드 데이터에서 새로 생긴 혜택 규칙."""

from engine.benefit_calc import FUEL_PRICE, Benefit, Card, CardMonth, apply, evaluate, month_reward
from engine.domain import RankRequest
from engine.scenarios import brand_mix, build
from tests.conftest import at, pay


def card(benefits, tiers=None, rewards=()):
    return Card(9, "C9", "SHINHAN", "테스트", "credit", (), 0, tiers or {}, tuple(benefits), rewards)


def test_브랜드_한정_혜택은_브랜드가_맞을_때만_붙는다():
    c = card([Benefit(1, "CAFE", "discount", rate=0.10, brands=frozenset({"STARBUCKS"}))])
    st = CardMonth()
    assert evaluate(c, "CAFE", 5_000, st, at(), "STARBUCKS")[0] == 500
    assert evaluate(c, "CAFE", 5_000, st, at(), "EDIYA")[0] == 0
    assert evaluate(c, "CAFE", 5_000, st, at(), None)[0] == 0


def test_브랜드_한정_혜택은_업종이_달라도_브랜드가_맞으면_붙는다():
    c = card([Benefit(1, "DIGITAL_SUB", "discount", rate=0.20, brands=frozenset({"NETFLIX"}))])
    assert evaluate(c, "OTT", 13_500, CardMonth(), at(), "NETFLIX")[0] == 2_700


def test_건당_한도와_행_전월_실적_하한():
    c = card([Benefit(1, "CAFE", "discount", rate=0.10, max_per_tx=1_000, min_prev=400_000)])
    assert evaluate(c, "CAFE", 20_000, CardMonth(prev_perf=300_000), at())[0] == 0
    assert evaluate(c, "CAFE", 20_000, CardMonth(prev_perf=400_000), at())[0] == 1_000


def test_이용금액_한도는_남은_이용금액까지만_할인한다():
    b = Benefit(1, "CAFE", "discount", rate=0.10, cap_group="G", cap_unit="usage")
    c = card([b], {"G": ((0, 50_000),)})
    st = CardMonth()
    got, used = evaluate(c, "CAFE", 40_000, st, at())
    apply(st, 40_000, got, used, when=at())
    assert got == 4_000
    assert evaluate(c, "CAFE", 40_000, st, at())[0] == 1_000     # 남은 이용금액 1만 원의 10%


def test_리터당_할인은_휘발유_가격으로_리터를_계산한다():
    c = card([Benefit(1, "GAS_STATION", "discount", per_liter=60)])
    assert evaluate(c, "GAS_STATION", 51_000, CardMonth(), at())[0] == int(51_000 / FUEL_PRICE * 60 / 10) * 10


def test_일_횟수는_다음_날_초기화된다():
    c = card([Benefit(1, "CAFE", "discount", rate=0.10, daily_count=1)])
    st = CardMonth()
    got, b = evaluate(c, "CAFE", 5_000, st, at(10, 7, 9))
    apply(st, 5_000, got, b, when=at(10, 7, 9))
    assert evaluate(c, "CAFE", 5_000, st, at(10, 7, 15))[0] == 0
    assert evaluate(c, "CAFE", 5_000, st, at(10, 8, 9))[0] == 500


def test_시간_조건과_매월_날짜_조건():
    timed = card([Benefit(1, "CAFE", "discount", rate=0.10, hours=(7, 15))])
    assert evaluate(timed, "CAFE", 5_000, CardMonth(), at(10, 7, 14))[0] == 500
    assert evaluate(timed, "CAFE", 5_000, CardMonth(), at(10, 7, 15))[0] == 0
    dated = card([Benefit(1, "MILITARY_PX", "cashback", rate=0.5, month_days=(10,))])
    assert evaluate(dated, "MILITARY_PX", 5_000, CardMonth(), at(10, 10))[0] == 2_500
    assert evaluate(dated, "MILITARY_PX", 5_000, CardMonth(), at(10, 11))[0] == 0


def test_플랜데이는_그날_묶음의_첫_할인만_두_배다():
    b = Benefit(1, "CAFE", "discount", rate=0.10, max_per_tx=1_000, cap_group="T", plan_day=(1, 2.0))
    c = card([b], {"T": ((0, 10_000),)})
    st = CardMonth()
    got, used = evaluate(c, "CAFE", 10_000, st, at(11, 1, 9))
    assert got == 2_000
    apply(st, 10_000, got, used, when=at(11, 1, 9))
    assert evaluate(c, "CAFE", 10_000, st, at(11, 1, 10))[0] == 1_000


def test_행_월_한도():
    c = card([Benefit(1, "CONVENIENCE", "point", rate=0.05, row_cap=3_000)])
    st = CardMonth()
    for _ in range(3):
        got, b = evaluate(c, "CONVENIENCE", 30_000, st, at())
        apply(st, 30_000, got, b, when=at())
    assert st.discount == 3_000


def test_월_리워드는_가장_높은_구간_하나만():
    c = card([], rewards=((1_500_000, 3_000), (1_800_000, 5_000)))
    assert month_reward(c, 1_000_000) == 0
    assert month_reward(c, 1_600_000) == 3_000
    assert month_reward(c, 2_000_000) == 5_000


def test_가맹점을_모르면_내_브랜드_비중으로_기대값을_낸다(state, catalog, priors, params):
    from dataclasses import replace
    starbucks = replace(catalog.merchants[10], brand_code="STARBUCKS")
    catalog.merchants[10] = starbucks
    state.relevant_brands = frozenset({"STARBUCKS"})
    for _ in range(30):
        state.apply(pay(101, 5_000, "CAFE", at(10, 1), merchant=10))
    mix = brand_mix(state, "CAFE", priors, params)
    assert mix == {"STARBUCKS": 1.0}
    assert brand_mix(state, "REST", priors, params) == {None: 1.0}


def test_카드의_업종_브랜드별_혜택_목록은_한_번만_고른다(monkeypatch):
    """2026-11-19 0.8초 문제: 월간 맞춤 방식 계산이 같은 (카드, 업종, 브랜드) 매칭을 수백만 번 반복했다."""
    c = card([Benefit(1, "CAFE", "discount", rate=0.10, brands=frozenset({"STARBUCKS"})),
              Benefit(2, "*", "discount", rate=0.01)])
    calls = []
    original = Benefit.matches
    monkeypatch.setattr(Benefit, "matches", lambda self, cat, brand: calls.append(1) or original(self, cat, brand))
    first = c.benefits_for("CAFE", "STARBUCKS")
    assert [b.benefit_id for b in first] == [1, 2] and len(calls) == 2
    assert list(c.benefits_for("CAFE", "STARBUCKS")) == list(first) and len(calls) == 2    # 두 번째는 다시 고르지 않는다
    assert [b.benefit_id for b in c.benefits_for("CAFE", "EDIYA")] == [2] and len(calls) == 4
    assert c == card(list(c.benefits))                                                  # 캐시는 카드 비교에 끼지 않는다
