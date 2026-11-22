"""월간 리포트 요약 문장: 사실과 후보 문장, 엔진 효과·전략 문장, 정해진 문구, 검사, 작성기
(설계서 2026-11-22-monthly-report-design.md '변경 (2026-11-22 저녁): 효과 문장은 엔진이 쓴다'·'전략 문장도 엔진'·
'변경 (2026-11-22 심야): 요점 문장도 엔진이 쓰고 OpenAI 는 고르기만')."""

import json
import re

from engine.chat.page_copy import CopySettings, PageCopyWriter
from engine.chat.report_copy import (ReportCopyWriter, check_copy, check_headline, effect_lines, facts_of, points_of,
                                     reason_of, strategy_lines, template_copy)
from tests.test_page_copy import FakeClient


def _card(name, this_benefit, prev_benefit, **prev):
    return {"user_card_id": 1, "card_id": 2, "name": name, "issuer": "SHINHAN", "display_order": 1,
            "this_month": {"perf": 48440, "benefit": this_benefit, "payments": 9, "tier_min": 1500000,
                           "remaining_to_keep": 1451560, "next_tier": 400000, "remaining_to_next": 351560, "limits": []},
            "prev_month": {"perf": 1542790, "benefit": prev_benefit, "payments": 112, "first_tier": 400000,
                           "tier_reached": 1500000, "achieved": True, "short_of_first": 0, **prev},
            "synced_note": False}


KB_SHORT = dict(perf=371800, tier_reached=None, achieved=False, short_of_first=28200)     # 첫 구간 40만 원까지 28,200원 모자람


def report(total=5180, card=290, promotion=0, next_month=4890, tier_changes=None, top_changes=None, effect=True,
           **strategy):
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
            "cards": [_card("신한카드 Discount Plan", 1140, 43220), _card("KB ALL 카드", 40, 3850, **KB_SHORT)],
            "strategy": {"current": "main_top", "label": "주력 카드 우선", "description": "구간 혜택이 가장 큰 주력 카드부터 채워요",
                         "chosen_by": "monthly", "chosen_by_label": "월간 맞춤 (지난 결제로 방식 비교)", "compare_months": 6,
                         "compare": [{"method": "main_top", "label": "주력 카드 우선", "benefit": 418100}],
                         "base_card": {"user_card_id": 1, "name": "신한카드 Discount Plan", "tier_min": 1500000,
                                       "remaining_to_keep": 1451560, "next_tier": 400000, "remaining_to_next": 351560},
                         "base_reason": None, "base_source": "strategy", "message": "엔진 안내 문구", **strategy},
            "solpay_effect": effect_dict if effect else None,
            "effect_note": "참고용 추정"}


# 엔진(_tier_changes)이 실제로 만드는 모양: 도달 구간이 다른 카드만, direction 은 추천 구간이 높으면 up, 낮으면 down
KB_DOWN = [{"card": "KB ALL 카드", "first_tier": 400000, "actual_perf": 412000, "recommended_perf": 371800,
            "actual_tier": 400000, "recommended_tier": None, "direction": "down"}]
KB_UP = [{"card": "KB ALL 카드", "first_tier": 400000, "actual_perf": 371800, "recommended_perf": 412000,
          "actual_tier": None, "recommended_tier": 400000, "direction": "up"}]
# 데모 4번 (2026-11-05 12시, 효과 +8,550원): 추천대로면 NH 올원더풀 실적이 140,900→443,900원으로 늘어 40만 원 구간에 오른다.
# 카드가 바뀐 결제는 모두 덜 받았고(편의점), 더 받은 몫은 실적 덕분의 11월 혜택이다.
NH_UP = [{"card": "NH농협 올원더풀 (할인 PACK)", "first_tier": 400000, "actual_perf": 140900, "recommended_perf": 443900,
          "actual_tier": None, "recommended_tier": 400000, "direction": "up"}]
DEMO4_CHANGES = [
    {"day": "2026-10-27", "category": "편의점", "amount": 1700, "actual_card": "신한카드 EVerywhere",
     "recommended_card": "NH농협 올원더풀 (할인 PACK)", "diff": -80, "why": "혜택 비교"},
    {"day": "2026-10-13", "category": "편의점", "amount": 2200, "actual_card": "신한카드 EVerywhere",
     "recommended_card": "NH농협 올원더풀 (할인 PACK)", "diff": -110, "why": "혜택 비교"},
    {"day": "2026-10-15", "category": "편의점", "amount": 4200, "actual_card": "신한카드 EVerywhere",
     "recommended_card": "NH농협 올원더풀 (할인 PACK)", "diff": -210, "why": "실적 채우기"}]
GAINED = [{"day": "2026-10-19", "category": "카페", "amount": 6500, "actual_card": "KB ALL 카드",
           "recommended_card": "신한카드 Discount Plan+", "diff": 150, "why": "혜택 비교"},
          {"day": "2026-10-15", "category": "약국", "amount": 33800, "actual_card": "신한카드 SOL트래블 체크",
           "recommended_card": "신한카드 Discount Plan+", "diff": 1690, "why": "실적 채우기"},
          {"day": "2026-10-12", "category": "카페", "amount": 6500, "actual_card": "신한카드 Discount Plan",
           "recommended_card": "KB ALL 카드", "diff": -300, "why": "실적 채우기"}]


