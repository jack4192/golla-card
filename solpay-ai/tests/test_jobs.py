"""하루 한 번 작업: 지난 일정 삭제 (engine/jobs.py, 2026-11-20).

결제 화면 요청(context)은 DB 에 쓰지 않고, 지난 일정은 서버 시작 때와 매일 00:05(한국 시각)에 지운다.
"""

from datetime import date, datetime, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from engine.jobs import purge_past_schedules, seconds_until_next_purge

KST = ZoneInfo("Asia/Seoul")


def test_next_purge_is_five_past_midnight_kst():
    assert seconds_until_next_purge(datetime(2026, 11, 5, 12, 20, tzinfo=KST)) == 11 * 3600 + 45 * 60
    assert seconds_until_next_purge(datetime(2026, 11, 5, 0, 1, tzinfo=KST)) == 4 * 60
    assert seconds_until_next_purge(datetime(2026, 11, 5, 0, 5, tzinfo=KST)) == 24 * 3600   # 막 돌았으면 다음 날
    assert seconds_until_next_purge(datetime(2026, 11, 4, 15, 1, tzinfo=timezone.utc)) == 4 * 60   # UTC 서버 = 00:01 KST


def test_purge_uses_today_in_kst():
    calls = []
    store = SimpleNamespace(purge_schedules=lambda today: calls.append(today) or 3)
    assert purge_past_schedules(store, datetime(2026, 11, 4, 15, 30, tzinfo=timezone.utc)) == 3
    assert calls == [date(2026, 11, 5)]


def test_purge_failure_is_logged_not_raised(caplog):
    def read_only(today):
        raise RuntimeError("permission denied for table schedules")
    assert purge_past_schedules(SimpleNamespace(purge_schedules=read_only), datetime(2026, 11, 5, tzinfo=KST)) == 0
    assert "permission denied" in caplog.text


def _app_with(store):
    from engine.api import create_app
    return create_app(SimpleNamespace(store=store), chat_client=None)


def _db_like(events):
    return SimpleNamespace(purge_daily=True, purge_schedules=lambda today: events.append("purge") or 0,
                           close=lambda: events.append("close"))


def test_db_store_is_purged_at_startup_and_closed_at_shutdown(monkeypatch):
    import engine.api
    events = []
    store = _db_like(events)
    monkeypatch.setattr(engine.api, "build_service", lambda: SimpleNamespace(store=store))
    with TestClient(engine.api.create_app(chat_client=None)):
        assert events == ["purge"]              # 첫 요청 전에 한 번
    assert events == ["purge", "close"]         # 앱이 만든 저장소는 앱이 닫는다 (연결 풀 반납)


def test_store_passed_in_is_not_closed_by_the_app():
    """테스트처럼 밖에서 넣은 저장소는 여러 앱이 함께 쓰므로 닫지 않는다."""
    events = []
    with TestClient(_app_with(_db_like(events))):
        pass
    assert events == ["purge"]


def test_memory_stores_are_not_purged_by_the_job():
    """CSV·parquet 저장소는 요청 때 메모리에서 지우므로 하루 작업을 붙이지 않는다 (미리 넣은 시연 일정 보존)."""
    events = []
    store = SimpleNamespace(purge_schedules=lambda today: events.append("purge") or 0)
    with TestClient(_app_with(store)):
        pass
    assert events == []
