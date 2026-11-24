"""추천 페이지 문구: OpenAI 응답 검사와 템플릿.

카드 탭 (2026-11-21 사용자 결정): 큰 글씨는 오늘 일정에서 받는 혜택 키워드(card.keyword), 그 아래 금액 줄(amount_label),
추천 이유는 함께 받는 혜택·지난 1년 줄·대신 쓴 카드·연회비와 실적 조건. 모든 줄을 OpenAI 가 쓰되 금액 줄과 추천 이유는
엔진이 만든 줄(amount_line, fixed_reasons)을 그대로 옮기고, 다르면 다시 쓰거나 정해진 문구로 바꾼다."""

import json
from types import SimpleNamespace

from engine.chat.page_copy import (PROMPT_VERSION, SYSTEM, CopySettings, PageCopyWriter, amount_line, attach_copy, check_copy,
                                   facts_of, fixed_reasons, template_copy)
from engine.params import Params
from tests.test_recommendation_page import (NOW, PROMOS, TODAY, TWO_ITEMS, build_page, coffee, habit_payments, page_catalog,
                                            state_of, year_payments)


class FakeClient:
    """미리 정한 응답(문자열 또는 예외)을 차례로 돌려주고 요청을 기록한다."""

    def __init__(self, script):
        self.script, self.requests = list(script), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.requests.append(kwargs)
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=step))],
                               usage=SimpleNamespace(prompt_tokens=300, completion_tokens=80))


def _dict(page):
    return page.to_dict(page_catalog(), Params())


def page_dict():
    """오늘 14시 카페 6,000원 일정: 새 카페 카드(스타벅스 10%, 600원, 지금 카드보다 540원 더) + 메가커피 행사. 1년 계산 없음."""
    return _dict(build_page(state_of(), habit_payments(), [coffee()], [], PROMOS, NOW, TODAY))


def pattern_page_dict():
    """일정 없음: 새 주유 카드(연회비 0원, 실적 조건 없음, GS 5%) + 메가커피 행사."""
    return _dict(build_page(state_of(), habit_payments(), [], [], PROMOS, NOW, TODAY))


def small_page_dict():
    """카페 4,000원: 지금 카드보다 360원 더 → 오늘 금액은 숨긴다 (500원 미만)."""
    return _dict(build_page(state_of(), habit_payments(), [coffee(amount=4_000)], [], PROMOS, NOW, TODAY))


def yearly_page_dict():
    """새 카페 카드: 오늘 스타벅스 10,000원에서 1,000원 할인(900원 더), 지난 2개월 16,000원(KB ALL 대신 썼을 때)."""
    return _dict(build_page(state_of(payments=year_payments()), year_payments(), TWO_ITEMS, [], [], NOW, Params()))


FEE = "연회비 12,000원, 전월 실적 300,000원 이상일 때"
GOOD = {"card": {"title": "오후엔 STAR 10% 할인", "summary": "오늘 14시 카페 일정에 STAR 10% 할인을 받을 수 있어요.",
                 "amount_label": "14:00 카페 6,000원 → 600원 할인", "reasons": [FEE]},
        "merchant": {"title": "메가커피 행사가 있어요", "summary": "메가MGC커피에서 Discount Plan+로 내면 1,100원 혜택이에요.",
                     "offers": [{"amount_label": "행사 500원 + 카드 할인 600원", "reasons": ["메가커피 500원 할인 행사"]}]}}
FUEL_OK = {"title": "저녁엔 GS 5% 할인", "summary": "평소 자주 가시는 GS에서 결제하면 5% 할인을 받을 수 있어요.",
           "amount_label": "19:00 주유 50,000원 → 2,500원 할인", "reasons": ["연회비 없음"]}
SMALL_OK = {"title": "오후엔 STAR 10% 할인", "summary": "오늘 14시 카페 일정에 STAR 10% 할인을 받을 수 있어요.",
            "amount_label": "14:00 카페 4,000원 결제 시", "reasons": [FEE]}
YEARLY_OK = {"title": "오후엔 STAR 10% 할인", "summary": "오늘 14시 카페 일정에 STAR 10% 할인을 받을 수 있어요.",
             "amount_label": "14:00 카페 10,000원 → 1,000원 할인",
             "reasons": ["지난 2개월 소비라면 16,000원 더", "KB ALL 대신 썼을 때 기준", FEE]}


def _bad(**changes):
    copy = json.loads(json.dumps(GOOD))
    for path, value in changes.items():
        tab, key = path.split("__")
        copy[tab][key] = value
    return copy