def facts(**kw):
    return facts_of(report(**kw))


def lines(**kw):
    return effect_lines(report(**kw))


def reason(**kw):
    return reason_of(report(**kw)["solpay_effect"], 10, 11)


def strategy(**kw):
    return strategy_lines(report(**kw))


def cid(f, card, kind):
    """사실의 후보 문장 번호 (카드 이름, 종류)."""
    return next(c["id"] for c in f["candidates"] if c["card"] == card and c["kind"] == kind)


def text_of(f, card, kind):
    return next(c["text"] for c in f["candidates"] if c["card"] == card and c["kind"] == kind)


HEAD = "10월에 카드 혜택 47,070원을 받았어요."


def good(f=None):
    """OpenAI 의 좋은 답: 제목 + 후보 번호 두 개 (Discount Plan 지난달 혜택, KB ALL 첫 구간까지 모자란 금액)."""
    f = f or facts()
    return {"headline": HEAD, "picks": [cid(f, "신한카드 Discount Plan", "prev_benefit"), cid(f, "KB ALL 카드", "prev_short")]}


GOOD_POINTS = ["10월에 신한카드 Discount Plan 혜택은 43,220원이었어요.", "KB ALL 카드 첫 구간까지 28,200원 모자랐어요."]


# ---------- 사실 (OpenAI 에 보내는 것) ----------

def test_사실에_가맹점_이름과_사용자_번호가_없다():
    text = json.dumps(facts(), ensure_ascii=False)
    assert "user_id" not in text and "merchant" not in text
    assert "신한카드 Discount Plan" in text and "KB ALL 카드" in text


def test_사실에_전략이_없다():
    # 방식·기본 카드 이야기는 엔진 문장(strategy_lines)만 한다 (전략 문장도 엔진, 2026-11-22 사용자 결정)
    r = report(base_reason="어느 방식이든 지난달 받은 구간을 지킬 수 있으면 그 카드를 먼저 채워요", base_source="hold")
    f = facts_of(r)
    text = json.dumps(f, ensure_ascii=False)
    assert "strategy" not in f
    for key in ("strategy", "label", "description", "chosen_by_label", "compare", "base_card", "base_reason", "base_source"):
        assert f'"{key}"' not in text, key
    assert "주력 카드 우선" not in text and "구간을 지킬" not in text


def test_사실에는_합계와_후보_문장만_있다():
    f = facts()
    assert set(f) == {"month", "prev_month", "this_month_benefit", "prev_month_benefit", "this_total_line", "fixed_headline",
                      "candidates"}
    assert all(set(c) == {"id", "card", "kind", "amount", "text"} for c in f["candidates"])
    assert [c["id"] for c in f["candidates"]] == list(range(1, len(f["candidates"]) + 1))      # 번호는 1부터 차례로


def test_사실에_효과가_없다():
    # 효과 숫자·이유를 OpenAI 가 섞어 거짓 이유를 쓰지 못하게 (데모 4번) 효과는 통째로 뺀다
    for f in (facts(), facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN),
              facts(total=8_550, card=-1_450, promotion=-1_000, next_month=11_000, tier_changes=NH_UP,
                    top_changes=DEMO4_CHANGES)):
        text = json.dumps(f, ensure_ascii=False)
        assert "effect" not in f and "solpay_effect" not in f
        for key in ("solpay_effect", "effect", "diff", "top_changes", "tier_changes", "shortfall", "less_by_part", "reason"):
            assert f'"{key}"' not in text, key
        assert "올원더풀" not in text and "편의점" not in text and "8550" not in text and "443900" not in text


# ---------- 엔진 효과 문장 (effect_lines) ----------

def test_효과_문장_더_받음_구간_올라감():
    out = lines(total=8_550, card=-1_450, promotion=-1_000, next_month=11_000, tier_changes=NH_UP,
                top_changes=DEMO4_CHANGES)
    assert len(out) == 2
    assert "8,550원을 더" in out[0] and "-1,450원" in out[0] and "-1,000원" in out[0] and "+11,000원" in out[0]
    assert out[0] == ("추천대로 냈다면 8,550원을 더 받을 수 있었어요"
                      "(10월 카드 혜택 -1,450원, 10월 프로모션 -1,000원, 실적 덕분에 11월 +11,000원 예상).")
    for word in ("NH농협 올원더풀 (할인 PACK)", "140,900원", "443,900원", "40만 원"):
        assert word in out[1], word
    assert out[1] == "추천대로였다면 NH농협 올원더풀 (할인 PACK) 실적이 140,900원에서 443,900원으로 늘어 40만 원 구간에 올랐어요."
    assert "놓쳤" not in " ".join(out) and "덜 받" not in " ".join(out)


def test_효과_문장_더_받음_구간이_내려간_카드가_있어도_올라간_카드():
    out = lines(tier_changes=KB_DOWN + NH_UP)
    assert out[1].startswith("추천대로였다면 NH농협 올원더풀 (할인 PACK) 실적이") and "놓쳤" not in " ".join(out)


