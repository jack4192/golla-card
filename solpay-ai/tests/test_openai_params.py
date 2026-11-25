"""OpenAI 모델 설정 (2026-11-24 팀 결정: gpt-4o-mini → GPT-6.1 Terra).

GPT-5.6·6 계열은 온도(temperature)를 받지 않고, 생각 단계(reasoning_effort)가 none 이어야
Chat Completions 도구 호출이 된다. 생각 단계를 빈 값으로 두면 옛 모델처럼 온도를 보낸다 (gpt-4o-mini 로 되돌릴 때).
"""

from engine.chat.agent import ChatSettings
from engine.chat.openai_params import sampling
from engine.chat.page_copy import CopySettings
from engine.chat.place_llm import settings_from_env as place_settings


def test_기본_모델은_GPT61_Terra_생각_none(monkeypatch):
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_REASONING_EFFORT", raising=False)
    for s in (ChatSettings.from_env(), CopySettings.from_env(), place_settings(), ChatSettings(), CopySettings()):
        assert (s.model, s.reasoning_effort) == ("gpt-6.1-terra", "none")


def test_생각_단계를_빈_값으로_두면_온도를_보낸다(monkeypatch):
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_REASONING_EFFORT", "")
    for s in (ChatSettings.from_env(), CopySettings.from_env(), place_settings()):
        assert (s.model, s.reasoning_effort) == ("gpt-4o-mini", None)
    assert place_settings().temperature == 0.0                  # 분류는 옛 모델에서 온도 0


def test_생각_단계가_있으면_온도를_빼고_보낸다():
    assert sampling(0.2, "none") == {"reasoning_effort": "none"}
    assert sampling(0.2, "low") == {"reasoning_effort": "low"}
    assert sampling(0.2, None) == {"temperature": 0.2}
