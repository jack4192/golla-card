import pytest
from engine.rules import parse_rule, RuleError

@pytest.mark.parametrize('name', ['first_tier','main_top','value'])
def test_all_three_modes_accepted(name):
    assert parse_rule({'rule_type':'order','settings':{'base_order':name}}).base_order == name


def test_unrecognized_mode_rejected():
    with pytest.raises(RuleError):
        parse_rule({'rule_type':'order','settings':{'base_order':'auto'}})


def test_initial_is_durable_and_not_overwritten_by_reselection(tmp_path):
    from engine.strategy_store import StrategyStore
    p=tmp_path/'choices.sqlite'
    repo=StrategyStore(p)
    assert repo.initialize(1,'first_tier')['strategy'] == 'first_tier'
    assert repo.initialize(1,'value')['strategy'] == 'first_tier'
    assert StrategyStore(p).get(1)['strategy'] == 'first_tier'


def test_confirmed_change_is_persistent(tmp_path):
    from engine.strategy_store import StrategyStore
    repo=StrategyStore(tmp_path/'choices.sqlite')
    repo.initialize(1,'first_tier')
    repo.confirm_change(1,'value')
    assert StrategyStore(tmp_path/'choices.sqlite').get(1)['strategy'] == 'value'


def test_rank_plan_uses_saved_strategy_and_no_monthly_reselection(catalog):
    from engine.domain import User, UserCard
    from engine.params import Params
    from engine.state import UserState
    from engine.perf_value import month_plan
    state=UserState(User(1),[UserCard(101,1,'SHINHAN',1)],catalog,Params(base_order='auto'))
    state.fixed_strategy='value'
    state.roll_to('2026-10')
    assert month_plan(state).strategy == 'value'
    state.roll_to('2026-11')
    assert month_plan(state).strategy == 'value'


def test_missing_strategy_uses_B(catalog):
    from engine.domain import User, UserCard
    from engine.params import Params
    from engine.state import UserState
    from engine.perf_value import month_plan
    state=UserState(User(1),[UserCard(101,1,'SHINHAN',1)],catalog,Params(base_order='auto'))
    state.roll_to('2026-10')
    assert month_plan(state).strategy == 'main_top'


def test_month_strategy_overrides_initial_for_the_month(catalog):
    from engine.domain import User, UserCard
    from engine.params import Params
    from engine.state import UserState
    from engine.perf_value import month_plan
    state=UserState(User(1),[UserCard(101,1,'SHINHAN',1)],catalog,Params(base_order='auto'))
    state.fixed_strategy='value'
    state.month_strategy='none'
    state.roll_to('2026-10')
    assert month_plan(state).strategy == 'none'


def test_user_can_confirm_no_filling(tmp_path):
    from engine.strategy_store import StrategyStore
    repo=StrategyStore(tmp_path/'choices.sqlite')
    assert repo.confirm_change(1,'none')['strategy'] == 'none'
    with pytest.raises(ValueError):
        repo.initialize(2,'none')          # 최초 추천은 세 방식 중에서만


def _monthly_inputs(catalog):
    from datetime import datetime, timedelta
    from engine.domain import User, UserCard
    from tests.conftest import at, pay
    cards=[UserCard(101,1,'SHINHAN',1),UserCard(102,2,'SHINHAN',2)]
    start=at(7,1)
    payments=[pay(101 if i%3 else 102, 9_000, "CAFE", start+timedelta(days=i)) for i in range(92)]
    return User(1), cards, payments


def test_monthly_pick_compares_candidates_on_past_months(catalog):
    from engine.params import Params
    from engine.strategy import monthly_pick
    from tests.conftest import at
    user, cards, payments = _monthly_inputs(catalog)
    out=monthly_pick(user, cards, catalog, Params(), payments, at(10,5,9), 'value')
    assert out['status'] == 'ready'
    assert set(out['scores']) == {'value','main_top','first_tier','none'}
    assert out['scores'][out['strategy']] == max(out['scores'].values())
    # 동점이면 최초 선택 방식을 유지한다
    if len(set(out['scores'].values())) == 1:
        assert out['strategy'] == 'value'


def test_monthly_pick_off_or_short_history_keeps_initial(catalog):
    from engine.params import Params
    from engine.strategy import monthly_pick
    from tests.conftest import at
    user, cards, payments = _monthly_inputs(catalog)
    assert monthly_pick(user, cards, catalog, Params(adaptive_months=0), payments, at(10,5), 'value')['strategy'] == 'value'
    short=monthly_pick(user, cards, catalog, Params(), payments[:5], at(10,5), 'value')
    assert short == {**short, 'strategy':'value','status':'insufficient_history'}
