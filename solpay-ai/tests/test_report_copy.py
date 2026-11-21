"""월간 리포트 요약 문장: 사실 고르기, 정해진 문구, 검사, 작성기 (설계서 2026-11-22-monthly-report-design.md '요약 문장')."""

import json

from engine.chat.page_copy import CopySettings, PageCopyWriter
from engine.chat.report_copy import ReportCopyWriter, check_copy, facts_of, template_copy
from tests.test_page_copy import FakeClient


def _card(name, this_benefit, prev_benefit):
    return {"user_card_id": 1, "card_id": 2, "name": name, "issuer": "SHINHAN", "display_order": 1,
            "this_month": {"perf": 48440, "benefit": this_benefit, "payments": 9, "tier_min": 1500000,
                           "remaining_to_keep": 1451560, "next_tier": 400000, "remaining_to_next": 351560, "limits": []},
            "prev_month": {"perf": 1542790, "benefit": prev_benefit, "payments": 112, "first_tier": 400000,
                           "tier_reached": 1500000, "achieved": True, "short_of_first": 0},
            "synced_note": False}


def report(total=5180, card=290, promotion=0, next_month=4890, tier_changes=None, top_changes=None, effect=True):
    effect_dict = {
        "month": "2026-10", "placement_payments": 81, "changed_payments": 43,
        "actual": {"card": 47070, "promotion": 500, "next_month": 46820},
        "recommended": {"card": 47070 + card, "promotion": 500 + promotion, "next_month": 46820 + next_month},
        "diff": {"card": card, "promotion": promotion, "next_month": next_month, "total": total},
        "top_changes": top_changes if top_changes is not None else [
            {"day": "2026-10-12", "category": "카페", "amount": 6500, "actual_card": "신한카드 Discount Plan",
             "recommended_card": "KB ALL 카드", "diff": -300, "why": "실적 채우기"}],
        "tier_changes": tier_changes or []}
    return {"user_id": 1, "month": "2026-11", "prev_month": "2026-10",
            "totals": {"this_month_benefit": 1180, "prev_month_benefit": 47070},
            "cards": [_card("신한카드 Discount Plan", 1140, 43220), _card("KB ALL 카드", 40, 3850)],
            "strategy": {"current": "main_top", "label": "주력 카드 우선", "description": "구간 혜택이 가장 큰 주력 카드부터 채워요",
                         "chosen_by": "monthly", "chosen_by_label": "월간 맞춤 (지난 결제로 방식 비교)", "compare_months": 6,
                         "compare": [{"method": "main_top", "label": "주력 카드 우선", "benefit": 418100}],
                         "base_card": {"user_card_id": 1, "name": "신한카드 Discount Plan", "target_tier": 400000,
                                       "remaining": 351560}, "message": "엔진 안내 문구"},
            "solpay_effect": effect_dict if effect else None,
            "effect_note": "참고용 추정"}


KB_TIER = [{"card": "KB ALL 카드", "first_tier": 400000, "actual_perf": 371800, "recommended_perf": 300000,
            "actual_tier": None, "recommended_tier": None}]


def facts(**kw):
    return facts_of(report(**kw))


def good(total=5180):
    return {"headline": "10월에 카드 혜택 47,070원을 받았어요.",
            "points": [f"추천대로 냈다면 {total:,}원을 더 받을 수 있었어요."]}


def test_사실에_가맹점_이름과_사용자_번호가_없다():
    f = facts()
    text = json.dumps(f, ensure_ascii=False)
    assert "user_id" not in text and "merchant" not in text
    assert "신한카드 Discount Plan" in text and "카페" in text and "2026-10-12" in text
    assert f["effect"]["diff"]["total"] == 5180


def test_정해진_문구_더_받은_경우():
    copy = template_copy(facts())
    assert copy["headline"] == "10월에 카드 혜택 47,070원을 받았어요."
    text = " ".join(copy["points"])
    assert "5,180원을 더 받을 수 있었어요" in text and "10월 290원" in text and "4,890원 예상" in text
    assert "11월" in text and len(copy["points"]) <= 3
    assert check_copy(copy, facts()) == []


def test_정해진_문구_덜_받은_경우():
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_TIER)
    copy = template_copy(f)
    text = " ".join(copy["points"])
    assert "700원 덜 받았어요" in text and "KB ALL 카드로 실적을 모았지만 40만 원 구간에 닿지 못했어요" in text
    assert "더 받" not in copy["headline"] + text
    assert check_copy(copy, f) == []


