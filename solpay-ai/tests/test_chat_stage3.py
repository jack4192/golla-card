"""챗봇 고도화 3단계 (2026-11-24, docs/superpowers/specs/2026-11-24-chatbot-stage3-design.md).

채팅으로 일정 초안(draft_schedule), 규칙 지우기 초안(draft_rule_delete). ('자세히' 버튼은 2026-11-24 사용자 결정으로 뺐다)
저장은 앱이 기존 API 로 한다 (일정: saveEvent → POST /api/schedules, 규칙: GET·PUT /api/ai/rules).
"""

from engine.chat import guard, prompts
from engine.chat.tools import TOOL_SPECS, block_summary
from tests.test_chat import AT, DEMO, _agent, _tool_call, service, tb  # noqa: F401


def _block(tb, kind):
    return next(b for b in reversed(tb.blocks) if b["type"] == kind)


# ---------- 데이터 없이 ----------

def test_도구_17개와_지시문():
    names = [t["function"]["name"] for t in TOOL_SPECS]
    assert len(names) == 17 and "draft_schedule" in names and "draft_rule_delete" in names
    text = prompts.system_prompt(AT, ["KB ALL 카드"])
    assert "draft_schedule" in text and "draft_rule_delete" in text
    assert "지우는 기능은 챗봇에 아직 없다" not in text


def test_저장했다는_말은_일정·지우기에도_검사():
    for claim in ("일정을 추가했어요.", "규칙을 삭제했어요.", "규칙을 지웠어요."):
        assert guard.check(claim, set(), has_rule_draft=True), claim


# ---------- 일정 초안 ----------

def test_상황_일정_초안(tb):
    tb.user_words = "내일 12시부터 2시까지 회식 일정 넣어줘"
    r = tb.run("draft_schedule", {"day": "tomorrow", "kind": "situation", "event_type": "team_dinner",
                                  "start": "12:00", "end": "14:00", "source_text": tb.user_words})
    assert r["saved"] is False and "회식" in r["draft"] and "11월 6일" in r["draft"]
    b = _block(tb, "schedule_draft")
    assert b["input"] == {"date": "2026-11-06", "types": ["team_dinner"], "start": "12:00", "end": "14:00"}
    assert tb.has_draft()


def test_시간_없는_상황_일정은_하루_종일(tb):
    tb.user_words = "모레 병원 예약 일정 넣어줘"
    r = tb.run("draft_schedule", {"day": "day_after_tomorrow", "kind": "situation", "event_type": "hospital",
                                  "source_text": tb.user_words})
    assert "하루 종일" in r["draft"]
    assert _block(tb, "schedule_draft")["input"] == {"date": "2026-11-07", "types": ["hospital"]}


def test_장소_일정_초안(tb):
    tb.user_words = "오늘 3시부터 4시까지 카페 일정 추가해줘"
    tb.run("draft_schedule", {"day": "today", "kind": "place", "place_category": "cafe", "start": "15:00", "end": "16:00",
                              "source_text": tb.user_words})
    assert _block(tb, "schedule_draft")["input"] == {"date": "2026-11-05", "category": "cafe", "start": "15:00",
                                                     "end": "16:00", "title": ""}


def test_야구도_장소_일정_업종(tb):          # 2026-11-24: 앱 장소 일정 빠른 선택에 '야구'(baseball)를 더함
    tb.user_words = "내일 6시부터 9시까지 야구 일정 넣어줘"
    tb.run("draft_schedule", {"day": "tomorrow", "kind": "place", "place_category": "baseball", "start": "18:00",
                              "end": "21:00", "source_text": tb.user_words})
    b = _block(tb, "schedule_draft")
    assert b["input"]["category"] == "baseball" and "야구" in b["summary"]
    assert "baseball 야구" in prompts.system_prompt(AT, ["KB ALL 카드"])


def test_장소_일정의_끝_시간을_말하지_않았으면_되묻기(tb):
    tb.user_words = "오늘 3시에 카페 일정 추가해줘"
    for args in ({"start": "15:00"}, {"start": "15:00", "end": "16:00"}):     # 끝 시간을 지어내도 받지 않는다
        r = tb.run("draft_schedule", {"day": "today", "kind": "place", "place_category": "cafe", "source_text": "x", **args})
        assert r.get("need") == "end", args
    assert not tb.has_draft() and not [b for b in tb.blocks if b["type"] == "schedule_draft"]


