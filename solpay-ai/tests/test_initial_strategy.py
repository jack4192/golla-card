from datetime import datetime
from zoneinfo import ZoneInfo
from engine.strategy import select_initial
from tests.conftest import pay, at


def test_insufficient_history_uses_temporary_B(state):
    result = select_initial(state.user, state.cards, state.catalog,
                            state.params, [], datetime(2026,11,1,tzinfo=ZoneInfo('Asia/Seoul')))
    assert result['strategy'] == 'main_top'
    assert result['status'] == 'insufficient_history'
    assert result['scores'] == {}


def test_future_and_current_month_excluded(state):
    rows = [pay(101, 5000, 'CAFE', at(11, day)) for day in range(1,12)]
    result = select_initial(state.user, state.cards, state.catalog,
                            state.params, rows, datetime(2026,11,15,tzinfo=ZoneInfo('Asia/Seoul')))
    assert result['status'] == 'insufficient_history'
    assert result['eligible_transactions'] == 0


def test_sufficient_history_returns_three_scores_and_is_deterministic(state):
    rows = [pay(101, 12000, 'CAFE', at(10, 1 + day)) for day in range(10)]
    args=(state.user, state.cards, state.catalog,
          state.params, rows, datetime(2026,11,15,tzinfo=ZoneInfo('Asia/Seoul')))
    result = select_initial(*args)
    assert result['status'] == 'ready'
    assert result['eligible_transactions'] == 10
    assert set(result['scores']) == {'first_tier', 'main_top', 'value'}
    assert select_initial(*args) == result
