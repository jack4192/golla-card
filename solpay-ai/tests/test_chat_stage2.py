"""챗봇 고도화 2단계: 새 도구 6개 (2026-11-24, docs/superpowers/specs/2026-11-24-chatbot-stage2-design.md).

결제 요약, 지난 결제 다시 보기, 받은 혜택 정리, 하루 카드 계획, 카드 지정 비교, 내 규칙 보기.
"""

import json
from datetime import datetime

from engine.chat import guard, prompts
from engine.chat.new_card import recommend_new_cards
from engine.chat.tools import TOOL_SPECS, block_summary
from engine.slots import ym_of
from tests.test_chat import AT, DEMO, service, tb  # noqa: F401

NEW = ("get_spending", "review_payments", "get_benefit_summary", "get_day_plan", "compare_cards", "list_my_rules")


def _sum(payments, start, end, keep=lambda p: True):
    rows = [p for p in payments if start <= p.paid_at < end and keep(p)]
    return sum(p.amount for p in rows), len(rows)


# ---------- 데이터 없이 ----------

def test_2단계_도구와_지시문():
    names = [t["function"]["name"] for t in TOOL_SPECS]
    assert len(names) >= 15 and all(n in names for n in NEW)     # 3단계에서 초안 도구 2개를 더해 17개
    text = prompts.system_prompt(AT, ["KB ALL 카드"])
    for n in NEW:
        assert n in text, n
    assert "그 결제만 보면" in text                   # 지난 결제 비교의 한계를 밝히게


# ---------- 결제 요약 ----------

def test_결제_요약_이번_달(tb):
    r = tb.run("get_spending", {"period": "this_month"})
    start = datetime(2026, 11, 1, tzinfo=AT.tzinfo)
    total, count = _sum(tb.context.payments, start, AT)
    assert (r["total"], r["count"]) == (total, count) and count > 0
    assert sum(c["amount"] for c in r["by_category"]) <= total
    assert sum(c["amount"] for c in r["by_card"]) == total
    prev_total, _ = _sum(tb.context.payments, datetime(2026, 10, 1, tzinfo=AT.tzinfo), AT.replace(month=10))
    assert r["previous"]["total"] == prev_total and r["previous"]["from"] == "2026-10-01"
    assert 0 < len(r["recent"]) <= 5 and r["recent"] == sorted(r["recent"], key=lambda x: x["date"], reverse=True)
    assert tb.blocks[-1]["type"] == "spending_summary"


def test_결제_요약_업종·카드·기간_거르기(tb):
    cafe = tb.run("get_spending", {"period": "last_month", "category_name": "카페"})
    total, _ = _sum(tb.context.payments, datetime(2026, 10, 1, tzinfo=AT.tzinfo), datetime(2026, 11, 1, tzinfo=AT.tzinfo),
                    lambda p: p.category == "CAFE")
    assert cafe["total"] == total and {c["category_name"] for c in cafe["by_category"]} <= {tb.catalog.category_name("CAFE")}
    assert (cafe["from"], cafe["to"]) == ("2026-10-01", "2026-10-31")
    kb = tb.run("get_spending", {"period": "this_month", "card_name": "KB"})
    assert [c["name"] for c in kb["by_card"]] in ([], ["KB ALL 카드"])
    assert "error" in tb.run("get_spending", {"period": "someday"})


def test_가맹점_원문은_보내지_않는다(tb):
    raw = {m.name for m in tb.catalog.merchants.values() if m.name and m.name != m.brand_code and len(m.name) > 3}
    for name, args in (("get_spending", {"period": "this_year"}), ("review_payments", {"period": "this_month"})):
        text = json.dumps(tb.run(name, args), ensure_ascii=False)
        assert not [n for n in raw if n in text], name


# ---------- 지난 결제 다시 보기 ----------

def test_지난_결제_다시_보기는_엔진_계산과_같다(service, tb):
    r = tb.run("review_payments", {"period": "this_month"})
    assert r["count"] > 0 and r["payments"]
    for p in r["payments"]:
        assert p["best_got"] >= p["got"] and p["missed"] == p["best_got"] - p["got"]
    state = service.build_state(tb.context, AT)
    state.roll_to(ym_of(AT))
    assert r["got_total"] == sum(st.discount for st in state.ledger.values())     # 다시 계산한 받은 혜택 = 엔진 장부
    assert r["missed_total"] >= 0 and "note" in r
    missed = tb.run("review_payments", {"period": "this_month", "only_missed": True})
    assert all(p["missed"] > 0 for p in missed["payments"])
    assert [p["missed"] for p in missed["payments"]] == sorted((p["missed"] for p in missed["payments"]), reverse=True)
    assert tb.blocks[-1]["type"] == "payment_review"


def test_지난_결제를_가맹점으로_거르기(tb):
    r = tb.run("review_payments", {"period": "this_year", "merchant_name": "스타벅스"})
    assert all(p["brand"] == "스타벅스" for p in r["payments"])