def _only(card, **changes):
    return {"card": {**card, **changes}, "merchant": None}


def _card_facts(page):
    facts = facts_of(page)
    facts["merchant"] = None
    return facts


# ---------- 사실 (LLM 에 보내는 재료) ----------
def test_사실에는_개인정보가_없다():
    facts = facts_of(page_dict())
    text = json.dumps(facts, ensure_ascii=False)
    assert "user_id" not in text and "user_card_id" not in text
    assert facts["card"]["extra_today"] == 540 and facts["card"]["items"][0]["time"] == "14:00~15:00"
    assert "monthly_gain_30d" not in facts["card"] and "yearly_extra" not in facts["card"]     # 1년 계산을 끈 페이지


def test_사실에_오늘_혜택_키워드와_엔진이_만든_줄을_넣는다():
    card = facts_of(page_dict())["card"]
    assert (card["keyword"], card["items"][0]["keyword"]) == ("STAR 10% 할인", "STAR 10% 할인")
    assert card["amount_line"] == "14:00 카페 6,000원 → 600원 할인" and card["fixed_reasons"] == [FEE]
    assert "first_month_note" not in card                            # 추천 이유에 자리가 없다 (응답의 first_month_note 는 그대로)
    assert page_dict()["card"]["first_month_note"]


def test_혜택_종류를_사실에_넣고_실적_0은_뺀다():
    facts = facts_of(page_dict())
    assert facts["card"]["items"][0]["benefit_type"] == "할인"
    assert facts["merchant"]["offers"][0]["card_benefit_type"] == "할인"
    assert "min_prev_perf" not in facts_of(pattern_page_dict())["card"]["items"][0]


def test_금액을_숨기면_사실에서_혜택_금액을_뺀다():
    card = facts_of(small_page_dict())["card"]
    assert card["show_amount"] is False and "extra_today" not in card
    assert not {"extra", "new_card_benefit", "current_best_benefit"} & set(card["items"][0])
    assert card["amount_line"] == "14:00 카페 4,000원 결제 시" and card["keyword"] == "STAR 10% 할인"
    assert facts_of(page_dict())["card"]["show_amount"] is True


def test_사실에_1년_금액과_바꾼_카드를_넣는다():
    card = facts_of(yearly_page_dict())["card"]
    assert (card["yearly_extra"], card["yearly_months"], card["replaces"]) == (16_000, 2, "KB ALL")
    assert card["extra_today"] == 900 and card["amount_line"] == "14:00 카페 10,000원 → 1,000원 할인"
    assert card["fixed_reasons"] == ["지난 2개월 소비라면 16,000원 더", "KB ALL 대신 썼을 때 기준", FEE]


def test_추천_이유_줄은_함께_받는_혜택_1년_줄_대신_쓴_카드_조건_순서다():
    card = facts_of(yearly_page_dict())["card"]
    card["items"].append({**card["items"][0], "time": "19:00~20:00", "category": "주유", "amount": 50_000, "keyword": "GS 5% 할인"})
    assert fixed_reasons(card) == ["GS 5% 할인 (19:00 주유 50,000원)", "지난 2개월 소비라면 16,000원 더",
                                   "KB ALL 대신 썼을 때 기준", FEE]
    card["replaces"], card["yearly_months"] = None, 12               # 함께 쓰기, 12개월이면 '1년'
    assert fixed_reasons(card)[1:] == ["지난 1년 소비라면 16,000원 더", FEE]
    card["items"][0]["category"] = "카페/커피전문점"                  # 업종 이름은 짧게
    assert amount_line(card) == "14:00 카페 10,000원 → 1,000원 할인"


def test_카드_혜택이_0원이면_사실에서_뺀다():
    # 16시는 보유 카드 1의 메가커피 할인 시간(7~15시) 밖 → 행사 500원만
    page = _dict(build_page(state_of(), habit_payments(), [coffee(16)], [{"at": NOW, "card_id": 9}], PROMOS, NOW, TODAY))
    facts = facts_of(page)
    offer = facts["merchant"]["offers"][0]
    assert offer["total"] == 500 and "card_benefit" not in offer and "card_benefit_type" not in offer
    assert check_copy(template_copy(facts), facts) == []


# ---------- 검사: 통과하는 문구 ----------
def test_정상_문구는_통과():
    assert check_copy(GOOD, facts_of(page_dict())) == []
    assert check_copy(_only(FUEL_OK), _card_facts(pattern_page_dict())) == []
    assert check_copy(_only(SMALL_OK), _card_facts(small_page_dict())) == []
    assert check_copy(_only(YEARLY_OK), _card_facts(yearly_page_dict())) == []


