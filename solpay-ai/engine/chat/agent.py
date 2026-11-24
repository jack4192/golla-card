"""챗봇 에이전트: OpenAI Chat Completions 함수 호출(모델은 openai_params: 기본 GPT-6.1 Terra, 생각 단계 none), 도구 반복, 시간 제한, 답변 검사, 예비 답변 (챗봇 설계서).

질문 하나는 도구 호출 최대 3번 + 답변으로 끝나고, 전체 제한 시간은 15초다.
검사(guard)에 걸리면 한 번 다시 쓰게 하고, 그래도 안 되면 화면 요소만 보여 주는 정해진 문구로 바꾼다.
OpenAI 키가 없거나 장애·시간 초과면 fallback=true 로, 추천 질문 칩 4개는 도구만 실행한 예비 답변을 준다.
서버는 대화를 기억하지 않는다 (Spring 이 매 요청에 최근 대화를 보낸다). FastAPI 는 DB 에 쓰지 않는다.
"""

import json
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from engine.chat import guard
from engine.chat.openai_params import DEFAULT_MODEL, DEFAULT_REASONING_EFFORT, model_from_env, reasoning_effort_from_env, sampling
from engine.chat.prompts import PROMPT_VERSION, system_prompt
from engine.chat.tools import TOOL_SPECS, ToolBox, _josa, block_summary, said_day
from engine.privacy import redact

ROOT = Path(__file__).resolve().parents[2]
TIMEOUT_REPLY = "지금은 답변이 늦어지고 있어요. 잠시 후 다시 물어봐 주세요."
TABLE_REPLY = "아래 표를 확인해 주세요."     # 옛 답. 앱이 표를 그리지 않아 쓰지 않는다 (2026-11-24, 대신 block_summary)
DETAIL_HINT = "더 자세한 설명이 필요하면 '자세히'라고 입력해 주세요."
NO_ANSWER_REPLY = "확인할 수 없는 내용이 있어 답을 드리지 못했어요. 질문을 조금 바꿔 다시 물어봐 주세요."

