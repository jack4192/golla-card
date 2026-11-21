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
                         "base_card": {"user_card_id": 1, "name": "신한카드 Discount Plan", "tier_min": 1500000,
                                       "remaining_to_keep": 1451560, "next_tier": 400000, "remaining_to_next": 351560},
                         "message": "엔진 안내 문구"},
            "solpay_effect": effect_dict if effect else None,
            "effect_note": "참고용 추정"}


# 엔진(_tier_changes)이 실제로 만드는 모양: 도달 구간이 다른 카드만, direction 은 추천 구간이 높으면 up, 낮으면 down
KB_DOWN = [{"card": "KB ALL 카드", "first_tier": 400000, "actual_perf": 412000, "recommended_perf": 371800,
            "actual_tier": 400000, "recommended_tier": None, "direction": "down"}]
KB_UP = [{"card": "KB ALL 카드", "first_tier": 400000, "actual_perf": 371800, "recommended_perf": 412000,
          "actual_tier": None, "recommended_tier": 400000, "direction": "up"}]


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
    assert "5,180원을 더 받을 수 있었어요(10월 카드 혜택 +290원, 실적 덕분에 11월 +4,890원 예상)" in text
    assert "11월" in text and len(copy["points"]) <= 3
    assert check_copy(copy, facts()) == []


def test_정해진_문구_덜_받았고_구간이_내려간_카드가_있으면_그_구간():
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN)
    copy = template_copy(f)
    text = " ".join(copy["points"])
    assert "700원 덜 받았어요" in text
    assert "추천대로였다면 KB ALL 카드 실적이 412,000원에서 371,800원으로 줄어 40만 원 구간을 놓쳤어요" in text
    assert "더 받" not in copy["headline"] + text and "닿지 못했" not in text
    assert check_copy(copy, f) == []


def test_정해진_문구_덜_받았고_구간이_올라간_카드뿐이면_가장_큰_손해_결제():
    # 추천대로면 KB ALL 카드가 40만 원 구간에 닿았다 → '닿지 못했어요'·'놓쳤어요'는 거짓이다
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_UP)
    text = " ".join(template_copy(f)["points"])
    assert "700원 덜 받았어요" in text
    assert "10월 12일 카페 결제를 KB ALL 카드로 냈다면 300원 덜 받았어요" in text and "실적 채우기" in text
    assert "닿지 못했" not in text and "놓쳤" not in text
    assert check_copy(template_copy(f), f) == []


def test_정해진_문구_덜_받았고_구간_변화_없으면_가장_큰_손해_결제():
    f = facts(total=-700, card=-700, next_month=0)
    text = " ".join(template_copy(f)["points"])
    assert "700원 덜 받았어요" in text and "10월 12일 카페 결제를 KB ALL 카드로 냈다면 300원 덜 받았어요" in text
    assert check_copy(template_copy(f), f) == []


def test_정해진_문구_덜_받았는데_손해_본_결제가_없으면_가장_큰_손해_항목():
    # 카드가 바뀐 결제는 모두 더 받았는데(한도 등으로) 합계가 음수: 줄어든 항목을 그대로 말한다
    gained = [{"day": "2026-10-19", "category": "카페", "amount": 6500, "actual_card": "KB ALL 카드",
               "recommended_card": "신한카드 Discount Plan", "diff": 150, "why": "혜택 비교"}]
    f = facts(total=-110, card=-110, next_month=0, top_changes=gained)
    text = " ".join(template_copy(f)["points"])
    assert "110원 덜 받았어요" in text and "추천대로였다면 10월 카드 혜택이 47,070원에서 46,960원으로 줄었어요" in text
    assert "결제를" not in text
    assert check_copy(template_copy(f), f) == []

    f = facts(total=-960, card=0, next_month=-960, top_changes=[])
    text = " ".join(template_copy(f)["points"])
    assert "추천대로였다면 지난달 실적으로 11월에 받을 혜택(추정)이 46,820원에서 45,860원으로 줄어요" in text
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
    assert log["prompt_version"] == "2026-11-22.2"


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
    assert ReportCopyWriter.prompt_version == "2026-11-22.2" and PageCopyWriter.settings_env == "PAGE_COPY_TIMEOUT_SEC"


def test_검사_음수인데_이유가_없다():
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN)
    amount_only = {"headline": "10월에 카드 혜택 47,070원을 받았어요.", "points": ["추천대로 냈다면 700원 덜 받았어요."]}
    assert any("이유" in p for p in check_copy(amount_only, f))
    with_reason = {"headline": amount_only["headline"],
                   "points": ["추천대로 냈다면 700원 덜 받았어요.", "KB ALL 카드로 실적을 모았어요."]}
    assert check_copy(with_reason, f) == []
    by_category = {"headline": amount_only["headline"], "points": ["카페 결제에서 700원 덜 받았어요."]}
    assert check_copy(by_category, f) == []


def test_정해진_문구_덜_받은_모든_변형이_검사를_통과():
    for kw in ({"tier_changes": KB_DOWN}, {"tier_changes": KB_UP}, {}, {"top_changes": []},
               {"tier_changes": KB_UP, "top_changes": []}):
        f = facts(total=-700, card=-700, next_month=0, **kw)
        assert check_copy(template_copy(f), f) == []
    f = facts(total=-700, card=-200, promotion=-500, next_month=0, top_changes=[])
    assert "프로모션" in " ".join(template_copy(f)["points"]) and check_copy(template_copy(f), f) == []


# ---------- 최종 검토 (2026-11-22): 덜 받은 경우의 숫자·방향, 부분 합, 더/덜 받 검사 ----------