def test_템플릿은_항상_통과():
    for page in (page_dict(), pattern_page_dict(), small_page_dict(), yearly_page_dict()):
        facts = facts_of(page)
        assert check_copy(template_copy(facts), facts) == []


def test_템플릿은_오늘_혜택을_앞세운다():
    card = template_copy(facts_of(yearly_page_dict()))["card"]
    assert card == {"title": "오후엔 STAR 10% 할인", "summary": "오늘 14시 일정에 STAR 10% 할인을 받을 수 있어요.",
                    "amount_label": "14:00 카페 10,000원 → 1,000원 할인",
                    "reasons": ["지난 2개월 소비라면 16,000원 더", "KB ALL 대신 썼을 때 기준", FEE]}
    usual = template_copy(facts_of(pattern_page_dict()))["card"]
    assert (usual["title"], usual["summary"]) == ("저녁엔 GS 5% 할인", "평소 19시쯤 결제에 GS 5% 할인을 받을 수 있어요.")


def test_금액을_숨기면_템플릿도_금액을_쓰지_않는다():
    facts = facts_of(small_page_dict())
    copy = template_copy(facts)
    assert check_copy(copy, facts) == []
    assert "360" not in json.dumps(copy["card"], ensure_ascii=False) and "400원" not in json.dumps(copy["card"], ensure_ascii=False)


# ---------- 검사: 오늘 혜택 키워드와 엔진이 만든 줄 ----------
def test_제목에는_오늘_혜택_키워드가_들어가야_한다():
    problems = check_copy(_bad(card__title="카페 일정엔 새 카페 카드"), facts_of(page_dict()))
    assert any("title" in p and "STAR 10% 할인" in p for p in problems)


def test_금액_줄은_엔진이_만든_줄_그대로여야_한다():
    facts = facts_of(page_dict())
    for label in ("오늘 일정에서 더 받는 혜택", "14:00 카페 6,000원 → 540원 할인", "발급 첫 달은 혜택이 적을 수 있어요"):
        assert any("amount_label" in p for p in check_copy(_bad(card__amount_label=label), facts)), label
    assert check_copy(_bad(card__amount_label="14:00  카페 6,000원 → 600원 할인 "), facts) == []      # 띄어쓰기 차이는 괜찮다


def test_추천_이유는_엔진이_만든_줄_그대로여야_한다():
    facts = _card_facts(yearly_page_dict())
    lines = YEARLY_OK["reasons"]
    for reasons in (lines[:2], lines[::-1], lines + ["발급 첫 달은 혜택이 적을 수 있어요"],
                    [lines[0] + " 받았을 거예요", lines[1], lines[2]]):
        assert any("fixed_reasons" in p for p in check_copy(_only(YEARLY_OK, reasons=reasons), facts)), reasons


def test_연회비와_실적_조건이_빠지면_무엇이_빠졌는지_알려준다():
    facts = facts_of(page_dict())
    assert any("연회비" in p for p in check_copy(_bad(card__reasons=["전월 실적 300,000원 이상일 때"]), facts))
    assert any("연회비" in p for p in check_copy(_bad(card__reasons=["연회비 없음, 전월 실적 30만 원 이상일 때"]), facts))
    assert any("실적" in p for p in check_copy(_bad(card__reasons=["연회비 12,000원, 실적 조건이 있어요"]), facts))


def test_연회비_없는_카드에_금액을_쓰면_실패():
    facts = _card_facts(pattern_page_dict())
    bad = _only(FUEL_OK, reasons=["연회비 6,000원"])
    assert any("연회비" in p for p in check_copy(bad, facts))


def test_실적_0원이라고_쓰면_실패():
    bad = _only(FUEL_OK, reasons=["연회비 없음, 전월 실적 0원 이상일 때"])
    assert any("실적 0원" in p for p in check_copy(bad, _card_facts(pattern_page_dict())))


# ---------- 검사: 숫자·표현 ----------
def test_지어낸_숫자는_실패():
    bad = _bad(card__summary="오늘 14시 카페 일정에 9,999원을 받을 수 있어요.")
    assert any("9,999원" in p for p in check_copy(bad, facts_of(page_dict())))