# 추천 질문 칩 = 시연용 예비 답변 질문 (2026-11-19 결정: 설계서 예시 기준 4개)
CHIPS = ("왜 이 카드가 1순위야?", "이번 달 실적 얼마 남았어?", "내 소비에 맞는 카드 찾아줘",
         "스타벅스에서 6천 원 결제할 건데 뭐 써?")


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """solpay-ai/.env 의 KEY=VALUE 를 환경 변수로 (이미 있는 값은 두고). 키를 로그에 남기지 않는다."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class ChatSettings:
    model: str = DEFAULT_MODEL
    timeout_sec: float = 15.0
    max_tool_calls: int = 3
    history_turns: int = 10
    temperature: float = 0.2                       # 생각 단계가 없을 때(옛 모델)만 보낸다
    reasoning_effort: str | None = DEFAULT_REASONING_EFFORT

    @classmethod
    def from_env(cls) -> "ChatSettings":
        return cls(model_from_env(), float(os.environ.get("CHAT_TIMEOUT_SEC", 15)),
                   int(os.environ.get("CHAT_MAX_TOOL_CALLS", 3)), int(os.environ.get("CHAT_HISTORY_TURNS", 10)),
                   reasoning_effort=reasoning_effort_from_env())


def openai_client():
    """OPENAI_API_KEY 가 있으면 클라이언트, 없으면 None (챗봇은 예비 답변만 한다)."""
    load_dotenv()
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    from openai import OpenAI
    return OpenAI(api_key=key, max_retries=0)


def _norm(text: str) -> str:
    return re.sub(r"[\s?!.,~·]", "", text)


# 기본 답은 3~6문장, '자세히'를 입력하면 더 자세히 (2026-11-24 사용자 결정)
_DETAIL_WORDS = ("자세히", "자세하게")
_DETAIL_FILLER = re.compile(r"자세히|자세하게|조금|좀|더|다시|한번|한 번|설명|알려|말해|해|줘|주세요|줄래|줄래요|요|봐|주라|부탁")


def wants_detail(message: str) -> bool:
    return any(w in message for w in _DETAIL_WORDS)


def detail_only(message: str) -> bool:
    """'자세히'·'더 자세히 알려줘'처럼 다른 내용 없이 자세히만 말했는지 (앞 질문을 자세히 다시 답한다)."""
    return wants_detail(message) and not _DETAIL_FILLER.sub("", _norm(message))


def _hinted(history: list[dict]) -> bool:
    return any(h.get("role") == "assistant" and "'자세히'" in str(h.get("text") or "") for h in history)


def chip_of(message: str) -> int | None:
    n = _norm(message)
    return next((i for i, c in enumerate(CHIPS) if _norm(c) == n), None)


class ChatAgent:
    def __init__(self, service, client=None, settings: ChatSettings | None = None):
        self.service = service
        self.client = client
        self.settings = settings or ChatSettings.from_env()

    # ---------- 진입점 ----------
    def answer(self, user_id: int, message: str, at: datetime, history: list[dict] | None = None,
               screen: dict | None = None) -> dict:
        started = time.monotonic()
        deadline = started + self.settings.timeout_sec
        tb = ToolBox(self.service, user_id, at, screen)
        recent = [str(h.get("text") or "") for h in (history or [])[-6:] if h.get("role") == "user"]
        tb.user_words = " ".join(recent + [message])
        tb.message = message
        usage = {"tokens_in": 0, "tokens_out": 0}
        if self.client is None:
            return self._fallback(tb, message, started, usage, "no_api_key")
        detail = ("again" if detail_only(message) else "ask") if wants_detail(message) else None
        try:
            reply, retries = self._run(tb, message, history or [], screen, deadline, usage, detail)
        except Exception as e:                      # OpenAI 장애·시간 초과·응답 형식 오류
            return self._fallback(tb, message, started, usage, type(e).__name__)
        # 대화에서 한 번만 (숫자가 없어 검사와 무관). '자세히' 버튼이 있는 앱(screen.detail_button)에는 붙이지 않는다 (2026-11-24 3단계)
        if (retries < 2 and detail is None and tb.calls and not _hinted(history or [])
                and not (screen or {}).get("detail_button")):
            reply = f"{reply}\n\n{DETAIL_HINT}"
        return self._response(tb, reply, False, started, usage, retries=retries, detail=detail)

    # ---------- LLM 반복 ----------
    def _messages(self, tb: ToolBox, message: str, history: list[dict], screen: dict | None,
                  detail: str | None = None) -> list[dict]:
        top = self._top_card(tb, screen)
        msgs = [{"role": "system", "content": system_prompt(tb.at, tb.card_names(), screen, top, detail)}]
        for h in history[-2 * self.settings.history_turns:]:
            role = "assistant" if h.get("role") == "assistant" else "user"
            text = redact(str(h.get("text") or ""))[:1000]
            if text:
                msgs.append({"role": role, "content": text})
        msgs.append({"role": "user", "content": redact(message)[:1000]})
        return msgs

    def _top_card(self, tb: ToolBox, screen: dict | None) -> str | None:
        rid = (screen or {}).get("recommendation_id")
        record = self.service.recommendation_log(tb.user_id, int(rid)) if rid else None
        return tb.names.get(record["ranking"][0]) if record and record.get("ranking") else None

    def _call(self, messages: list[dict], deadline: float, usage: dict, tools: bool):
        left = deadline - time.monotonic()
        if left < 1.0:
            raise TimeoutError("제한 시간 초과")
        kwargs = {"model": self.settings.model, "messages": messages, "timeout": left,
                  **sampling(self.settings.temperature, self.settings.reasoning_effort)}
        if tools:
            kwargs.update(tools=TOOL_SPECS, tool_choice="auto", parallel_tool_calls=True)
        resp = self.client.chat.completions.create(**kwargs)
        if getattr(resp, "usage", None) is not None:
            usage["tokens_in"] += resp.usage.prompt_tokens or 0
            usage["tokens_out"] += resp.usage.completion_tokens or 0
        return resp.choices[0].message

    def _run(self, tb: ToolBox, message: str, history: list[dict], screen: dict | None, deadline: float,
             usage: dict, detail: str | None = None) -> tuple[str, int]:
        messages = self._messages(tb, message, history, screen, detail)
        reply, budget = self._loop(tb, messages, deadline, usage, self.settings.max_tool_calls)
        facts = lambda: guard.collect_facts(tb.results, message, [h.get("text") for h in history], tb.card_names(),
                                            tb.at.day, tb.at.month, tb.at.year)
        days_given = said_day(tb.user_words)
        problems = guard.check(reply, facts(), tb.has_draft(), days_given) if reply else ["빈 답변"]
        if not problems:
            return reply, 0
        # 초안 없이 저장을 안내했으면 다시 쓸 때 도구(draft_rule)를 부를 수 있게 한다. 그 밖에는 도구 없이 다시 쓴다.
        need_tool = (not tb.has_draft() and budget > 0
                     and any(p.startswith((guard.DRAFT_MISSING, guard.DAYS_GIVEN)) for p in problems))
        messages.append({"role": "assistant", "content": reply or ""})
        messages.append({"role": "user", "content": "[답변 검사] 다음 문제를 고쳐 같은 질문에 다시 답하세요."
                                                    + ("" if need_tool else " 도구는 부르지 마세요.") + "\n- "
                                                    + "\n- ".join(problems)})
        if need_tool:
            reply2, _ = self._loop(tb, messages, deadline, usage, budget)
        else:
            reply2 = (self._call(messages, deadline, usage, tools=False).content or "").strip()
        if reply2 and not guard.check(reply2, facts(), tb.has_draft(), days_given):
            return reply2, 1
        # 검사에 두 번 걸리면 도구 결과로 만든 정해진 요약 문장 (앱이 표를 그리지 않아 '아래 표를 확인해 주세요'는 빈 답이었다)
        return (block_summary(tb.blocks) or NO_ANSWER_REPLY), 2

    def _loop(self, tb: ToolBox, messages: list[dict], deadline: float, usage: dict, budget: int) -> tuple[str, int]:
        """LLM 이 도구를 부르면 실행해 돌려주기를 반복한다 (질문당 도구 호출 budget 번까지). (답변, 남은 횟수)"""
        reply = None
        while True:
            msg = self._call(messages, deadline, usage, tools=budget > 0)
            calls = getattr(msg, "tool_calls", None) or []
            if not calls or budget <= 0:
                reply = (msg.content or "").strip()
                break
            messages.append({"role": "assistant", "content": msg.content or "",
                             "tool_calls": [{"id": c.id, "type": "function",
                                             "function": {"name": c.function.name, "arguments": c.function.arguments}}
                                            for c in calls]})
            for c in calls:
                if budget > 0:
                    budget -= 1
                    try:
                        args = json.loads(c.function.arguments or "{}")
                    except json.JSONDecodeError:
                        args = None
                    result = tb.run(c.function.name, args) if isinstance(args, dict) else {"error": "인자 JSON 오류"}
                else:
                    result = {"error": "이번 질문의 도구 호출 한도를 넘었습니다. 지금까지의 결과로 답하세요"}
                messages.append({"role": "tool", "tool_call_id": c.id,
                                 "content": json.dumps(result, ensure_ascii=False, default=str)})
        return reply, budget

    # ---------- 응답 ----------
    def _response(self, tb: ToolBox, reply: str, fallback: bool, started: float, usage: dict, **extra) -> dict:
        return {
            "reply": reply, "blocks": tb.blocks, "rule_draft": tb.rule_draft, "fallback": fallback,
            "log": {"tools": [c["tool"] for c in tb.calls], "tool_summaries": tb.calls, **usage,
                    "ms": int((time.monotonic() - started) * 1000), "model": self.settings.model,
                    "prompt_version": PROMPT_VERSION, **extra},
        }

    def _fallback(self, tb: ToolBox, message: str, started: float, usage: dict, reason: str) -> dict:
        chip = chip_of(message)
        reply = TIMEOUT_REPLY
        if chip is not None:
            try:
                reply = prepared_answer(tb, chip)
            except Exception:
                reply = TIMEOUT_REPLY
        return self._response(tb, reply, True, started, usage, fallback_reason=reason, chip=chip)


def prepared_answer(tb: ToolBox, chip: int) -> str:
    """추천 질문 칩의 예비 답변. LLM 없이 도구 결과로 정해진 문장을 만든다."""
    if chip == 0:
        r = tb.run("explain_ranking", {})
        first = r["cards"][0]
        tail = f" {first['message']}" if first.get("message") else ""
        return f"{first['name']}{_josa(first['name'], '을', '를')} 1순위로 보여 드렸어요.{tail}"
    if chip == 1:
        r = tb.run("get_card_status", {})
        parts = []
        for c in r["cards"]:
            name = f"{c['name']}{_josa(c['name'], '은', '는')}"
            if c.get("remaining_to_keep_tier"):           # 지금 받는 구간을 다음 달에도 받으려면
                parts.append(f"{name} 지금 구간 유지까지 {c['remaining_to_keep_tier']:,}원")
            elif c["remaining_to_next_tier"] > 0:
                parts.append(f"{name} 다음 구간까지 {c['remaining_to_next_tier']:,}원")
        if not parts:
            return "모든 카드가 이번 달 가장 높은 구간에 닿았어요."
        return ", ".join(parts[:2]) + " 남았어요."
    if chip == 2:
        r = tb.run("recommend_new_card", {"months": 3})
        if not r["cards"]:
            return "최근 결제가 없어 추천할 카드를 계산하지 못했어요."
        c = r["cards"][0]
        return (f"최근 {len(r['months'])}개월 소비라면 {c['name']}{_josa(c['name'], '이', '가')} 연회비를 빼고 월 평균 "
                f"{c['net_benefit']:,}원으로 가장 커요.")
    r = tb.run("recommend_for_payment", {"merchant_name": "스타벅스", "amount": 6000})
    name = r["recommended_card"]
    return f"스타벅스 6,000원이면 {name}{_josa(name, '이', '가')} 유리해요. {r['recommended_total']:,}원을 받을 수 있어요."
