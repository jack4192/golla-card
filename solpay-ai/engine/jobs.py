"""하루 한 번 작업 (2026-11-20).

지난 하루 일정 삭제: 결제 화면 요청(context)이 DB 에 쓰지 않도록, DB 저장소(`purge_daily = True`)의 지난 일정은
서버 시작 때 한 번, 그 뒤 매일 00:05(한국 시각)에 지운다. 서버가 여러 대여도 같은 DELETE 라 겹쳐도 된다.
CSV·parquet 저장소는 요청 때 메모리에서 지우므로 붙이지 않는다.
"""

import asyncio
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
PURGE_AT = time(0, 5)
log = logging.getLogger(__name__)


def seconds_until_next_purge(now: datetime) -> float:
    now = now.astimezone(KST)
    run = datetime.combine(now.date(), PURGE_AT, tzinfo=KST)
    if run <= now:
        run += timedelta(days=1)
    return (run - now).total_seconds()


def purge_past_schedules(store, now: datetime | None = None) -> int:
    """오늘(한국 날짜) 이전 일정을 지운다. 실패해도(읽기 전용 계정 등) 서버는 멈추지 않고 경고만 남긴다."""
    today = (now or datetime.now(KST)).astimezone(KST).date()
    try:
        n = store.purge_schedules(today)
    except Exception as e:
        log.warning("지난 일정 삭제 실패: %s", e)
        return 0
    log.info("지난 일정 %d건 삭제 (%s 이전)", n, today)
    return n


async def daily_purge(store) -> None:
    while True:
        await asyncio.sleep(seconds_until_next_purge(datetime.now(KST)))
        await asyncio.to_thread(purge_past_schedules, store)