def test_100배_숫자와_반올림한_숫자는_실패():
    facts = facts_of(page_dict())
    assert check_copy(_bad(card__summary="지금 카드보다 54,000원 더 받아요."), facts)
    assert check_copy(_bad(card__summary="월 최대 1만 원 혜택이에요."), facts)


def test_카드_숫자를_가맹점_문구에_쓰면_실패():
    problems = check_copy(_bad(merchant__summary="메가MGC커피에서 540원 혜택이에요."), facts_of(page_dict()))
    assert any("540원" in p for p in problems)


def test_더_받는다는_금액은_더_받는_금액이어야_한다():
    # 새 카드 혜택(600원)을 '더 받아요'로 쓰면 안 된다. 더 받는 금액은 540원 (2026-11-19 개발용 화면에서 발견)
    facts = facts_of(page_dict())
    assert any("더 받" in p for p in check_copy(_bad(card__summary="스타벅스에서 결제하면 600원 더 받아요."), facts))
    assert check_copy(_bad(card__summary="스타벅스에서 결제하면 540원을 더 받을 수 있어요."), facts) == []


def test_금액을_숨기면_금액을_쓰면_실패():
    bad = _only(SMALL_OK, summary="스타벅스에서 결제하면 360원 더 받아요.")
    assert check_copy(bad, _card_facts(small_page_dict()))


def test_결제_금액을_혜택_금액처럼_쓰면_실패():
    # '15시 메가MGC커피에서 결제하면 5,000원 혜택' 처럼 결제 금액(사실에 있는 숫자)을 혜택으로 쓴 문장이 통과했다
    facts = _card_facts(yearly_page_dict())
    for summary in ("스타벅스에서 결제하면 10,000원 혜택을 받아요", "오늘 카페 일정에서 10,000원 할인받아요"):
        assert any("결제 금액" in p for p in check_copy(_only(YEARLY_OK, summary=summary), facts)), summary
    assert check_copy(_only(YEARLY_OK, summary="오늘 14시 카페 10,000원 결제 시 1,000원 할인을 받아요."), facts) == []


def test_결제_금액이_혜택_금액과_같으면_혜택으로_써도_된다():
    facts = _card_facts(yearly_page_dict())
    facts["card"]["items"][0]["amount"] = 1_000                      # 결제 1,000원, 새 카드 혜택도 1,000원
    assert check_copy(_only(YEARLY_OK, summary="오늘 카페 일정에 1,000원 할인을 받아요."), facts) == []


def test_뻔한_요약은_실패():
    assert any("다양한 혜택" in p for p in check_copy(_bad(card__summary="연회비 12,000원으로 다양한 혜택을 누려보세요!"),
                                                   facts_of(page_dict())))


def test_할인을_적립이나_캐시백이라고_쓰면_실패():
    facts = facts_of(page_dict())
    assert any("적립" in p for p in check_copy(_bad(card__summary="오늘 14시 카페 일정에 600원 적립을 받아요."), facts))
    offer = json.loads(json.dumps(GOOD))
    offer["merchant"]["offers"][0]["reasons"] = ["Discount Plan+ 600원 캐시백"]
    assert any("캐시백" in p for p in check_copy(offer, facts))


def test_평소_소비인데_오늘_일정이라고_쓰면_실패():
    bad = _only(FUEL_OK, summary="오늘 일정에 GS 5% 할인을 받을 수 있어요.")
    assert any("오늘 일정" in p for p in check_copy(bad, _card_facts(pattern_page_dict())))


def test_0원_혜택은_쓰지_않는다():
    bad = json.loads(json.dumps(GOOD))
    bad["merchant"]["offers"][0]["amount_label"] = "행사 500원 + 카드 할인 0원"
    assert any("0원" in p for p in check_copy(bad, facts_of(page_dict())))
    zero_fee = _only(FUEL_OK, summary="평소 자주 가시는 GS에서 5% 할인, 연회비 0원이에요.")
    assert check_copy(zero_fee, _card_facts(pattern_page_dict())) == []


def test_조사를_고르지_않은_문구는_실패():
    # 실제 평가: 프롬프트 예시의 '(으)로'를 그대로 옮겨 '신한카드 Simple Plan+(으)로 30,130원' 이라고 썼다
    bad = _only(YEARLY_OK, summary="오늘 14시 카페 일정에 새 카페 카드(으)로 STAR 10% 할인을 받아요.")
    assert any("(으)로" in p for p in check_copy(bad, _card_facts(yearly_page_dict())))
    assert "(으)로" not in SYSTEM and "(이)가" not in SYSTEM


