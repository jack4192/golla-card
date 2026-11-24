"""답변 검사: 숫자 검사기와 금지 표현 (챗봇 설계서 '안전장치').

- 숫자: 답변 속 금액(원)·비율(%)·1,000 이상의 수가 이번 질문의 도구 결과(또는 사용자가 말한 수)에 있어야 한다.
  '약 145만 원'처럼 도구 값을 10·100·1,000·10,000 단위로 반올림한 값은 통과시킨다.
- 소비 권유: '더 쓰세요', '채우세요' 같은 표현.
- 저장 주장: 규칙은 초안만 만들므로 '저장했어요', '적용했어요'라고 말하면 안 된다.
- 초안 없는 저장 안내: draft_rule 을 부르지 않았는데 '아래 카드에서 저장을 누르면' 이라고 하면 화면에 저장할 카드가 없다
  (2026-11-19 첫 평가에서 나온 오안내).
"""

import re

_NUM = r"\d[\d,]*(?:\.\d+)?"
_MAN = re.compile(rf"({_NUM})\s*만\s*(?:({_NUM})\s*천)?(?:\s*({_NUM}))?")
_CHEON = re.compile(rf"({_NUM})\s*천")
_TOKEN = re.compile(rf"({_NUM})\s*(원|%|퍼센트)?")

SPEND_PUSH = ("더 쓰", "더 써", "더 결제하", "더 사용하", "채우세요", "채워 보세요", "채워보세요", "채우시길",
              "소비를 늘", "지출을 늘", "추가로 결제하", "추가 결제하세요", "결제를 늘")
SAVED_CLAIM = ("저장했", "저장됐", "저장되었", "저장해 두었", "저장해뒀", "저장 완료", "적용했", "적용됐", "적용되었",
               "설정했어", "설정했습니다", "설정하였", "설정됐", "설정되었", "설정 완료", "등록했", "등록됐", "등록되었",
               "변경했어", "변경했습니다", "변경하였", "변경됐", "변경되었", "반영했어", "반영했습니다", "반영하였",
               "반영됐", "반영되었", "바꿨어", "바꿨습니다",
               # 일정·규칙 지우기도 초안만 만든다 (2026-11-24 고도화 3단계)
               "추가했어", "추가했습니다", "추가됐", "추가되었", "넣었어", "넣었습니다", "삭제했", "삭제됐", "삭제되었",
               "지웠어", "지웠습니다")
DRAFT_CLAIM = ("저장을 누르", "저장 버튼", "저장하시면", "저장하면 ", "초안을 만들었", "초안이 만들어", "초안을 준비했",
               "초안이 준비", "아래 카드에서", "규칙 카드")
DRAFT_MISSING = "규칙 초안이 없습니다"
# 사용자가 이미 요일(주말·평일·매일 등)을 말했는데 다시 묻는 답 (2026-11-19 개발용 화면에서 '주말엔 KB 먼저'로 발견)
DAYS_GIVEN = "사용자가 이미 요일을 말했습니다"
ASK_DAYS = ("어떤 요일", "무슨 요일", "요일에 적용할까", "요일을 알려", "요일을 정해")


def claims_draft(reply: str) -> bool:
    return any(w in reply for w in DRAFT_CLAIM)


def _f(text: str) -> float:
    return float(text.replace(",", ""))


def numbers_in_text(text: str) -> list[tuple[float, str]]:
    """(값, 단위). '1만 2천 원' → 12000, '6천 원' → 6000, '10%' → 10. 단위는 '원', '%' 또는 ''."""
    out, spans = [], []
    for m in _MAN.finditer(text):
        v = _f(m.group(1)) * 10_000 + (_f(m.group(2)) * 1000 if m.group(2) else 0) + (_f(m.group(3)) if m.group(3) else 0)
        tail = text[m.end():m.end() + 3]
        out.append((v, "원" if "원" in tail else ""))
        spans.append(m.span())
    for m in _CHEON.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        tail = text[m.end():m.end() + 3]
        out.append((_f(m.group(1)) * 1000, "원" if "원" in tail else ""))
        spans.append(m.span())
    for m in _TOKEN.finditer(text):
        if any(s <= m.start() < e for s, e in spans):
            continue
        unit = {"퍼센트": "%"}.get(m.group(2), m.group(2) or "")
        out.append((_f(m.group(1)), unit))
    return out


def collect_facts(*values) -> set[float]:
    """도구 결과(dict·list·문자열·숫자)에 나오는 모든 수."""
    facts: set[float] = set()

    def walk(v):
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, (int, float)):
            facts.add(float(v))
            facts.add(round(float(v) * 100, 4))          # 0.1 → 10 (%)
        elif isinstance(v, str):
            facts.update(n for n, _ in numbers_in_text(v))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple, set)):
            for x in v:
                walk(x)

    for v in values:
        walk(v)
    return facts


def _known(value: float, facts: set[float]) -> bool:
    if value in facts or value == 0:
        return True
    if value == int(value):
        for digits in (1, 2, 3, 4):
            unit = 10 ** digits
            if value % unit == 0 and any(abs(f) >= unit and round(f / unit) * unit == value for f in facts):
                return True
    return False


def unknown_numbers(reply: str, facts: set[float]) -> list[str]:
    bad = []
    for value, unit in numbers_in_text(reply):
        if unit in ("원", "%") or value >= 1000:
            if not _known(value, facts):
                bad.append(f"{value:,.0f}{unit}" if value == int(value) else f"{value}{unit}")
    return bad


def check(reply: str, facts: set[float], has_rule_draft: bool = False, days_given: bool = False) -> list[str]:
    """문제 목록. 비어 있으면 통과. days_given: 사용자 문장에 요일 조건이 있다 (tools.said_day)."""
    problems = []
    if days_given and not has_rule_draft and any(w in reply for w in ASK_DAYS):
        problems.append(f"{DAYS_GIVEN}. 다시 묻지 말고 그 요일로 draft_rule 을 부르세요 (예: 주말 → days=['weekend'])")
    bad = unknown_numbers(reply, facts)
    if bad:
        problems.append(f"도구 결과에 없는 숫자: {', '.join(bad)}. 도구 결과의 숫자만 쓰세요")
    push = [w for w in SPEND_PUSH if w in reply]
    if push:
        problems.append(f"소비를 권하는 표현: {', '.join(push)}. 남은 금액만 알려 주세요")
    if not has_rule_draft and claims_draft(reply):
        problems.append(f"{DRAFT_MISSING}. 규칙 요청이면 draft_rule 을 먼저 부르고, 아니면 저장 안내를 빼세요")
    saved = [w for w in SAVED_CLAIM if w in reply]
    if saved:
        problems.append("규칙은 아직 저장되지 않았습니다. '저장 버튼을 누르면 적용돼요'처럼 말하세요"
                        if has_rule_draft else f"하지 않은 일을 했다고 말함: {', '.join(saved)}")
    return problems