def test_사실에_구간_방향과_덜_받은_금액의_절댓값이_있다():
    f = facts(total=-1_000, card=-1_000, next_month=0, tier_changes=KB_DOWN)
    ef = f["effect"]
    assert ef["tier_changes"][0]["direction"] == "down"
    assert ef["tier_changes"][0]["perf_gap"] == 412000 - 371800
    assert ef["top_changes"][0]["diff"] == -300 and ef["top_changes"][0]["less"] == 300
    assert ef["less_by_part"] == {"card": 1_000} and ef["shortfall"] == 1_000
    assert "less_by_part" not in facts()["effect"]                        # 줄어든 항목이 없으면 넣지 않는다
    assert "less" not in facts(top_changes=[{**report()["solpay_effect"]["top_changes"][0], "diff": 500}])["effect"]["top_changes"][0]


def test_검사_덜_받은_결제_금액을_양수로_써도_통과():
    f = facts(total=-1_000, card=-1_000, next_month=0)
    copy = {"headline": "10월에 카드 혜택 47,070원을 받았어요.",
            "points": ["추천대로 냈다면 1,000원 덜 받았어요.", "10월 12일 카페 결제를 KB ALL 카드로 냈다면 300원 덜 받았어요."]}
    assert check_copy(copy, f) == []


def test_정해진_문구_더_받았지만_줄어든_항목도_부호와_함께_보인다():
    f = facts(total=8_550, card=-1_450, promotion=-1_000, next_month=11_000)
    point = template_copy(f)["points"][0]
    assert point == ("추천대로 냈다면 8,550원을 더 받을 수 있었어요"
                     "(10월 카드 혜택 -1,450원, 10월 프로모션 -1,000원, 실적 덕분에 11월 +11,000원 예상).")
    assert check_copy(template_copy(f), f) == []


def test_정해진_문구_덜_받은_경우도_부분_합을_보인다():
    f = facts(total=-1_000, card=-40, next_month=-960, top_changes=[])
    point = template_copy(f)["points"][0]
    assert point == "추천대로 냈다면 1,000원 덜 받았어요(10월 카드 혜택 -40원, 실적 차이로 11월 -960원 예상)."
    assert check_copy(template_copy(f), f) == []


def test_검사_더_받은_경우_덜_받았다고_하면_걸린다():
    copy = {"headline": "10월에 카드 혜택 47,070원을 받았어요.", "points": ["추천대로 냈다면 5,180원 덜 받았어요."]}
    assert any("덜 받" in p for p in check_copy(copy, facts()))


def test_검사_차이_0원이면_더_받도_덜_받도_걸린다():
    f = facts(total=0, card=0, next_month=0)
    for claim in ("추천대로 냈다면 더 받았어요.", "추천대로 냈다면 덜 받았어요."):
        copy = {"headline": "10월에 카드 혜택 47,070원을 받았어요.", "points": [claim]}
        assert check_copy(copy, f), claim
    assert check_copy(template_copy(f), f) == []


def test_writer_덜_받았는데_더_받았다고_쓰면_정해진_문구():
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN)
    wrong = json.dumps({"headline": "10월에 카드 혜택 47,070원을 받았어요.",
                        "points": ["추천대로 냈다면 700원을 더 받았어요.", "KB ALL 카드 40만 원 구간 덕분이에요."]},
                       ensure_ascii=False)
    copy, source, log = ReportCopyWriter(FakeClient([wrong, wrong]), CopySettings()).write(f)
    assert source == "template" and log["reason"] == "guard" and log["retries"] == 1
    assert copy == template_copy(f) and check_copy(copy, f) == []
    assert "더 받" not in " ".join([copy["headline"], *copy["points"]])


def test_프롬프트에_실제_카드_이름과_금액_예시가_없다():
    from engine.chat.report_copy import SYSTEM
    assert "KB ALL" not in SYSTEM and "40만" not in SYSTEM and "닿지 못했어요" not in SYSTEM
    assert "direction" in SYSTEM and "base_reason" in SYSTEM and "less" in SYSTEM


def test_사실에_기본_카드_이유가_있다():
    r = report()
    r["strategy"]["base_reason"] = "어느 방식이든 지난달 받은 구간을 지킬 수 있으면 그 카드를 먼저 채워요"
    assert facts_of(r)["strategy"]["base_reason"] == r["strategy"]["base_reason"]
    assert "base_reason" not in facts()["strategy"]                      # 없으면 넣지 않는다


def test_사실에_엔진이_고른_덜_받은_이유가_하나_있다():
    # 이유는 엔진이 고르고(구간이 내려간 카드 → 가장 많이 덜 받은 결제 → 가장 많이 줄어든 항목) LLM 은 그 하나만 문장으로 쓴다
    down = facts(total=-700, card=-700, next_month=0, tier_changes=KB_UP + KB_DOWN)["effect"]["reason"]
    assert down == {"kind": "tier_down", "card": "KB ALL 카드", "actual_perf": 412000, "recommended_perf": 371800,
                    "lost_tier": 400000}
    pay_ = facts(total=-700, card=-700, next_month=0, tier_changes=KB_UP)["effect"]["reason"]
    assert pay_ == {"kind": "payment", "day": "2026-10-12", "category": "카페", "recommended_card": "KB ALL 카드",
                    "less": 300, "why": "실적 채우기"}
    part = facts(total=-700, card=-200, promotion=-500, next_month=0, top_changes=[])["effect"]["reason"]
    assert part == {"kind": "part", "part": "promotion", "label": "10월 프로모션", "actual": 500, "recommended": 0}
    assert "reason" not in facts()["effect"] and "reason" not in facts(total=0, card=0, next_month=0)["effect"]