def test_효과_문장_더_받음_결제():
    out = lines(top_changes=GAINED)
    assert out == ["추천대로 냈다면 5,180원을 더 받을 수 있었어요(10월 카드 혜택 +290원, 실적 덕분에 11월 +4,890원 예상).",
                   "추천대로였다면 10월 15일 약국 결제에서 1,690원 더 받았어요"
                   "(추천 카드: 신한카드 Discount Plan+, 추천 이유: 실적 채우기)."]


def test_효과_문장_더_받음_항목():
    # 카드가 바뀐 결제는 모두 덜 받았고 구간 변화도 없으면 가장 많이 늘어난 항목
    out = lines(total=8_550, card=-1_450, promotion=-1_000, next_month=11_000, top_changes=DEMO4_CHANGES)
    assert out[1] == "추천대로였다면 지난달 실적으로 11월에 받을 혜택(추정)이 46,820원에서 57,820원으로 늘어요."
    out = lines(total=290, card=290, next_month=0, top_changes=[])
    assert out == ["추천대로 냈다면 290원을 더 받을 수 있었어요(10월 카드 혜택 +290원).",
                   "추천대로였다면 10월 카드 혜택이 47,070원에서 47,360원으로 늘었어요."]


def test_효과_문장_덜_받음_구간_내려감():
    out = lines(total=-700, card=-700, next_month=0, tier_changes=NH_UP + KB_DOWN)
    assert out == ["추천대로 냈다면 700원 덜 받았어요(10월 카드 혜택 -700원).",
                   "추천대로였다면 KB ALL 카드 실적이 412,000원에서 371,800원으로 줄어 40만 원 구간을 놓쳤어요."]
    assert "더 받" not in " ".join(out) and "올랐" not in " ".join(out)


def test_효과_문장_덜_받음_결제():
    # 추천대로면 KB ALL 카드가 40만 원 구간에 닿았다 → '놓쳤어요'는 거짓이다. 가장 많이 덜 받은 결제를 말한다
    out = lines(total=-700, card=-700, next_month=0, tier_changes=KB_UP)
    assert out == ["추천대로 냈다면 700원 덜 받았어요(10월 카드 혜택 -700원).",
                   "추천대로였다면 10월 12일 카페 결제에서 300원 덜 받았어요(추천 카드: KB ALL 카드, 추천 이유: 실적 채우기)."]
    assert "놓쳤" not in " ".join(out) and "더 받" not in " ".join(out)


def test_효과_문장_덜_받음_항목():
    # 카드가 바뀐 결제는 모두 더 받았는데(한도 등으로) 합계가 음수: 줄어든 항목을 그대로 말한다
    out = lines(total=-110, card=-110, next_month=0, top_changes=GAINED[:1])
    assert out[1] == "추천대로였다면 10월 카드 혜택이 47,070원에서 46,960원으로 줄었어요."
    out = lines(total=-960, card=0, next_month=-960, top_changes=[])
    assert out[1] == "추천대로였다면 지난달 실적으로 11월에 받을 혜택(추정)이 46,820원에서 45,860원으로 줄어요."
    out = lines(total=-700, card=-200, promotion=-500, next_month=0, top_changes=[])
    assert out[1] == "추천대로였다면 10월 프로모션이 500원에서 0원으로 줄었어요."


def test_효과_문장_덜_받은_경우도_부분_합을_보인다():
    out = lines(total=-1_000, card=-40, next_month=-960, top_changes=[])
    assert out[0] == "추천대로 냈다면 1,000원 덜 받았어요(10월 카드 혜택 -40원, 실적 차이로 11월 -960원 예상)."


def test_효과_문장_같음_이유_없음():
    assert lines(total=0, card=0, next_month=0) == ["추천대로 냈어도 받는 혜택은 같았어요."]
    assert lines(total=0, card=0, next_month=0, top_changes=GAINED, tier_changes=NH_UP) == ["추천대로 냈어도 받는 혜택은 같았어요."]


def test_효과_없으면_빈_목록():
    assert lines(effect=False) == []


def test_효과_문장은_카드_이름_바로_뒤에_조사를_붙이지_않는다():
    # 'PACK)'·'Plan+'·'EVerywhere' 처럼 영문·기호로 끝나는 이름은 받침으로 '로/으로'를 고를 수 없다
    names = ("NH농협 올원더풀 (할인 PACK)", "신한카드 Discount Plan+", "신한카드 EVerywhere", "KB ALL 카드")
    every = [lines(total=8_550, card=-1_450, promotion=-1_000, next_month=11_000, tier_changes=NH_UP),
             lines(top_changes=GAINED), lines(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN),
             lines(total=-700, card=-700, next_month=0, tier_changes=KB_UP),
             lines(total=-700, card=-700, next_month=0,
                   top_changes=[{**DEMO4_CHANGES[2], "recommended_card": "신한카드 EVerywhere"}])]
    seen = 0
    for line in (x for out in every for x in out):
        for name in names:
            for m in re.finditer(re.escape(name), line):
                seen += 1
                assert line[m.end():].startswith((" 실적", ",", ")")), line
    assert seen == 5


