"""하루 배치 한 번에 (앱 홈 '내 지갑' 시간 표시줄, 2026-11-23 설계서 home-day-timeline).

그날 매시 정각과 일정의 시작·끝에서 배치를 계산하고, 1순위가 같은 이웃 점을 한 구간으로 합친다.
엔진의 시간대 경계는 모두 정각이라 이 점들이면 바뀌는 순간을 놓치지 않는다.

2026-11-24 사용자 결정 '표시줄은 일정 시각에 맞춤': 결제 배치는 일정 30분 전·끝 30분 후까지 그 일정을 보지만(일정 창),
표시줄은 점마다 그 시각을 덮는 일정만 보고 계산한다 (covering). 밖의 점은 일정 없이 = 평소 카드.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from engine.domain import RankResult, ScheduleItem

KST = ZoneInfo("Asia/Seoul")


def day_points(day: date, schedules: list[ScheduleItem]) -> list[datetime]:
    start = datetime.combine(day, time(0), tzinfo=KST)
    end = start + timedelta(days=1)
    points = {start + timedelta(hours=h) for h in range(24)}
    for item in schedules:
        for edge in (item.start, item.end):
            edge = edge.astimezone(KST)
            if start <= edge < end:
                points.add(edge)
    return sorted(points)


def covering(schedules: list[ScheduleItem], at: datetime) -> list[ScheduleItem]:
    """그 시각을 덮는 일정 (시작 ≤ 시각 < 끝). 표시줄의 점마다 이 일정만 보고 계산한다."""
    return [item for item in schedules if item.start <= at < item.end]


def _hhmm(day: date, at: datetime) -> str:
    return "24:00" if at.astimezone(KST).date() > day else at.astimezone(KST).strftime("%H:%M")


def merge_segments(day: date, results: list[tuple[datetime, RankResult]]) -> list[dict]:
    """[(점 시각, 배치)] → [{start, end, user_card_id, message, reason_code, cards}]. 카드 없는 점만 있으면 []."""
    if not any(result.cards for _, result in results):
        return []
    day_end = datetime.combine(day, time(0), tzinfo=KST) + timedelta(days=1)
    segments: list[dict] = []
    for at, result in results:
        top = result.cards[0].user_card_id if result.cards else None
        if segments and segments[-1]["user_card_id"] == top:
            continue
        segments.append({
            "start": _hhmm(day, at), "end": None, "user_card_id": top,
            "message": result.cards[0].message if result.cards else "",
            "reason_code": result.reason_code,
            "cards": [{"user_card_id": c.user_card_id, "rank": c.rank} for c in result.cards],
        })
    for a, b in zip(segments, segments[1:]):
        a["end"] = b["start"]
    segments[-1]["end"] = _hhmm(day, day_end)
    return segments
