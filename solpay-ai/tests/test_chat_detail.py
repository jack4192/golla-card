"""챗봇 고도화 1단계 (2026-11-24, docs/superpowers/specs/2026-11-24-chatbot-stage1-design.md).

- 기본 답을 지금보다 자세히, '자세히'를 입력하면 더 자세히 (뒤따르는 '자세히'만 오면 앞 질문을 자세히)
- '자세히' 안내 문장은 코드가 대화에서 한 번만 붙인다
- 앱이 표를 그리지 않으므로, 검사 두 번 실패 때는 도구 결과로 만든 요약 문장
- 결제 추천·카드 비교의 계산 근거(applied), 카드 용어, 프로모션 기간
"""

import re
from datetime import date

from engine.chat import guard, prompts
from engine.chat.agent import DETAIL_HINT, NO_ANSWER_REPLY, TABLE_REPLY, detail_only, wants_detail
from engine.chat.tools import TOOL_SPECS, block_summary
from tests.test_chat import AT, DEMO, _agent, _tool_call, service, tb  # noqa: F401

STARBUCKS_TURNS = [{"role": "user", "text": "스타벅스에서 6천 원 결제할 건데 뭐 써?"},
                   {"role": "assistant", "text": "스타벅스 6,000원이면 신한카드 Discount Plan+가 유리해요. 600원을 받을 수 있어요."}]


# ---------- 데이터 없이 ----------

def test_자세히_알아채기():
    assert wants_detail("1순위 이유 자세히 알려줘") and wants_detail("자세하게 설명해줘")
    assert not wants_detail("왜 이 카드가 1순위야?") and not wants_detail("스타벅스에서 6천 원")
    for only in ("자세히", "더 자세히 알려줘", "자세히 설명해 줘요", "좀 더 자세하게!", "자세히요"):
        assert detail_only(only), only
    assert not detail_only("스타벅스 결제 자세히") and not detail_only("1순위 이유 자세히")


def test_지시문_기본은_더_자세히_표는_안_보임_용어집():
    text = prompts.system_prompt(AT, ["KB ALL 카드"], {"name": "pay"})
    assert "3~6문장" in text and "표를 보여 주지 않" in text
    assert "화면에 따로 보이므로" not in text                       # 앱이 표를 그리지 않는다 (2026-11-24 확인)
    glossary = text.split("\n[카드 용어]\n")[1].split("\n[")[0]
    for word in ("전월 실적", "실적 구간", "통합 할인 한도", "건당", "마이샵", "기본 카드", "주력 카드 우선", "연회비"):
        assert word in glossary, word
    assert not re.search(r"\d", glossary)                           # 숫자 검사기에 걸리지 않게 숫자 없이
    assert prompts.DETAIL_CONTEXT["ask"] not in text and prompts.DETAIL_CONTEXT["again"] not in text
    ask = prompts.system_prompt(AT, ["KB ALL 카드"], None, detail="ask")
    again = prompts.system_prompt(AT, ["KB ALL 카드"], None, detail="again")
    assert "[답변 길이] 자세히" in ask and "[답변 길이] 자세히" in again and "바로 앞" in again
    assert prompts.PROMPT_VERSION >= "2026-11-24.2"


def test_프로모션_도구에_기간_조건():
    spec = next(t for t in TOOL_SPECS if t["function"]["name"] == "list_promotions")
    assert spec["function"]["parameters"]["properties"]["ending"]["enum"] == ["this_week", "7days", "this_month"]


# ---------- 실제 데이터 ----------

def test_프로모션_기간으로_거르기(tb):
    every = tb.run("list_promotions", {})["promotions"]
    for ending, last in (("this_week", "2026-11-08"), ("7days", "2026-11-12"), ("this_month", "2026-11-30")):
        got = tb.run("list_promotions", {"ending": ending})
        assert all(p["end"] <= last for p in got["promotions"]), ending
        assert got["promotions"] == [p for p in every if p["end"] <= last]
    assert "error" in tb.run("list_promotions", {"ending": "someday"})


def test_결제_추천과_비교에_계산_근거(tb):
    r = tb.run("recommend_for_payment", {"merchant_name": "스타벅스", "amount": 6000})
    assert all("applied" in c for c in r["cards"])
    got = [c for c in r["cards"] if c["benefit"] > 0]
    assert got and all(c["applied"] and c["applied"]["name"] and c["applied"]["value"] for c in got)
    for c in got:
        if c["applied"].get("before_limit") is not None:
            assert c["benefit"] <= c["applied"]["before_limit"]
    s = tb.run("simulate_payment", {"merchant_name": "스타벅스", "amount": 6000})
    assert all("applied" in c for c in s["cards"])


def test_결제_평가_API_응답은_그대로(service):
    ev = service.evaluate_payment(DEMO, AT, "CAFE", 6000)
    assert ev["cards"] and all("applied" not in c for c in ev["cards"])