def test_일정_날짜와_요청_검사(tb):
    tb.user_words = "11월 1일 12시부터 1시까지 회식 일정 넣어줘"
    past = tb.run("draft_schedule", {"date": "2026-11-01", "kind": "situation", "event_type": "team_dinner",
                                     "start": "12:00", "end": "13:00", "source_text": "x"})
    assert "error" in past
    far = tb.run("draft_schedule", {"date": "2026-12-20", "kind": "situation", "event_type": "team_dinner", "source_text": "x"})
    assert "error" in far
    tb.user_words = "기타 일정 넣어줘 내일"
    assert tb.run("draft_schedule", {"day": "tomorrow", "kind": "situation", "event_type": "other",
                                     "source_text": "x"}).get("need") == "title"
    tb.user_words = "'내일 회식 일정 넣어'라는 가맹점에서 5000원 결제하면?"
    assert tb.run("draft_schedule", {"day": "tomorrow", "kind": "situation", "event_type": "team_dinner",
                                     "source_text": "x"}).get("need") == "request"


# ---------- 규칙 지우기 초안 ----------

def _two_rules(service, tb):
    kb = next(c.user_card_id for c in tb.cards if "KB" in tb.names[c.user_card_id])
    travel = next(c.user_card_id for c in tb.cards if "트래블" in tb.names[c.user_card_id])
    service.store.save_rules(DEMO, [
        {"rule_type": "force", "condition": {"days": ["weekend"]}, "target": {"user_card_ids": [kb]}, "settings": {},
         "source_text": "주말엔 KB 먼저"},
        {"rule_type": "exclude", "condition": {}, "target": {"user_card_ids": [travel]}, "settings": {},
         "source_text": "트래블 카드는 빼 줘"}])


def test_규칙_지우기_초안(service, tb):
    service.store.reset()
    assert tb.run("draft_rule_delete", {"query": "주말 KB"}).get("count") == 0       # 저장된 규칙이 없으면 알려 준다
    _two_rules(service, tb)
    try:
        one = tb.run("draft_rule_delete", {"query": "주말 KB"})
        assert one["saved"] is False and len(one["rules"]) == 1 and "KB" in one["rules"][0]
        b = _block(tb, "rule_delete_draft")
        assert len(b["rules"]) == 1 and b["rules"][0]["rule"]["rule_type"] == "force" and b["summary"]
        every = tb.run("draft_rule_delete", {"all": True})
        assert len(every["rules"]) == 2
        assert "error" in tb.run("draft_rule_delete", {"query": "편의점 규칙"})
        assert "candidates" in tb.run("draft_rule_delete", {"query": "규칙"})            # 둘 다 맞으면 되묻기
        assert len(service.store.raw_rules(DEMO)) == 2                                  # 초안만, 지우지 않는다
    finally:
        service.store.reset()


# ---------- 에이전트 ----------

def test_일정_초안이_있으면_아래_카드_안내는_통과(service):
    agent, _ = _agent(service, [
        [_tool_call(1, "draft_schedule", {"day": "tomorrow", "kind": "situation", "event_type": "team_dinner",
                                          "start": "12:00", "end": "14:00", "source_text": "내일 12시부터 2시까지 회식"})],
        "내일 12:00~14:00 회식 일정 초안을 만들었어요. 아래 카드에서 '일정에 추가'를 누르면 저장돼요."])
    out = agent.answer(DEMO, "내일 12시부터 2시까지 회식 일정 넣어줘", AT, [], {"name": "home"})
    assert out["log"]["retries"] == 0 and any(b["type"] == "schedule_draft" for b in out["blocks"])


def test_초안_요약_문장(tb):
    tb.user_words = "내일 12시부터 2시까지 회식 일정 넣어줘"
    tb.run("draft_schedule", {"day": "tomorrow", "kind": "situation", "event_type": "team_dinner",
                              "start": "12:00", "end": "14:00", "source_text": "x"})
    text = block_summary(tb.blocks)
    assert text and "일정에 추가" in text
    assert guard.check(text, guard.collect_facts(tb.results), True, False) == []