def test_엔진이_고르는_이유_하나():
    assert reason(total=-700, card=-700, next_month=0, tier_changes=NH_UP + KB_DOWN) == {
        "kind": "tier_down", "card": "KB ALL 카드", "actual_perf": 412000, "recommended_perf": 371800, "lost_tier": 400000}
    assert reason(tier_changes=KB_DOWN + NH_UP) == {
        "kind": "tier_up", "card": "NH농협 올원더풀 (할인 PACK)", "actual_perf": 140900, "recommended_perf": 443900,
        "reached_tier": 400000}
    assert reason(total=-700, card=-700, next_month=0, tier_changes=KB_UP) == {
        "kind": "payment", "day": "2026-10-12", "category": "카페", "recommended_card": "KB ALL 카드", "less": 300,
        "why": "실적 채우기"}
    assert reason(top_changes=GAINED) == {
        "kind": "payment", "day": "2026-10-15", "category": "약국", "recommended_card": "신한카드 Discount Plan+",
        "more": 1690, "why": "실적 채우기"}
    assert reason(total=-700, card=-200, promotion=-500, next_month=0, top_changes=[]) == {
        "kind": "part", "part": "promotion", "label": "10월 프로모션", "actual": 500, "recommended": 0}
    assert reason(total=0, card=0, next_month=0) is None


# ---------- 엔진 전략 문장 (strategy_lines) ----------
HOLD = "어느 방식이든 지난달 받은 구간을 지킬 수 있으면 그 카드를 먼저 채워요"
MAIN_TOP = "최근 6개월 결제로 방식을 비교해 혜택이 가장 컸던 '주력 카드 우선' 방식을 이번 달에 써요(구간 혜택이 가장 큰 주력 카드부터 채워요)."
NONE_DESC = "실적을 채우지 않고 결제마다 혜택률이 가장 높은 카드"


def test_전략_문장_방식이_고른_카드를_채운다():
    assert strategy() == [MAIN_TOP, "지금은 신한카드 Discount Plan 실적부터 채우고 있어요."]


def test_전략_문장_구간_지키기():
    out = strategy(base_reason=HOLD, base_source="hold")
    assert out == [MAIN_TOP, "다만 지난달 실적으로 닿은 구간은 어느 방식이든 먼저 지켜서, "
                             "지금은 신한카드 Discount Plan 실적부터 채우고 있어요."]


def test_전략_문장_데모_3번_실적_안_채움인데_구간_지키기():
    # 데모 3번 (2026-11-05): 실적 안 채움 방식이지만 엔진은 구간 지키기를 어느 방식보다 먼저 한다 (ranker.choose_base)
    out = strategy(current="none", label="실적 안 채움", description=NONE_DESC, base_reason=HOLD, base_source="hold",
                   compare=[{"method": "none", "label": "실적 안 채움", "benefit": 30000},
                            {"method": "main_top", "label": "주력 카드 우선", "benefit": 20000}],
                   base_card={"user_card_id": 9, "name": "BC 업턴 카드"})
    assert out == ["최근 6개월 결제로 방식을 비교해 혜택이 가장 컸던 '실적 안 채움' 방식을 이번 달에 써요"
                   f"({NONE_DESC}).",
                   "다만 지난달 실적으로 닿은 구간은 어느 방식이든 먼저 지켜서, 지금은 BC 업턴 카드 실적부터 채우고 있어요."]


def test_전략_문장_실적_안_채움이고_구간_지키기_없음():
    out = strategy(current="none", label="실적 안 채움", description=NONE_DESC, base_source="nothing",
                   compare=[{"method": "none", "label": "실적 안 채움", "benefit": 30000}])
    assert out[1] == "지금은 실적을 먼저 채우는 카드가 없어요."
    assert "채우고 있어요" not in " ".join(out) and "Discount Plan" not in " ".join(out)


def test_전략_문장_채울_구간이_없음():
    out = strategy(base_source="nothing")
    assert out == [MAIN_TOP, "지금은 닿을 수 있는 구간 중 채울 만한 곳이 없어 실적을 먼저 채우는 카드가 없어요."]


def test_전략_문장_월간_맞춤_근거():
    assert strategy()[0] == MAIN_TOP
    # 더 나은 방식이 있었지만 차이가 adaptive_margin 보다 작아 처음 방식을 둔 경우: '가장 컸던'은 거짓이다
    out = strategy(compare=[{"method": "value", "label": "가치 최대", "benefit": 418500},
                            {"method": "main_top", "label": "주력 카드 우선", "benefit": 418100}])
    assert out[0] == ("최근 6개월 결제로 방식을 비교했지만 차이가 크지 않아 '주력 카드 우선' 방식을 그대로 써요"
                      "(구간 혜택이 가장 큰 주력 카드부터 채워요).")
    assert "가장 컸던" not in out[0]
    # 혜택이 같은 방식이 여럿이면 (동점이면 처음 방식) '가장 컸던'이라고 하지 않는다
    out = strategy(compare=[{"method": "main_top", "label": "주력 카드 우선", "benefit": 418100},
                            {"method": "value", "label": "가치 최대", "benefit": 418100}])
    assert out[0] == ("최근 6개월 결제로 방식을 비교해 혜택이 가장 큰 방식이 여럿이어서, 그중 '주력 카드 우선' 방식을 이번 달에 써요"
                      "(구간 혜택이 가장 큰 주력 카드부터 채워요).")