def test_카드_이름의_플러스를_빼거나_붙이면_다른_카드라_실패():
    # 실제 평가: 'Simple Plan+' 를 추천하면서 요약에 'Simple Plan으로' 라고 썼다 (Simple Plan 은 다른 카드)
    facts = _card_facts(yearly_page_dict())
    facts["card"]["card_name"] = "신한카드 Simple Plan+"
    said = lambda name: _only(YEARLY_OK, summary=f"오늘 14시 카페 일정에 {name} STAR 10% 할인을 받아요.")
    assert any("Simple Plan+" in p for p in check_copy(said("신한카드 Simple Plan으로"), facts))
    assert any("Simple Plan+" in p for p in check_copy(said("Simple Plan으로"), facts))
    assert check_copy(said("신한카드 Simple Plan+로"), facts) == [] and check_copy(said("Simple Plan+로"), facts) == []
    assert check_copy(said("이 카드로"), facts) == []
    facts["card"]["card_name"] = "신한카드 Simple Plan"
    assert any("카드 이름" in p for p in check_copy(said("Simple Plan+로"), facts))
    assert check_copy(said("신한카드 Simple Plan으로"), facts) == []


# ---------- 검사: 1년 금액 ----------
def test_1년_금액을_앞으로_받는_것처럼_쓰면_실패():
    bad = _only(YEARLY_OK, summary="새 카페 카드로 결제하면 16,000원 더 받아요.")
    assert any("지난" in p for p in check_copy(bad, _card_facts(yearly_page_dict())))
    ok = _only(YEARLY_OK, summary="지난 2개월 소비라면 16,000원 더 받았을 카드예요.")
    assert check_copy(ok, _card_facts(yearly_page_dict())) == []


def test_계산한_개월_수와_다르면_실패():
    bad = _only(YEARLY_OK, summary="지난 1년 소비라면 16,000원 더 받았을 거예요.")
    assert any("2개월" in p for p in check_copy(bad, _card_facts(yearly_page_dict())))


def test_바꾼_카드_이름에_든_혜택_종류_단어는_혜택_종류로_보지_않는다():
    # 실제 데이터: 'NH농협 올원더풀 (적립 PACK)' 대신 썼을 때 기준 → 이름의 '적립'은 혜택 종류가 아니다
    facts = _card_facts(yearly_page_dict())
    facts["card"]["replaces"] = "올원더풀 (적립 PACK)"
    facts["card"]["fixed_reasons"] = fixed_reasons(facts["card"])
    ok = _only(YEARLY_OK, reasons=facts["card"]["fixed_reasons"])
    assert "올원더풀 (적립 PACK) 대신 썼을 때 기준" in ok["card"]["reasons"] and check_copy(ok, facts) == []
    assert check_copy(template_copy(facts), facts) == []
    wrong = _only(ok["card"], summary="오늘 14시 카페 일정에 1,000원 적립을 받아요.")
    assert any("적립" in p for p in check_copy(wrong, facts))


# ---------- 탭 구성·형식 ----------
def test_탭_구성이_다르면_실패():
    facts = facts_of(page_dict())
    assert check_copy({**GOOD, "card": None}, facts)
    assert check_copy({**GOOD, "merchant": {**GOOD["merchant"], "offers": []}}, facts)


def test_빈_객체_문구는_실패():
    facts = facts_of(page_dict())
    assert check_copy({**GOOD, "card": {}}, facts)
    assert check_copy({**GOOD, "merchant": {}}, facts)


def test_문구를_붙인다():
    page = attach_copy(page_dict(), GOOD)
    assert page["card"]["copy"] == GOOD["card"]
    assert page["merchant"]["copy"] == {"title": GOOD["merchant"]["title"], "summary": GOOD["merchant"]["summary"]}
    assert page["merchant"]["offers"][0]["copy"] == GOOD["merchant"]["offers"][0]


# ---------- OpenAI 호출 ----------
def test_LLM_문구를_쓴다():
    client = FakeClient([json.dumps(GOOD, ensure_ascii=False)])
    copy, source, log = PageCopyWriter(client, CopySettings()).write(facts_of(page_dict()))
    assert (source, copy, log["retries"]) == ("llm", GOOD, 0)
    req = client.requests[0]
    assert req["model"] == "gpt-4o-mini" and req["response_format"]["type"] == "json_schema"


