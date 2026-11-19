from datetime import timedelta

from engine.domain import KnownPayment, RankRequest, ScheduleItem
from engine.scenarios import (MODE_KNOWN, MODE_REPEAT, MODE_SCHEDULE, MODE_TIME, amount_scenarios, build,
                              repeat_category, time_category_probs)
from tests.conftest import at, pay


def lunch_history(state, rest=8, cafe=2):
    for i in range(rest):
        state.apply(pay(102, 12_000, "REST", at(10, 1 + i % 2, 12), merchant=11))
    for i in range(cafe):
        state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12), merchant=10))


def test_이력이_없으면_전체_분포를_쓴다(state, priors, params):
    probs = time_category_probs(state, at(10, 7, 12), priors, params)
    assert probs == {"REST": 0.6, "CAFE": 0.4}


def test_이력이_적으면_개인과_전체_분포를_섞는다(state, priors, params):
    for _ in range(10):
        state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12)))
    probs = time_category_probs(state, at(10, 7, 12), priors, params)
    assert probs["CAFE"] == (10 + 10 * 0.4) / 20


def test_이력이_충분하면_개인_빈도만_쓴다(state, priors, params):
    for _ in range(20):
        state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12)))
    assert time_category_probs(state, at(10, 7, 12), priors, params) == {"CAFE": 1.0}


def test_반복_구간은_8건과_50퍼센트를_모두_넘어야_한다(state, priors, params):
    lunch_history(state, rest=5, cafe=2)
    probs = time_category_probs(state, at(10, 7, 12), priors, params)
    assert repeat_category(state, at(10, 7, 12), probs, params) is None
    lunch_history(state, rest=3, cafe=0)
    probs = {"REST": 0.72, "CAFE": 0.28}
    assert repeat_category(state, at(10, 7, 12), probs, params) == "REST"
    assert repeat_category(state, at(10, 7, 12), {"REST": 0.4, "CAFE": 0.3}, params) is None


def test_반복_구간이면_1위_업종_하나로_본다(state, catalog, priors, params):
    lunch_history(state)
    result = build(state, RankRequest(2, at(10, 7, 12)), catalog, priors, params)
    assert result.mode == MODE_REPEAT and result.repeat_category == "REST"
    assert [(s.category, s.prob) for s in result.scenarios] == [("REST", 1.0)]


def test_금액은_사용자_중앙값을_쓰고_이력이_적으면_전체_중앙값을_쓴다(state, priors, params):
    assert amount_scenarios(state, "REST", priors, params) == (12000,)
    for amount in (1000, 2000, 3000, 4000, 50000):
        state.apply(pay(101, amount, "REST", at(10, 1)))
    assert amount_scenarios(state, "REST", priors, params) == (3000,)


def test_알고_있는_결제는_평가에서만_쓴다(state, catalog, priors, params):
    result = build(state, RankRequest(2, at()), catalog, priors, params, known=KnownPayment("REST", 12_000))
    assert result.mode == MODE_KNOWN and result.scenarios[0].amounts == (12_000,)


def test_브랜드_매칭은_브랜드명_또는_이름_앞부분(catalog):
    from engine.loader import promotion_from_row
    from tests.conftest import at
    row = {"promotion_id": 9, "brand": "카페", "starts_at": at(10, 1), "ends_at": at(10, 31), "issuer_code": "SHINHAN",
           "amount": 500, "rate": None, "min_amount": 0, "max_amount": None, "title": "t", "kind": "event", "needs_check": False}
    assert promotion_from_row(row, catalog).merchant_ids == {10}
    assert promotion_from_row({**row, "brand": "먼 식당"}, catalog).merchant_ids == {12}
    assert promotion_from_row({**row, "brand": "없는 브랜드"}, catalog).merchant_ids == frozenset()


def golf(start_h=12, end_h=14, amount=200_000, category="GOLF"):
    return ScheduleItem(1, 1, at(10, 7, start_h), at(10, 7, end_h), category, amount)


def test_일정_시간에는_입력한_업종과_금액으로_확정한다(state, catalog, priors, params):
    result = build(state, RankRequest(1, at(10, 7, 13)), catalog, priors, params, schedules=[golf()])
    assert result.mode == MODE_SCHEDULE
    assert [(s.category, s.prob, s.amounts) for s in result.scenarios] == [("GOLF", 1.0, (200_000,))]


def test_일정은_시작_30분_전부터_끝_30분_뒤까지(state, catalog, priors, params):
    item = golf()
    for when, expected in ((item.start - timedelta(minutes=31), MODE_TIME), (item.start - timedelta(minutes=30), MODE_SCHEDULE),
                           (item.end + timedelta(minutes=30), MODE_SCHEDULE), (item.end + timedelta(minutes=31), MODE_TIME)):
        assert build(state, RankRequest(1, when), catalog, priors, params, schedules=[item]).mode == expected


def test_일정_업종을_이미_결제했으면_그_일정은_끝난_것으로_본다(state, catalog, priors, params):
    state.apply(pay(101, 200_000, "GOLF", at(10, 7, 13)))
    assert build(state, RankRequest(1, at(10, 7, 13, 30)), catalog, priors, params, schedules=[golf()]).mode != MODE_SCHEDULE


def test_겹치는_일정은_확률을_나눈다(state, catalog, priors, params):
    items = [golf(), ScheduleItem(2, 1, at(10, 7, 13), at(10, 7, 14), "CAFE", 6_000)]
    result = build(state, RankRequest(1, at(10, 7, 13, 10)), catalog, priors, params, schedules=items)
    assert sorted((s.category, s.prob) for s in result.scenarios) == [("CAFE", 0.5), ("GOLF", 0.5)]


def test_일정이_없으면_소비_패턴으로_정한다(state, catalog, priors, params):
    result = build(state, RankRequest(1, at(10, 7, 12)), catalog, priors, params, schedules=[golf(16, 18)])
    assert result.mode == MODE_TIME
