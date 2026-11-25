"""OpenAI 모델과 '온도/생각 단계' 설정 (2026-11-24 팀 결정: gpt-4o-mini → GPT-6.1 Terra).

GPT-5.6·6 계열은 온도(temperature)를 보내면 400 으로 거절하고, Chat Completions 에서 도구를 쓰려면
생각 단계(reasoning_effort)가 none 이어야 한다. 그래서 생각 단계를 정하면 온도는 보내지 않는다.
OPENAI_REASONING_EFFORT 를 빈 값으로 두면 생각 단계를 보내지 않고 온도를 보낸다 (gpt-4o-mini 같은 옛 모델로 되돌릴 때).
"""

import os

DEFAULT_MODEL = "gpt-6.1-terra"
DEFAULT_REASONING_EFFORT = "none"


def model_from_env() -> str:
    return os.environ.get("OPENAI_MODEL") or DEFAULT_MODEL


def reasoning_effort_from_env() -> str | None:
    """없으면 none, 빈 값이면 None (온도를 보낸다)."""
    value = os.environ.get("OPENAI_REASONING_EFFORT", DEFAULT_REASONING_EFFORT).strip()
    return value or None


def sampling(temperature: float, reasoning_effort: str | None) -> dict:
    """요청에 넣을 칸: 생각 단계가 있으면 그것만, 없으면 온도."""
    return {"reasoning_effort": reasoning_effort} if reasoning_effort else {"temperature": temperature}