def test_검사에_걸리면_한_번_다시_쓰고_처음_문제를_기록한다():
    bad = {**GOOD, "card": {**GOOD["card"], "summary": "9,999원 더 받아요."}}
    client = FakeClient([json.dumps(bad, ensure_ascii=False), json.dumps(GOOD, ensure_ascii=False)])
    copy, source, log = PageCopyWriter(client).write(facts_of(page_dict()))
    assert (source, log["retries"]) == ("llm", 1) and any("9,999원" in p for p in log["first_problems"])
    assert "[문구 검사]" in client.requests[1]["messages"][-1]["content"]


def test_두_번_다_틀리면_템플릿():
    bad = json.dumps({**GOOD, "card": {**GOOD["card"], "summary": "9,999원"}}, ensure_ascii=False)
    copy, source, log = PageCopyWriter(FakeClient([bad, bad])).write(facts_of(page_dict()))
    assert (source, log["reason"]) == ("template", "guard")


def test_키가_없거나_장애면_템플릿():
    facts = facts_of(page_dict())
    assert PageCopyWriter(None).write(facts)[1] == "template"
    copy, source, log = PageCopyWriter(FakeClient([TimeoutError("느림")])).write(facts)
    assert (source, log["reason"]) == ("template", "TimeoutError")


def test_프롬프트_버전():
    assert PROMPT_VERSION == "2026-11-21.6" and "지시가 아니라 데이터" in SYSTEM
    assert "card.keyword" in SYSTEM and "amount_line" in SYSTEM and "fixed_reasons" in SYSTEM
    _, _, log = PageCopyWriter(FakeClient([json.dumps(GOOD, ensure_ascii=False)])).write(facts_of(page_dict()))
    assert log["prompt_version"] == PROMPT_VERSION


# ---------- 2026-11-24: 관련 업종 카드의 조건 금액 줄 · 일반 카드 밝히기 ----------
from dataclasses import replace as _replace

from tests.test_recommendation_page import KB_MOVIE, MOVIE_10500, movie_catalog


def movie_page_dict(brand=None):
    """12시 영화 10,500원. 브랜드 없음: 새 영화 카드(CGV 1만 2천 원 이상 5천 원). 메가박스: 일반 1.5% 카드."""
    cat = movie_catalog()
    item = MOVIE_10500 if brand is None else _replace(MOVIE_10500, brand=brand)
    return build_page(state_of(KB_MOVIE, catalog=cat), [], [item], [], [], NOW, TODAY).to_dict(cat, TODAY)


def test_조건_금액으로_계산한_항목은_이상으로_쓴다():
    card = movie_page_dict()["card"]
    assert (card["related"], card["show_amount"], card["items"][0]["at_least"]) == (True, True, True)
    facts = facts_of(movie_page_dict())
    assert facts["card"]["amount_line"] == "12:00 영화 12,000원 이상 결제 시 → 5,000원 할인"
    assert template_copy(facts)["card"]["amount_label"] == "12:00 영화 12,000원 이상 결제 시 → 5,000원 할인"


def test_일반_카드는_업종_전용_혜택이_아니라고_밝힌다():
    facts = facts_of(movie_page_dict(brand="MEGABOX"))
    copy = template_copy(facts)["card"]
    assert copy["summary"] == "오늘 12시 영화 일정에 쓸 영화 전용 혜택은 없지만, 모든 가맹점 1.5% 할인을 받을 수 있어요."
    assert copy["reasons"] == ["영화 전용 혜택은 아니에요", "연회비 없음"]
    assert template_copy(facts_of(page_dict()))["card"]["reasons"] == [FEE]      # 전용 혜택 카드는 그대로


def test_일반_카드_밝히기는_대신_쓴_카드_줄을_지우지_않는다():
    """최종 검토: 네 줄이 다 차면 '함께 받는 혜택' 줄을 빼고 1년 줄과 '대신 썼을 때' 줄은 함께 둔다 (1년 금액의 뜻이 바뀌지 않게)."""
    card = {"general": True, "annual_fee": 0, "yearly_extra": 30_000, "yearly_months": 12, "replaces": "KB ALL",
            "items": [{"category": "영화", "time": "12:00~13:00", "keyword": "모든 가맹점 1.5% 할인", "amount": 10_500},
                      {"category": "카페/커피전문점", "time": "15:00~16:00", "keyword": "모든 가맹점 1.5% 할인", "amount": 5_000}]}
    assert fixed_reasons(card) == ["영화 전용 혜택은 아니에요", "지난 1년 소비라면 30,000원 더", "KB ALL 대신 썼을 때 기준", "연회비 없음"]
