import pytest

from engine.domain import UserCard
from engine.params import BASE_ORDER_TOP_TIER
from engine.rules import RuleError, parse_rule, resolve
from tests.conftest import USER_CARDS, at

MONDAY = at(10, 5, 8)       # 2026-10-05 월요일 08시


def force(**kw):
    data = {"rule_type": "force", "condition": {"days": ["mon"], "hours": [7, 9]}, "target": {"issuer": "SHINHAN"},
            "priority": 10, "source_text": "월요일 오전 7~9시는 신한카드로 해줘"}
    return parse_rule({**data, **kw})


def test_강제_규칙은_조건이_맞을_때만_적용한다(params):
    assert [c.user_card_id for c in resolve([force()], USER_CARDS, MONDAY, params).forced] == [101, 102]
    assert resolve([force()], USER_CARDS, at(10, 5, 9), params).forced == []
    assert resolve([force()], USER_CARDS, at(10, 6, 8), params).forced == []


def test_지정_카드를_보유하지_않으면_규칙을_건너뛴다(params):
    only_kb = [UserCard(103, 3, "KB", 1)]
    assert resolve([force()], only_kb, MONDAY, params).forced == []


def test_제외_규칙(params):
    rule = parse_rule({"rule_type": "exclude", "target": {"user_card_ids": [102]}})
    assert resolve([rule], USER_CARDS, MONDAY, params).excluded == {102}


def test_제외된_카드는_강제_규칙에서도_빠진다(params):
    exclude = parse_rule({"rule_type": "exclude", "target": {"user_card_ids": [101, 102]}})
    assert resolve([exclude, force()], USER_CARDS, MONDAY, params).forced == []


def test_성향_규칙은_범위_안에서만_바꾼다(params):
    rule = parse_rule({"rule_type": "preference", "settings": {"w1": 9, "w2": 0.1}})
    changed = resolve([rule], USER_CARDS, MONDAY, params).params
    assert (changed.w1, changed.w2) == (1.5, 0.5)


def test_순서_규칙으로_최고_구간_순서를_고른다(params):
    rule = parse_rule({"rule_type": "order", "settings": {"base_order": "top_tier"},
                       "source_text": "최고 구간까지 채우고 다음 카드로 넘어가줘"})
    assert resolve([rule], USER_CARDS, MONDAY, params).params.base_order == BASE_ORDER_TOP_TIER


def test_더_구체적인_규칙이_먼저고_같으면_최근_규칙이다(params):
    broad = parse_rule({"rule_type": "force", "target": {"user_card_ids": [103]}}, 1, 5)
    narrow = parse_rule({"rule_type": "force", "condition": {"hours": [7, 9]}, "target": {"user_card_ids": [101]}}, 2, 0)
    assert resolve([broad, narrow], USER_CARDS, MONDAY, params).forced_rule.rule_id == 2
    older = parse_rule({"rule_type": "force", "target": {"user_card_ids": [101]}}, 3, 1)
    newer = parse_rule({"rule_type": "force", "target": {"user_card_ids": [102]}}, 4, 2)
    assert resolve([older, newer], USER_CARDS, MONDAY, params).forced_rule.rule_id == 4


def test_평일_주말_별칭을_받는다():
    assert parse_rule({"rule_type": "exclude", "condition": {"days": ["weekday"]},
                       "target": {"issuer": "KB"}}).days == (0, 1, 2, 3, 4)


@pytest.mark.parametrize("bad", [
    {"rule_type": "unknown"},
    {"rule_type": "force"},
    {"rule_type": "exclude", "target": {"issuer": "KB"}, "condition": {"days": ["funday"]}},
    {"rule_type": "exclude", "target": {"issuer": "KB"}, "condition": {"hours": [9, 7]}},
    {"rule_type": "order", "settings": {"base_order": "random"}},
])
def test_잘못된_규칙은_거부한다(bad):
    with pytest.raises(RuleError):
        parse_rule(bad)