def test_전략_문장_규칙_근거():
    out = strategy(chosen_by="rule", chosen_by_label="사용자 설정 (규칙)", compare=[], compare_months=None)
    assert out[0] == "설정하신 규칙대로 이번 달은 '주력 카드 우선' 방식을 써요(구간 혜택이 가장 큰 주력 카드부터 채워요)."
    forced = strategy(base_source="forced")
    assert forced[1] == "설정하신 규칙대로 지금은 신한카드 Discount Plan부터 보여 드려요."
    no_fill = strategy(base_source="no_fill")
    assert no_fill[1] == "설정하신 규칙으로 모든 카드의 실적을 채우지 않아서, 지금은 실적을 먼저 채우는 카드가 없어요."


def test_전략_문장_그_밖의_근거와_단계():
    desc = "(구간 혜택이 가장 큰 주력 카드부터 채워요)."
    assert strategy(chosen_by="user_confirmed", compare=[])[0] == f"직접 정하신 '주력 카드 우선' 방식을 이번 달에 써요{desc}"
    assert strategy(chosen_by="insufficient_history", compare=[])[0] == \
        f"결제 이력이 짧아 방식 비교 없이 '주력 카드 우선' 방식을 써요{desc}"
    assert strategy(chosen_by="default", compare=[])[0] == f"이번 달은 '주력 카드 우선' 방식을 써요{desc}"
    assert strategy(base_source="loss_guard")[1] == (
        "다만 최근 결제를 SOL페이 추천대로 다시 돌려 보니 평소대로 낸 것보다 덜 받아서, 이번 달은 실적을 먼저 채우는 카드가 없어요.")
    assert strategy(base_source="month_end")[1] == (
        "다만 달 말에는 어느 방식이든 다음 구간이 가까운 카드를 먼저 채워서, 지금은 신한카드 Discount Plan 실적부터 채우고 있어요.")
    # 프로모션 카드 화면은 기본 카드를 다시 정하지 않는다(직전 값) → 기본 카드 문장 없음
    assert strategy(base_source="promotion") == [MAIN_TOP]
    assert strategy(base_source=None) == [MAIN_TOP]


def test_전략_문장은_카드_이름_바로_뒤에_조사를_붙이지_않는다():
    for name in ("NH농협 올원더풀 (할인 PACK)", "신한카드 Discount Plan+", "신한카드 EVerywhere"):
        for source in ("strategy", "hold", "month_end", "forced"):
            line = strategy(base_source=source, base_card={"user_card_id": 1, "name": name})[1]
            assert line[line.index(name) + len(name):].startswith((" 실적", "부터")), line


# ---------- 후보 문장 (엔진이 쓴다. 2026-11-22 사용자 결정: OpenAI 는 고르기만, 닿은 구간·지킬 구간도 후보에) ----------
NO_TIER = dict(first_tier=None, tier_reached=None, achieved=None, short_of_first=None)


def report23():
    """23번 모양 (2026-11-05): BC 케이퍼스트 카드·Simple Plan 은 실적 조건이 없고, SOL트래블 체크만 첫 구간 300,000원이 있다."""
    r = report(total=-14_500, card=5_470, promotion=-25_440, next_month=5_470)
    r["totals"] = {"this_month_benefit": 2110, "prev_month_benefit": 21110}
    bc = _card("BC 케이퍼스트 카드", 1950, 12070, perf=1151700, **NO_TIER)
    sol = _card("신한카드 SOL트래블 체크", 10, 80, perf=581500, first_tier=300000, tier_reached=300000)
    simple = _card("신한카드 Simple Plan", 150, 8960, perf=908950, **NO_TIER)
    for c, perf in ((bc, 200800), (simple, 15800)):
        c["this_month"].update(perf=perf, tier_min=None, remaining_to_keep=None, next_tier=None, remaining_to_next=None)
    sol["this_month"].update(perf=138350, tier_min=300000, remaining_to_keep=161650, next_tier=300000, remaining_to_next=161650)
    r["cards"] = [bc, sol, simple]
    return r


def kinds(f, card):
    return [c["kind"] for c in f["candidates"] if c["card"] == card]


def test_후보_높은_구간에_닿은_카드():
    f, name = facts(), "신한카드 Discount Plan"
    assert kinds(f, name) == ["prev_benefit", "prev_tier", "keep_tier", "next_tier", "this_benefit"]
    assert [c["text"] for c in f["candidates"] if c["card"] == name] == [
        "10월에 신한카드 Discount Plan 혜택은 43,220원이었어요.",
        "신한카드 Discount Plan 지난달 실적은 1,542,790원으로 150만 원 구간에 닿았어요.",
        "이번 달 신한카드 Discount Plan 150만 원 구간을 지키기까지 1,451,560원 남았어요.",
        "이번 달 신한카드 Discount Plan 다음 구간 400,000원까지 351,560원 남았어요.",
        "이번 달 신한카드 Discount Plan 혜택은 지금까지 1,140원이에요."]
    assert [c["amount"] for c in f["candidates"] if c["card"] == name] == [43220, 1500000, 1451560, 351560, 1140]