def test_정해진_문구_덜_받았고_구간_변화_없으면_업종으로_이유():
    f = facts(total=-700, card=-700, next_month=0)
    text = " ".join(template_copy(f)["points"])
    assert "700원 덜 받았어요" in text and "카페" in text and "실적 채우기" in text
    assert check_copy(template_copy(f), f) == []


def test_정해진_문구_효과_없으면_이번_달_방식():
    f = facts(effect=False)
    copy = template_copy(f)
    assert copy["headline"] == "10월에 카드 혜택 47,070원을 받았어요."
    assert "주력 카드 우선" in " ".join(copy["points"]) and "더 받" not in " ".join(copy["points"])
    assert check_copy(copy, f) == []


def test_검사_통과():
    assert check_copy(good(), facts()) == []


def test_검사_모르는_숫자():
    copy = {"headline": "10월 혜택", "points": ["추천대로 냈다면 12,345원을 더 받을 수 있었어요."]}
    assert len(check_copy(copy, facts())) == 1


def test_검사_반올림_허용():
    copy = {"headline": "10월에 약 5만 원을 받았어요.", "points": ["약 5,000원 더 받을 수 있었어요."]}
    assert check_copy(copy, facts()) == []


def test_검사_음수인데_더_받았다():
    f = facts(total=-700, card=-700, next_month=0)
    copy = {"headline": "10월 혜택", "points": ["추천대로 냈다면 700원을 더 받았어요."]}
    assert any("더 받" in p for p in check_copy(copy, f))


def test_검사_음수인데_덜_받은_금액이_없다():
    f = facts(total=-700, card=-700, next_month=0)
    copy = {"headline": "10월에 카드 혜택 47,070원을 받았어요.", "points": ["추천 카드와 비교하면 덜 받았어요."]}
    assert any("덜 받은 금액" in p for p in check_copy(copy, f))


def test_검사_저장_주장과_소비_권유():
    copy = {"headline": "10월 혜택", "points": ["규칙을 저장했어요.", "카페에서 더 쓰세요."]}
    assert len(check_copy(copy, facts())) == 2


def test_검사_형식():
    assert check_copy({"headline": "", "points": []}, facts())
    assert check_copy({"headline": "a", "points": ["a", "b", "c", "d"]}, facts())
    assert check_copy({"headline": 1, "points": "x"}, facts())
    assert check_copy("문자열", facts())


def test_writer_좋은_답이면_llm():
    client = FakeClient([json.dumps(good(), ensure_ascii=False)])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "llm" and copy == good() and log["retries"] == 0
    req = client.requests[0]
    assert req["response_format"]["json_schema"]["name"] == "report_copy"
    assert json.loads(req["messages"][1]["content"])["effect"]["diff"]["total"] == 5180
    assert log["prompt_version"] == "2026-11-22.1"


def test_writer_검사_실패면_다시_쓰고_정해진_문구():
    bad = json.dumps({"headline": "x", "points": ["12,345원을 더 받았어요."]}, ensure_ascii=False)
    client = FakeClient([bad, bad])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "template" and log["retries"] == 1 and log["reason"] == "guard"
    assert copy == template_copy(facts())


def test_writer_다시_쓰면_통과():
    bad = json.dumps({"headline": "x", "points": ["12,345원을 더 받았어요."]}, ensure_ascii=False)
    client = FakeClient([bad, json.dumps(good(), ensure_ascii=False)])
    _, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "llm" and log["retries"] == 1


def test_writer_키_없으면_정해진_문구():
    copy, source, log = ReportCopyWriter(None).write(facts())
    assert source == "template" and log["reason"] == "no_api_key" and copy == template_copy(facts())


def test_writer_장애면_정해진_문구():
    _, source, log = ReportCopyWriter(FakeClient([RuntimeError("boom")]), CopySettings()).write(facts())
    assert source == "template" and log["reason"] == "RuntimeError"


def test_설정_환경_변수(monkeypatch):
    monkeypatch.setenv("REPORT_COPY_TIMEOUT_SEC", "3")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    s = CopySettings.from_env(ReportCopyWriter.settings_env)
    assert s.timeout_sec == 3 and s.model == "gpt-4o-mini"
    assert ReportCopyWriter.prompt_version == "2026-11-22.1" and PageCopyWriter.settings_env == "PAGE_COPY_TIMEOUT_SEC"
