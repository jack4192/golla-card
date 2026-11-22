"""월간 리포트 요약 문장: 사실 고르기, 엔진 효과·전략 문장, 정해진 문구, 검사, 작성기
(설계서 2026-11-22-monthly-report-design.md '변경 (2026-11-22 저녁): 효과 문장은 엔진이 쓴다'·'전략 문장도 엔진')."""

import json
import re

from engine.chat.page_copy import CopySettings, PageCopyWriter
from engine.chat.report_copy import (ReportCopyWriter, check_copy, effect_lines, facts_of, reason_of,
                                     strategy_lines, template_copy)
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


def good():
    return {"headline": "10월에 카드 혜택 47,070원을 받았어요.",
            "points": ["10월에 신한카드 Discount Plan 혜택은 43,220원이었어요.",
                       "KB ALL 카드 첫 구간까지 28,200원 모자랐어요."]}


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


def test_사실에_카드별_구간_숫자가_있다():
    cards = {c["name"]: c for c in facts()["cards"]}
    assert cards["신한카드 Discount Plan"] == {
        "name": "신한카드 Discount Plan", "prev_month_benefit": 43220, "prev_month_perf": 1542790, "this_month_benefit": 1140,
        "first_tier": 400000, "first_tier_achieved": True, "next_tier": 400000, "remaining_to_next": 351560}
    assert cards["KB ALL 카드"]["first_tier_achieved"] is False and cards["KB ALL 카드"]["short_of_first"] == 28200
    r = report()
    r["cards"][0]["prev_month"].update(first_tier=None, achieved=None, tier_reached=None)      # 실적 조건 없는 카드
    r["cards"][0]["this_month"].update(next_tier=None, remaining_to_next=None)
    plain = facts_of(r)["cards"][0]
    assert set(plain) == {"name", "prev_month_benefit", "prev_month_perf", "this_month_benefit"}


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


# ---------- 정해진 문구 (OpenAI 몫: 제목과 카드 숫자 요점) ----------

def test_정해진_문구는_제목과_카드_숫자_요점만():
    copy = template_copy(facts())
    assert copy == {"headline": "10월에 카드 혜택 47,070원을 받았어요.",
                    "points": ["10월에는 신한카드 Discount Plan 혜택이 43,220원으로 가장 컸어요.",
                               "이번 달(11월)은 지금까지 카드 혜택 1,180원을 받았어요."]}
    assert check_copy(copy, facts()) == []
    # 효과·전략이 무엇이든 같다 (효과·전략 문장은 엔진이 따로 쓴다)
    for f in (facts(effect=False), facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN),
              facts(base_reason=HOLD, base_source="hold"), facts(current="none", label="실적 안 채움")):
        assert template_copy(f) == copy and check_copy(template_copy(f), f) == []


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
    assert check_copy(template_copy(facts_of(r)), facts_of(r)) == []


# ---------- 검사 ----------

def test_검사_통과():
    assert check_copy(good(), facts()) == []


def test_검사_모르는_숫자():
    copy = {"headline": "10월 혜택", "points": ["10월에 12,345원을 받았어요."]}
    assert len(check_copy(copy, facts())) == 1


def test_검사_효과_금액은_사실에_없어_걸린다():
    copy = {"headline": "10월에 카드 혜택 47,070원을 받았어요.", "points": ["SOL페이 덕분에 5,180원 이득이에요."]}
    assert any("5,180" in p for p in check_copy(copy, facts()))


def test_검사_반올림_허용():
    copy = {"headline": "10월에 약 5만 원을 받았어요.", "points": ["신한카드 Discount Plan 혜택이 43,220원으로 가장 컸어요."]}
    assert check_copy(copy, facts()) == []


def test_검사_OpenAI_문장에_전략_표현이_있으면_문제():
    head = "10월에 카드 혜택 47,070원을 받았어요."
    for claim in ("SOL페이 추천 카드로 냈어요.", "이번 달은 주력 카드 우선 방식이에요.", "지금은 KB ALL 카드 실적을 먼저 채우고 있어요.",
                  "KB ALL 카드 실적을 채워요.", "지난달 첫 구간을 채웠어요.", "기본 카드는 KB ALL 카드예요."):
        problems = check_copy({"headline": head, "points": [claim]}, facts())
        assert any("전략" in p or "효과" in p for p in problems), claim