def test_후보_첫_구간에_못_닿은_카드는_모자란_금액만():
    f = facts()
    assert text_of(f, "KB ALL 카드", "prev_short") == "KB ALL 카드 첫 구간까지 28,200원 모자랐어요."
    assert "prev_tier" not in kinds(f, "KB ALL 카드")                 # '넘겼어요'·'닿았어요' 문장은 만들지 않는다
    assert not any("KB ALL 카드" in c["text"] and ("넘겼" in c["text"] or "닿았" in c["text"]) for c in f["candidates"])


def test_후보_첫_구간만_닿은_카드는_넘겼어요():
    f = facts_of(report23())
    assert text_of(f, "신한카드 SOL트래블 체크", "prev_tier") == \
        "신한카드 SOL트래블 체크 지난달 실적은 581,500원으로 첫 구간 300,000원을 넘겼어요."


def test_후보_지킬_구간과_다음_구간이_같으면_지킬_구간만():
    f = facts_of(report23())
    assert kinds(f, "신한카드 SOL트래블 체크") == ["prev_benefit", "prev_tier", "keep_tier", "this_benefit"]
    assert text_of(f, "신한카드 SOL트래블 체크", "keep_tier") == \
        "이번 달 신한카드 SOL트래블 체크 30만 원 구간을 지키기까지 161,650원 남았어요."


def test_후보_실적_조건_없는_카드는_혜택만():
    r = report23()
    r["cards"][0]["this_month"].update(tier_min=300000, remaining_to_keep=99200, next_tier=300000, remaining_to_next=99200)
    f = facts_of(r)                                                    # 이번 달 칸에 구간이 잘못 들어와도 쓰지 않는다
    assert kinds(f, "BC 케이퍼스트 카드") == ["prev_benefit", "this_benefit"]
    assert kinds(f, "신한카드 Simple Plan") == ["prev_benefit", "this_benefit"]


def test_후보_0원과_이미_채운_구간은_만들지_않는다():
    r = report()
    r["cards"][0]["prev_month"]["benefit"] = 0
    r["cards"][0]["this_month"].update(benefit=0, remaining_to_keep=0, next_tier=None, remaining_to_next=0)
    assert kinds(facts_of(r), "신한카드 Discount Plan") == ["prev_tier"]


def test_후보_마지막은_이번_달_합계():
    last = facts()["candidates"][-1]
    assert last == {"id": 11, "card": None, "kind": "this_total", "amount": 1180,
                    "text": "이번 달(11월)은 지금까지 카드 혜택 1,180원을 받았어요."}


def test_후보_문장은_카드_이름_바로_뒤에_조사를_붙이지_않는다():
    r = report23()
    for c, name in zip(r["cards"], ("NH농협 올원더풀 (할인 PACK)", "신한카드 Discount Plan+", "삼성 iD SIMPLE 카드")):
        c["name"] = name
    r["cards"][0]["prev_month"].update(first_tier=400000, tier_reached=None, achieved=False, short_of_first=1000)
    for c in facts_of(r)["candidates"]:
        if c["card"]:
            assert c["text"][c["text"].index(c["card"]) + len(c["card"])] == " ", c["text"]


def test_후보_숫자는_리포트_값_그대로():
    # 틀린 문장 7종(2026-11-22 재검토) 가운데 요점 쪽: 실적을 혜택이라고, 남은 금액을 넘겼다고, 모자랐는데 넘겼다고 → 엔진 문장이라 나올 수 없다
    f = facts()
    assert "1,542,790원" not in text_of(f, "신한카드 Discount Plan", "prev_benefit")
    assert "넘겼" not in text_of(f, "신한카드 Discount Plan", "next_tier")
    assert points_of(good()["picks"], f) == GOOD_POINTS


# ---------- 정해진 문구 ----------

def test_정해진_문구는_제목과_카드_숫자_요점만():
    copy = template_copy(facts())
    assert copy == {"headline": HEAD,
                    "points": ["10월에는 신한카드 Discount Plan 혜택이 43,220원으로 가장 컸어요.",
                               "이번 달(11월)은 지금까지 카드 혜택 1,180원을 받았어요."]}
    assert check_headline(copy["headline"], facts()) == []
    # 효과·전략이 무엇이든 같다 (효과·전략 문장은 엔진이 따로 쓴다)
    for f in (facts(effect=False), facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN),
              facts(base_reason=HOLD, base_source="hold"), facts(current="none", label="실적 안 채움")):
        assert template_copy(f) == copy


def test_정해진_문구_지난달_혜택이_없거나_같은_카드가_여럿이면():
    r = report()
    for c in r["cards"]:
        c["prev_month"]["benefit"] = 0
    r["totals"]["prev_month_benefit"] = 0
    assert template_copy(facts_of(r))["points"] == ["이번 달(11월)은 지금까지 카드 혜택 1,180원을 받았어요."]
    for c in r["cards"]:
        c["prev_month"]["benefit"] = 500
    points = template_copy(facts_of(r))["points"]
    assert points[0] == "10월에는 신한카드 Discount Plan 혜택이 500원이었어요." and "가장" not in points[0]


def test_정해진_문구의_제목은_검사를_통과한다():
    long_name = report()
    long_name["cards"][0]["name"] = "삼성월렛 하나 트래블로그 체크카드 (아주 긴 이름을 가진 시험용 카드 상품)"
    for r in (report23(), report(), report(effect=False), long_name):
        f = facts_of(r)
        assert check_headline(template_copy(f)["headline"], f) == []


