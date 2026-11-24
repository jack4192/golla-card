"""하루 배치 한 번에 (앱 홈 시간 표시줄, 2026-11-23 설계서 home-day-timeline). 기록은 남기지 않는다."""
from datetime import date

import pytest

from engine.day_plan import day_points, merge_segments
from engine.domain import RankedCard, RankResult, ScheduleItem, User
from engine.service import PlacementEngine, PlacementService
from engine.store import UserContext
from tests.conftest import at
from tests.test_service_api import FakeStore, client

D = date(2026, 10, 7)
NOW = "2026-10-07T12:20:00+09:00"


@pytest.fixture
def svc(catalog, priors, params):
    return PlacementService(FakeStore(User(1)), PlacementEngine(catalog, priors, params))


def _result(top: int | None) -> RankResult:
    cards = [] if top is None else [RankedCard(top, 1, 1000, f"{top} 문구"), RankedCard(999, 2, 0, "")]
    return RankResult(cards, len(cards), "TEST", None, "pattern", "normal", top or 0)


def test_하루_점은_매시_정각과_일정_시작_끝이다():
    # 2026-11-24 사용자 결정: 표시줄은 일정 시각에 맞춘다 (일정 창 30분 앞뒤는 평소 카드)
    lunch = ScheduleItem(1, 1, at(hour=12, minute=15), at(hour=13, minute=40), "RESTAURANT", 9000)
    points = day_points(D, [lunch])
    assert len(points) == 26
    assert points[0] == at(hour=0)
    assert at(hour=12, minute=15) in points and at(hour=13, minute=40) in points
    assert at(hour=11, minute=45) not in points and at(hour=14, minute=10) not in points
    assert points == sorted(points)


def test_자정을_넘는_일정_경계는_그날_안에서만_쓴다():
    late = ScheduleItem(1, 1, at(hour=23, minute=50), at(day=8, hour=0, minute=20), "CONVENIENCE", 3000)
    points = day_points(D, [late])
    assert at(hour=23, minute=50) in points
    assert all(p.date() == D for p in points)


def test_일정_밖의_시각은_일정_없이_계산한다(svc):
    """일정 시간 안의 점만 그 일정을 보고, 밖의 점(일정 30분 전·끝난 뒤 포함)은 일정 없이 계산한다."""
    lunch = ScheduleItem(1, 1, at(hour=12, minute=15), at(hour=13, minute=40), "RESTAURANT", 9000)
    svc.store.put_schedule(1, D, [lunch])
    seen = {}
    original = svc.preview

    def spy(user_id, when, known=None, context=None):
        seen[when] = list((context or svc.store.context(user_id, when)).schedules)
        return original(user_id, when, known=known, context=context)

    svc.preview = spy
    svc.day_placement(1, D, at(hour=12, minute=20))
    assert seen[at(hour=12)] == [] and seen[at(hour=13, minute=40)] == [] and seen[at(hour=14)] == []
    assert seen[at(hour=12, minute=15)] == [lunch] and seen[at(hour=13)] == [lunch]


def test_같은_1순위가_이어지면_한_구간으로_합친다():
    segments = merge_segments(D, [(at(hour=0), _result(101)), (at(hour=1), _result(101)), (at(hour=2), _result(102))])
    assert [(s["start"], s["end"], s["user_card_id"]) for s in segments] == [("00:00", "02:00", 101), ("02:00", "24:00", 102)]
    assert segments[0]["message"] == "101 문구" and segments[0]["reason_code"] == "TEST"
    assert segments[1]["cards"] == [{"user_card_id": 102, "rank": 1}, {"user_card_id": 999, "rank": 2}]


def test_카드가_없는_결과만_있으면_빈_구간이다():
    assert merge_segments(D, [(at(hour=0), _result(None)), (at(hour=1), _result(None))]) == []


def test_구간은_하루를_빈틈없이_덮는다(svc):
    with client(svc) as c:
        body = c.post("/internal/users/1/day-placement", json={"day": "2026-10-07", "now": NOW}).json()
    segments = body["segments"]
    assert body["day"] == "2026-10-07" and segments
    assert segments[0]["start"] == "00:00" and segments[-1]["end"] == "24:00"
    assert all(a["end"] == b["start"] for a, b in zip(segments, segments[1:]))


def test_하루_배치는_기록을_남기지_않는다(svc):
    with client(svc) as c:
        assert c.post("/internal/users/1/day-placement", json={"day": "2026-10-07", "now": NOW}).status_code == 200
    assert svc.store.logs == []


def test_앞으로의_시각은_기준_시각_이후_결제를_쓰지_않는다(svc):
    seen = []
    original = svc.store.context

    def spy(user_id, when):
        seen.append(when)
        return original(user_id, when)

    svc.store.context = spy
    now = at(hour=12, minute=20)
    svc.day_placement(1, D, now)
    assert seen and max(seen) <= now


def test_카드가_없는_사용자는_빈_구간이다(svc):
    svc.store.context = lambda user_id, when: UserContext(User(1), [], [])
    assert svc.day_placement(1, D, at(hour=12, minute=20)) == {"day": "2026-10-07", "segments": []}


def test_없는_사용자는_404(svc):
    with client(svc) as c:
        r = c.post("/internal/users/99/day-placement", json={"day": "2026-10-07", "now": NOW})
    assert r.status_code == 404 and r.json()["detail"] == "없는 사용자입니다"