def test_검사_OpenAI_문장에_효과_표현이_있으면_문제():
    head = "10월에 카드 혜택 47,070원을 받았어요."
    for claim in ("추천대로 냈다면 혜택이 늘었어요.", "카드 혜택을 더 받을 수 있었어요.", "추천 카드보다 덜 받았어요.",
                  "KB ALL 카드 실적이 줄어 구간을 놓쳤어요.", "KB ALL 카드가 다음 구간에 올라요.", "KB ALL 카드가 구간에 올랐어요.",
                  "카드 혜택을 더받았어요.", "카드 혜택을 덜받았어요.", "KB ALL 카드는 첫 구간을 놓친 달이에요."):
        problems = check_copy({"headline": head, "points": [claim]}, facts())
        assert any("효과" in p for p in problems), claim
    assert any("효과" in p for p in check_copy({"headline": "추천대로면 더 받았어요", "points": ["한 줄이에요."]}, facts()))


def test_검사_저장_주장과_소비_권유():
    copy = {"headline": "10월 혜택", "points": ["규칙을 저장했어요.", "카페에서 더 쓰세요."]}
    assert len(check_copy(copy, facts())) == 2


def test_검사_형식():
    assert check_copy({"headline": "", "points": []}, facts())
    assert check_copy({"headline": "a", "points": ["a", "b", "c"]}, facts())          # points 는 1~2개
    assert check_copy({"headline": 1, "points": "x"}, facts())
    assert check_copy("문자열", facts())


# ---------- 작성기 ----------

def test_writer_좋은_답이면_llm():
    client = FakeClient([json.dumps(good(), ensure_ascii=False)])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "llm" and copy == good() and log["retries"] == 0
    req = client.requests[0]
    assert req["response_format"]["json_schema"]["name"] == "report_copy"
    schema = req["response_format"]["json_schema"]["schema"]
    assert set(schema["properties"]) == {"headline", "points"} and schema["properties"]["points"]["maxItems"] == 2
    sent = json.loads(req["messages"][1]["content"])
    assert "effect" not in sent and "strategy" not in sent and sent["prev_month_benefit"] == 47070
    assert log["prompt_version"] == "2026-11-22.4"


def test_writer_효과_표현을_쓰면_다시_쓰고_정해진_문구():
    f = facts(total=-700, card=-700, next_month=0, tier_changes=KB_DOWN)
    wrong = json.dumps({"headline": "10월에 카드 혜택 47,070원을 받았어요.",
                        "points": ["추천대로 냈다면 혜택이 늘었어요.", "주력 카드 우선 방식으로 채우고 있어요."]}, ensure_ascii=False)
    copy, source, log = ReportCopyWriter(FakeClient([wrong, wrong]), CopySettings()).write(f)
    assert source == "template" and log["reason"] == "guard" and log["retries"] == 1
    assert copy == template_copy(f) and check_copy(copy, f) == []


def test_writer_검사_실패면_다시_쓰고_정해진_문구():
    bad = json.dumps({"headline": "x", "points": ["12,345원을 받았어요."]}, ensure_ascii=False)
    client = FakeClient([bad, bad])
    copy, source, log = ReportCopyWriter(client, CopySettings()).write(facts())
    assert source == "template" and log["retries"] == 1 and log["reason"] == "guard"
    assert copy == template_copy(facts())


def test_writer_다시_쓰면_통과():
    bad = json.dumps({"headline": "x", "points": ["12,345원을 받았어요."]}, ensure_ascii=False)
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
    assert ReportCopyWriter.prompt_version == "2026-11-22.4" and PageCopyWriter.settings_env == "PAGE_COPY_TIMEOUT_SEC"


def test_프롬프트에_실제_카드_이름과_금액_예시가_없다():
    from engine.chat.report_copy import SYSTEM
    for word in ("KB ALL", "40만", "닿지 못했어요", "-1,450원", "5,180원", "1,450", "올원더풀", "EVerywhere", "Discount Plan"):
        assert word not in SYSTEM, word
    for word in ("주력 카드 우선", "실적 안 채움", "base_reason", "strategy."):
        assert word not in SYSTEM, word                              # 전략 사실은 보내지 않는다
    assert not re.search(r"\d,\d{3}", SYSTEM)                      # 예시 금액은 자리표시로만
    assert "추천" in SYSTEM and "방식" in SYSTEM and "채우" in SYSTEM  # 효과·전략 표현은 쓰지 말라고 말한다