# ---------- 검사 (OpenAI 답: headline + picks) ----------

def test_검사_통과():
    assert check_copy(good(), facts()) == []
    assert check_copy({"headline": HEAD, "picks": [11]}, facts()) == []           # 하나만 골라도 된다


def test_검사_형식():
    f = facts()
    assert check_copy("문자열", f)
    assert check_copy({"headline": "", "picks": [1]}, f)
    assert check_copy({"headline": 1, "picks": [1]}, f)
    for picks in ([], [1, 2, 3], [1, 1], [0], [99], ["1"], [True], "1", None):
        assert check_copy({"headline": HEAD, "picks": picks}, f), picks


def test_검사_요점을_직접_쓴_답은_받지_않는다():
    # 예전 모양(points 문장)으로 답하면 picks 가 없어 걸린다. 요점 문장은 엔진 후보만 쓴다
    f = facts()
    assert check_copy({"headline": HEAD, "points": ["10월에 신한카드 Discount Plan 혜택은 1,542,790원이었어요."]}, f)


def test_검사_제목의_숫자는_지난달과_지난달_혜택_합계만():
    f = facts()
    for ok in (HEAD, "지난달 카드 혜택은 47,070원이었어요", "2026년 10월 카드 혜택 47,070원", "10월 카드 혜택을 정리했어요"):
        assert check_headline(ok, f) == [], ok
    wrong = {
        "100배": "10월에 카드 혜택 4,707,000원을 받았어요.",
        "약 없이 반올림": "10월에 카드 혜택 50,000원을 받았어요.",
        "약 붙인 반올림": "10월에 카드 혜택 약 5만 원을 받았어요.",
        "달 바꿔치기": "11월에 카드 혜택 47,070원을 받았어요.",
        "이번 달이라고": "이번 달 카드 혜택 47,070원을 받았어요.",
        "달 없음": "카드 혜택 47,070원을 받았어요.",
        "건수 지어내기": "10월에 250번 결제하고 카드 혜택 47,070원을 받았어요.",
        "이번 달 합계": "10월에 카드 혜택 1,180원을 받았어요.",
        "카드 한 장 값": "10월에 카드 혜택 43,220원을 받았어요.",
        "쉼표 없음": "10월에 카드 혜택 47070원을 받았어요.",
        "단위 없음": "10월 카드 혜택 47,070",
    }
    for why, headline in wrong.items():
        assert check_headline(headline, f), why


def test_검사_제목에_카드_이름과_효과_전략_표현은_쓰지_않는다():
    f = facts()
    for headline in ("10월에 KB ALL 카드 혜택 47,070원을 받았어요.", "10월에 추천대로 냈다면 더 받았어요", "10월은 주력 카드 우선 방식이에요",
                     "10월 실적을 채웠어요", "10월 혜택을 저장했어요.", "10월처럼 더 쓰세요", "10월에 카드 혜택을 놓쳤어요"):
        assert check_headline(headline, f), headline
    assert any("40자" in p for p in check_headline("10월에 카드 혜택 47,070원을 받았어요. " + "정말 좋은 달이었어요 " * 3, f))


# ---------- 작성기 ----------

def test_writer_좋은_답이면_llm():
    f = facts()
    client = FakeClient([json.dumps(good(), ensure_ascii=False)])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(f)
    assert source == "llm" and log["retries"] == 0
    assert copy == {"headline": HEAD, "points": GOOD_POINTS, "picks": good()["picks"]}     # 요점은 고른 후보 문장 그대로
    req = client.requests[0]
    assert req["response_format"]["json_schema"]["name"] == "report_copy"
    schema = req["response_format"]["json_schema"]["schema"]
    assert set(schema["properties"]) == {"headline", "picks"} and schema["properties"]["picks"]["maxItems"] == 2
    assert schema["properties"]["picks"]["items"] == {"type": "integer"}
    sent = json.loads(req["messages"][1]["content"])
    assert "effect" not in sent and "strategy" not in sent and "cards" not in sent
    assert sent["prev_month_benefit"] == 47070 and sent["candidates"] == f["candidates"]
    assert log["prompt_version"] == "2026-11-22.7"


def test_writer_답에_다른_문장이_섞여도_요점은_후보_문장만():
    f = facts()
    reply = {**good(), "points": ["10월에 신한카드 Discount Plan 혜택은 1,542,790원이었어요."]}
    copy, source, _ = ReportCopyWriter(FakeClient([json.dumps(reply, ensure_ascii=False)]), CopySettings()).write(f)
    assert source == "llm" and copy["points"] == GOOD_POINTS


def test_writer_제목이_틀리면_다시_쓰고_정해진_문구():
    f = facts()
    wrong = json.dumps({"headline": "10월에 카드 혜택 4,707,000원을 받았어요.", "picks": [1]}, ensure_ascii=False)
    client = FakeClient([wrong, wrong])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(f)
    assert source == "template" and log["reason"] == "guard" and log["retries"] == 1
    assert copy == template_copy(f)
    assert "4,707,000" in client.requests[1]["messages"][-1]["content"]          # 다시 쓸 때 걸린 이유를 알려 준다


