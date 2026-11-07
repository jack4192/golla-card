"""생활패턴 구간: 평일/주말 × 시간대."""

from datetime import datetime

from engine.params import Params

BAND_NAMES = ("새벽", "아침", "오전", "점심", "오후", "저녁", "밤")
BAND_HOURS = ((0, 7), (7, 10), (10, 11), (11, 14), (14, 17), (17, 21), (21, 24))

Slot = tuple[bool, int]     # (주말 여부, 시간대 번호)


def band_of(hour: int) -> int:
    for i, (start, end) in enumerate(BAND_HOURS):
        if start <= hour < end:
            return i
    raise ValueError(f"잘못된 시각: {hour}")


def is_weekend(at: datetime, params: Params) -> bool:
    return at.weekday() >= 5 or at.strftime("%Y-%m-%d") in params.holidays


def slot_of(at: datetime, params: Params) -> Slot:
    return is_weekend(at, params), band_of(at.hour)


def slot_key(slot: Slot) -> str:
    return f"{int(slot[0])}|{slot[1]}"


def slot_label(slot: Slot) -> str:
    return f"{'주말' if slot[0] else '평일'} {BAND_NAMES[slot[1]]}"


def ym_of(at: datetime) -> str:
    return f"{at.year:04d}-{at.month:02d}"
