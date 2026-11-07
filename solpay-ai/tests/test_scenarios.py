from engine.domain import KnownPayment, RankRequest
from engine.scenarios import (MODE_CANDIDATES, MODE_CANDIDATES_REPEAT, MODE_CONFIRMED, MODE_KNOWN, MODE_REPEAT,
                              MODE_TIME, amount_scenarios, build, repeat_category, time_category_probs)
from tests.conftest import at, pay


def lunch_history(state, rest=8, cafe=2):
    for i in range(rest):
        state.apply(pay(102, 12_000, "REST", at(10, 1 + i % 2, 12), merchant=11))
    for i in range(cafe):
        state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12), merchant=10))


def test_이력이_없으면_전체_분포를_쓴다(no_consent_state, priors, params):
    probs = time_category_probs(no_consent_state, at(10, 7, 12), priors, params)
    assert probs == {"REST": 0.6, "CAFE": 0.4}


def test_이력이_적으면_개인과_전체_분포를_섞는다(no_consent_state, priors, params):
    for _ in range(10):
        no_consent_state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12)))
    probs = time_category_probs(no_consent_state, at(10, 7, 12), priors, params)
    assert probs["CAFE"] == (10 + 10 * 0.4) / 20


def test_이력이_충분하면_개인_빈도만_쓴다(no_consent_state, priors, params):
    for _ in range(20):
        no_consent_state.apply(pay(101, 5_000, "CAFE", at(10, 1, 12)))
    assert time_category_probs(no_consent_state, at(10, 7, 12), priors, params) == {"CAFE": 1.0}


def test_반복_구간은_8건과_50퍼센트를_모두_넘어야_한다(no_consent_state, priors, params):
    lunch_history(no_consent_state, rest=5, cafe=2)
    probs = time_category_probs(no_consent_state, at(10, 7, 12), priors, params)
    assert repeat_category(no_consent_state, at(10, 7, 12), probs, params) is None
    lunch_history(no_consent_state, rest=3, cafe=0)
    probs = {"REST": 0.72, "CAFE": 0.28}
    assert repeat_category(no_consent_state, at(10, 7, 12), probs, params) == "REST"
    assert repeat_category(no_consent_state, at(10, 7, 12), {"REST": 0.4, "CAFE": 0.3}, params) is None


def test_미동의_버전은_좌표가_와도_쓰지_않는다(no_consent_state, catalog, priors, params):
    req = RankRequest(2, at(10, 7, 12), 37.5, 127.0, 10, selected_merchant_id=10)
    result = build(no_consent_state, req, catalog, priors, params)
    assert result.mode == MODE_TIME and result.chips == []


def test_미동의_버전의_반복_구간(no_consent_state, catalog, priors, params):
    lunch_history(no_consent_state)
    result = build(no_consent_state, RankRequest(2, at(10, 7, 12)), catalog, priors, params)
    assert result.mode == MODE_REPEAT and result.repeat_category == "REST"
    assert [(s.category, s.prob) for s in result.scenarios] == [("REST", 1.0)]


def test_후보가_1곳이고_정확하면_가맹점을_확정한다(consent_state, catalog, priors, params):
    req = RankRequest(1, at(10, 7, 12), 37.5100, 127.0, 20)
    result = build(consent_state, req, catalog, priors, params)
    assert result.mode == MODE_CONFIRMED and result.scenarios[0].merchants == {12: 1.0}


def test_후보가_1곳이어도_정확도가_낮으면_확정하지_않는다(consent_state, catalog, priors, params):
    req = RankRequest(1, at(10, 7, 12), 37.5100, 127.0, 60)
    assert build(consent_state, req, catalog, priors, params).mode == MODE_CANDIDATES


def test_후보가_여러_곳이면_칩을_보여준다(consent_state, catalog, priors, params):
    req = RankRequest(1, at(10, 7, 12), 37.5001, 127.0, 20)
    result = build(consent_state, req, catalog, priors, params)
    assert result.mode == MODE_CANDIDATES
    assert {c["merchant_id"] for c in result.chips} == {10, 11}
    assert abs(sum(s.prob for s in result.scenarios) - 1) < 1e-9


def test_칩을_누르면_가맹점을_확정한다(consent_state, catalog, priors, params):
    req = RankRequest(1, at(10, 7, 12), 37.5001, 127.0, 20, selected_merchant_id=10)
    result = build(consent_state, req, catalog, priors, params)
    assert result.mode == MODE_CONFIRMED and result.scenarios[0].category == "CAFE"


def test_후보에_반복_구간_1위_업종이_있으면_그_업종으로_계산한다(consent_state, catalog, priors, params):
    lunch_history(consent_state)
    req = RankRequest(1, at(10, 7, 12), 37.5001, 127.0, 20)
    result = build(consent_state, req, catalog, priors, params)
    assert result.mode == MODE_CANDIDATES_REPEAT and result.repeat_category == "REST"
    assert len(result.chips) == 2


def test_후보에_1위_업종이_없으면_위치를_따른다(consent_state, catalog, priors, params):
    for i in range(10):
        consent_state.apply(pay(101, 2_000, "CVS", at(10, 1, 12), merchant=None))
    req = RankRequest(1, at(10, 7, 12), 37.5001, 127.0, 20)
    assert build(consent_state, req, catalog, priors, params).mode == MODE_CANDIDATES


def test_위치_후보가_없으면_미동의_버전과_같게_계산한다(consent_state, no_consent_state, catalog, priors, params):
    far = RankRequest(1, at(10, 7, 12), 36.0, 128.0, 20)
    a = build(consent_state, far, catalog, priors, params)
    b = build(no_consent_state, RankRequest(2, at(10, 7, 12)), catalog, priors, params)
    assert a.mode == b.mode == MODE_TIME
    assert [(s.category, s.prob) for s in a.scenarios] == [(s.category, s.prob) for s in b.scenarios]


def test_금액은_사용자_분위수를_쓰고_이력이_적으면_전체_분포를_쓴다(no_consent_state, priors, params):
    assert amount_scenarios(no_consent_state, "REST", priors, params) == (9000, 12000, 15000)
    for amount in (1000, 2000, 3000, 4000, 5000):
        no_consent_state.apply(pay(101, amount, "REST", at(10, 1)))
    assert amount_scenarios(no_consent_state, "REST", priors, params) == (2000, 3000, 4000)


def test_알고_있는_결제는_평가에서만_쓴다(no_consent_state, catalog, priors, params):
    result = build(no_consent_state, RankRequest(2, at()), catalog, priors, params, known=KnownPayment("REST", 12_000))
    assert result.mode == MODE_KNOWN and result.scenarios[0].amounts == (12_000,)