def test_writer_없는_번호를_고르면_다시_쓰고_정해진_문구():
    bad = json.dumps({"headline": HEAD, "picks": [99]}, ensure_ascii=False)
    copy, source, log = ReportCopyWriter(FakeClient([bad, bad]), CopySettings()).write(facts())
    assert source == "template" and log["retries"] == 1 and log["reason"] == "guard"
    assert copy == template_copy(facts())


def test_writer_다시_쓰면_통과():
    bad = json.dumps({"headline": HEAD, "picks": [99]}, ensure_ascii=False)
    client = FakeClient([bad, json.dumps(good(), ensure_ascii=False)])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "llm" and log["retries"] == 1 and copy["points"] == GOOD_POINTS


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
    assert ReportCopyWriter.prompt_version == "2026-11-22.7" and PageCopyWriter.settings_env == "PAGE_COPY_TIMEOUT_SEC"


def test_프롬프트에_실제_카드_이름과_금액_예시가_없다():
    from engine.chat.report_copy import SYSTEM
    for word in ("KB ALL", "40만", "닿지 못했어요", "-1,450원", "5,180원", "1,450", "올원더풀", "EVerywhere", "Discount Plan"):
        assert word not in SYSTEM, word
    for word in ("주력 카드 우선", "실적 안 채움", "base_reason", "strategy."):
        assert word not in SYSTEM, word                              # 전략 사실은 보내지 않는다
    assert not re.search(r"\d,\d{3}", SYSTEM) and not re.search(r"\d{4,}", SYSTEM)   # 예시 금액은 자리표시로만
    assert "picks" in SYSTEM and "candidates" in SYSTEM and "고쳐 쓰지" in SYSTEM     # 요점은 후보에서 고르기만
    assert "추천" in SYSTEM and "방식" in SYSTEM and "채우" in SYSTEM  # 효과·전략 표현은 쓰지 말라고 말한다


# ---------- 혜택 0원·결제 없는 달 (2026-11-22 사용자 결정: 문장 표현) ----------

def _zero(r, month, payments):
    """month('this_month'·'prev_month')의 혜택을 0원으로, 결제 수를 payments 로."""
    for c in r["cards"]:
        c[month].update(benefit=0, payments=payments)
    r["totals"]["this_month_benefit" if month == "this_month" else "prev_month_benefit"] = 0
    return r


def test_이번_달_혜택이_0원이면_합계_문장을_바꾼다():
    f = facts_of(_zero(report(), "this_month", 3))
    assert " 0원" not in json.dumps(f["candidates"], ensure_ascii=False)
    assert "this_total" not in [c["kind"] for c in f["candidates"]]          # 다른 후보가 있으면 0원 합계는 후보에서 뺀다
    assert template_copy(f)["points"][-1] == "이번 달(11월)은 아직 받은 카드 혜택이 없어요."
    f = facts_of(_zero(report(), "this_month", 0))
    assert template_copy(f)["points"][-1] == "이번 달(11월)은 아직 결제가 없어요. 결제하면 받은 혜택을 여기서 알려 드려요."


def test_후보가_하나도_없으면_0원_합계_후보만_남긴다():
    r = _zero(_zero(report23(), "this_month", 0), "prev_month", 0)
    r["cards"] = [r["cards"][0]]                                              # 실적 조건 없는 카드 한 장, 혜택 0원
    f = facts_of(r)
    assert f["candidates"] == [{"id": 1, "card": None, "kind": "this_total", "amount": 0,
                                "text": "이번 달(11월)은 아직 결제가 없어요. 결제하면 받은 혜택을 여기서 알려 드려요."}]


def test_지난달_혜택이_0원이면_제목은_엔진이_쓴다():
    cases = [(dict(payments=5), {}, "10월에는 아쉽게도 받은 카드 혜택이 없었어요."),
             (dict(payments=0), {"has_history": True}, "10월에는 결제 기록이 없어요."),
             (dict(payments=0), {"has_history": False}, "첫 리포트예요. 다음 달부터 지난달 혜택을 정리해 드려요.")]
    for kw, extra, headline in cases:
        f = facts_of({**_zero(report(), "prev_month", **kw), **extra})
        assert f["fixed_headline"] == headline and template_copy(f)["headline"] == headline
        # OpenAI 가 제목을 뭐라고 쓰든 엔진 제목을 쓰고, 고르기만 받는다
        reply = json.dumps({"headline": "10월에 카드 혜택 0원을 받았어요", "picks": [1]}, ensure_ascii=False)
        copy, source, _ = ReportCopyWriter(FakeClient([reply]), CopySettings()).write(f)
        assert source == "llm" and copy["headline"] == headline
    assert facts()["fixed_headline"] is None


def test_제목에_0원은_쓰지_못한다():
    f = facts()
    f["prev_month_benefit"] = 0                                               # 엔진 제목이 없는데 0원이 온 경우에도 막는다
    assert check_headline("10월에 카드 혜택 0원을 받았어요.", f)


def test_지난달_쓰지_않은_카드는_모자랐다고_하지_않는다():
    r = report()
    r["cards"][1]["prev_month"].update(perf=0, payments=0, short_of_first=400000)
    assert "prev_short" not in kinds(facts_of(r), "KB ALL 카드")