def test_도구_결과_요약_문장은_숫자_검사를_통과(tb):
    calls = [("recommend_for_payment", {"merchant_name": "스타벅스", "amount": 6000}),
             ("simulate_payment", {"card_name": "KB"}), ("explain_ranking", {}), ("get_card_status", {}),
             ("get_card_benefits", {"card_name": "SOL트래블"}), ("recommend_new_card", {}), ("list_promotions", {})]
    for name, args in calls:
        tb.run(name, args)
        text = block_summary(tb.blocks)
        assert text and "아래 표" not in text, name
        assert guard.check(text, guard.collect_facts(tb.results), False, False) == [], (name, text)


def test_요약할_표가_없으면_none():
    assert block_summary([]) is None
    assert block_summary([{"type": "rule_card", "summary": "x"}]) is None


def test_검사_두_번_실패면_요약_문장(service):
    agent, _ = _agent(service, [[_tool_call(1, "simulate_payment", {"card_name": "KB"})],
                                "9,999원 손해예요.", "여전히 8,888원이에요."])
    out = agent.answer(DEMO, "KB로 내면 얼마 손해야?", AT)
    assert out["reply"] not in (TABLE_REPLY, NO_ANSWER_REPLY) and out["reply"] == block_summary(out["blocks"])
    assert out["log"]["retries"] == 2


def test_자세히를_말하면_지시문에_답변_길이(service):
    agent, client = _agent(service, [[_tool_call(1, "explain_ranking", {})], "1순위 카드는 기본 카드라서 먼저 보여요."])
    out = agent.answer(DEMO, "1순위 이유 자세히 알려줘", AT)
    system = client.requests[0]["messages"][0]["content"]
    assert "[답변 길이] 자세히" in system and "바로 앞" not in system
    assert DETAIL_HINT not in out["reply"]                         # 이미 자세히 물었으면 안내하지 않는다


def test_자세히만_오면_앞_질문을_자세히(service):
    agent, client = _agent(service, [[_tool_call(1, "recommend_for_payment", {"merchant_name": "스타벅스", "amount": 6000})],
                                     "스타벅스 결제는 추천 카드가 가장 좋아요."])
    agent.answer(DEMO, "자세히", AT, STARBUCKS_TURNS)
    system = client.requests[0]["messages"][0]["content"]
    assert "[답변 길이] 자세히" in system and "바로 앞" in system


def test_자세히_안내는_대화에서_한_번만(service):
    agent, _ = _agent(service, [[_tool_call(1, "get_card_status", {})], "이번 달 카드별 실적을 확인했어요."])
    first = agent.answer(DEMO, "이번 달 실적 알려줘", AT)
    assert first["reply"].endswith("\n\n" + DETAIL_HINT)
    agent, _ = _agent(service, [[_tool_call(1, "get_card_status", {})], "이번 달 카드별 실적을 확인했어요."])
    history = [{"role": "user", "text": "이번 달 실적 알려줘"}, {"role": "assistant", "text": first["reply"]}]
    again = agent.answer(DEMO, "그럼 다음 달은?", AT, history)
    assert DETAIL_HINT not in again["reply"]
    agent, _ = _agent(service, ["일정은 오늘의 일정 탭 > 일정 추가에서 넣을 수 있어요."])
    guide = agent.answer(DEMO, "일정은 어떻게 추가해?", AT, [], {"name": "home"})
    assert DETAIL_HINT not in guide["reply"]                       # 도구를 쓰지 않은 답(앱 사용법)에는 붙이지 않는다


def test_테스트_날짜_기준():
    assert AT.date() == date(2026, 11, 5) and AT.weekday() == 3     # 목요일 → 이번 주 일요일은 11-08


# ---------- 앱이 표를 그릴 때 (2026-11-24 사용자 결정 '앱에서 표 그리기') ----------

def test_앱이_표를_그린다고_하면_지시문이_금액_나열을_줄인다():
    shown = prompts.system_prompt(AT, ["KB ALL 카드"], {"name": "pay", "blocks": True})
    plain = prompts.system_prompt(AT, ["KB ALL 카드"], {"name": "pay"})
    assert prompts.BLOCKS_CONTEXT in shown and prompts.BLOCKS_CONTEXT not in plain
    home = prompts.system_prompt(AT, ["KB ALL 카드"], {"name": "home", "blocks": True})
    assert prompts.BLOCKS_CONTEXT in home and "홈 화면에서 챗봇을 열었다" in home


def test_채팅_API_가_표_표시를_받는다():
    from engine.api import ChatScreen
    assert ChatScreen(name="home", blocks=True).model_dump()["blocks"] is True
    assert ChatScreen(name="pay").model_dump()["blocks"] is None


def test_표_표시가_있으면_에이전트가_지시문에_넣는다(service):
    agent, client = _agent(service, [[_tool_call(1, "get_card_status", {})], "이번 달 카드별 실적을 확인했어요."])
    agent.answer(DEMO, "이번 달 실적 알려줘", AT, [], {"name": "home", "blocks": True})
    assert prompts.BLOCKS_CONTEXT in client.requests[0]["messages"][0]["content"]
