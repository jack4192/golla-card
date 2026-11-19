"""외부 AI(OpenAI)로 개인정보를 보내지 않기 위한 장치 (2026-11-14 결정).

챗봇은 사용자 문장과 엔진 결과를 외부 AI에 보낸다. 그 전에
1) redact: 사용자 문장 속 카드번호·계좌번호·주민등록번호·전화번호·이메일을 가린다.
2) llm_view: 엔진 결과에서 외부 AI가 알아도 되는 항목만 남긴다 (카드 상품명·업종·금액·구간).
   사용자 ID, 카드 끝 4자리, 결제 시각·가맹점, 일정 원문은 보내지 않는다.
"""

import re

_PATTERNS = (
    ("주민등록번호", re.compile(r"\b\d{6}\s*-\s*[1-4]\d{6}\b")),
    ("카드번호", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("전화번호", re.compile(r"\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b")),     # 계좌번호보다 먼저
    ("계좌번호", re.compile(r"\b\d{2,6}-\d{2,6}-\d{2,8}\b")),
    ("이메일", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
)

# 외부 AI에 보내도 되는 항목 (그 밖의 키는 버린다)
ALLOWED = {"name", "category", "category_name", "amount", "benefit", "gain", "perf", "prev_perf", "next_tier",
           "remaining", "tiers", "rate", "reason", "card_name", "trigger", "message", "score_won", "rank"}


def redact(text: str) -> str:
    for label, pattern in _PATTERNS:
        text = pattern.sub(f"[{label}]", text)
    return text


def llm_view(value):
    """dict·list 를 돌며 ALLOWED 키만 남긴다. 문자열은 redact 를 거친다."""
    if isinstance(value, dict):
        return {k: llm_view(v) for k, v in value.items() if k in ALLOWED}
    if isinstance(value, list):
        return [llm_view(v) for v in value]
    if isinstance(value, str):
        return redact(value)
    return value