# ---------- 받은 혜택 정리 ----------

def test_지난달_받은_혜택은_월간_리포트와_같다(service, tb):
    r = tb.run("get_benefit_summary", {"period": "last_month"})
    rep = service.monthly_report(DEMO, AT, None)
    assert r["month"] == "2026-10" and r["card_benefit_total"] == rep["totals"]["prev_month_benefit"]
    assert r["effect_sentences"] == rep["summary"]["effect"]
    assert sum(c["benefit"] for c in r["cards"]) == r["card_benefit_total"]


def test_올해_받은_혜택과_놓친_혜택(tb):
    r = tb.run("get_benefit_summary", {"period": "this_year"})
    assert r["year"] == 2026 and r["card_benefit_total"] == sum(m["benefit"] for m in r["by_month"])
    assert r["total"] == r["card_benefit_total"] + r["promotion_total"]
    assert 1 <= len(r["by_month"]) <= 11 and len(r["missed_top"]) <= 3
    assert all(m["gain"] > 0 and m["card_name"] for m in r["missed_top"])
    assert "결산" in r["note"] and tb.blocks[-1]["type"] == "benefit_summary"
    # 앱 표의 놓친 혜택 줄은 어느 카드인지 보이게 '이 카드' 대신 카드 이름 (2026-11-24 화면 확인)
    for line, m in zip(tb.blocks[-1]["lines"], r["missed_top"]):
        assert m["card_name"] in line and "이 카드" not in line


# ---------- 하루 카드 계획 ----------

def test_하루_카드_계획(tb):
    r = tb.run("get_day_plan", {})
    seg = r["segments"]
    assert seg[0]["start"] == "00:00" and seg[-1]["end"] == "24:00"
    assert all(a["end"] == b["start"] for a, b in zip(seg, seg[1:]))
    assert {s["card"] for s in seg} <= set(tb.card_names())
    at19 = tb.run("get_day_plan", {"hour": 19})["at_hour"]
    assert at19["start"] <= "19:00" < at19["end"]
    assert tb.blocks[-1]["type"] == "day_plan"


# ---------- 카드 지정 비교 ----------

def test_카드_지정_비교는_새_카드_추천_계산과_같다(service, tb):
    r = tb.run("compare_cards", {"card_names": ["Simple Plan+", "모두의카드", "LOCA LIKIT"]})
    assert [c["name"] for c in r["cards"]] == ["신한카드 Simple Plan+", "신한 모두의카드", "LOCA LIKIT"]
    state = service.build_state(tb.context, AT)
    for c in r["cards"]:
        card = next(x for x in tb.catalog.cards.values() if tb.catalog.card_label(x.card_id) == c["name"])
        same = recommend_new_cards(state, tb.context.payments, AT, 3, cards=[card])["cards"][0]
        assert (c["monthly_benefit"], c["net_benefit"]) == (same["monthly_benefit"], same["net_benefit"])
    assert tb.blocks[-1]["type"] == "new_card_list" and tb.blocks[-1]["title"]
    assert all(c["net_benefit"] == c["monthly_benefit"] - c["annual_fee_monthly"] for c in r["cards"])
    assert "since_january_gain" not in r["cards"][2]                    # 다른 카드사 카드는 '그때 만들었다면' 계산 없음
    assert "error" in tb.run("compare_cards", {"card_names": ["없는카드이름"]})


# ---------- 내 규칙 보기 ----------

def test_내_규칙_보기(service, tb):
    service.store.reset()
    empty = tb.run("list_my_rules", {})
    assert empty["count"] == 0 and empty["note"]
    kb = next(c.user_card_id for c in tb.cards if "KB" in tb.names[c.user_card_id])
    service.store.save_rules(DEMO, [{"rule_type": "force", "condition": {"days": ["weekend"]},
                                     "target": {"user_card_ids": [kb]}, "settings": {}, "source_text": "주말엔 KB 먼저"}])
    try:
        r = tb.run("list_my_rules", {})
        assert r["count"] == 1 and "KB" in r["rules"][0]["summary"] and r["rules"][0]["kind"] == "먼저 보여 주기"
        assert tb.blocks[-1]["type"] == "rule_list"
    finally:
        service.store.reset()


# ---------- 요약 문장 ----------

def test_새_화면_요소도_요약_문장이_숫자_검사를_통과(tb):
    for name, args in (("get_spending", {"period": "this_month"}), ("review_payments", {"period": "this_month"}),
                       ("get_benefit_summary", {"period": "last_month"}), ("get_benefit_summary", {"period": "this_year"}),
                       ("get_day_plan", {}), ("compare_cards", {"card_names": ["Simple Plan+", "모두의카드"]}),
                       ("list_my_rules", {})):
        tb.run(name, args)
        text = block_summary(tb.blocks)
        assert text, name
        assert guard.check(text, guard.collect_facts(tb.results), False, False) == [], (name, text)
