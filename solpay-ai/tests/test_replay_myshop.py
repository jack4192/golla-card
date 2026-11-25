"""재생 평가의 마이샵 가정 (2026-11-18 팀 결정).

마이샵 행사는 사용자가 ON 을 켜야 받는다. 습관대로 결제하는 고객은 사용자·행사·달마다 30% 만 ON 을 켰다고 본다.
SOL페이 이벤트는 ON 이 필요 없어 그대로 받는다.
"""

from datetime import datetime

from engine.domain import Promotion
from evaluation.replay import myshop_on, promo_received
from tests.conftest import KST

OCT = (datetime(2026, 10, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))
MYSHOP = Promotion(7, "할리스", *OCT, frozenset({51}), issuer="SHINHAN", rate=0.10, kind="myshop")
EVENT = Promotion(8, "할리스", *OCT, frozenset({51}), issuer="SHINHAN", amount=300, kind="event")
NOON = datetime(2026, 10, 7, 12, tzinfo=KST)


def test_ON_여부는_사용자_행사_달마다_고정이고_약_30퍼센트다():
    draws = [myshop_on(u, MYSHOP, "2026-10", 0.3) for u in range(2_000)]
    assert draws == [myshop_on(u, MYSHOP, "2026-10", 0.3) for u in range(2_000)]       # 다시 뽑아도 같다
    assert 0.27 < sum(draws) / len(draws) < 0.33
    assert not any(myshop_on(u, MYSHOP, "2026-10", 0.0) for u in range(100))
    assert all(myshop_on(u, MYSHOP, "2026-10", 1.0) for u in range(100))


def test_이벤트는_ON_과_상관없이_받는다():
    assert promo_received([EVENT], 51, "SHINHAN", 1, 6_000, NOON, lambda p: False) == 300


def test_마이샵은_ON_일_때만_받는다():
    assert promo_received([MYSHOP, EVENT], 51, "SHINHAN", 1, 6_000, NOON, lambda p: False) == 300   # 이벤트만
    assert promo_received([MYSHOP, EVENT], 51, "SHINHAN", 1, 6_000, NOON, lambda p: True) == 600    # 마이샵 10%
    assert promo_received([MYSHOP], None, "SHINHAN", 1, 6_000, NOON, lambda p: True) == 0           # 가맹점 모름
