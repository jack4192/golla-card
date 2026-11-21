from tests.conftest import USER_CARDS, at, online, pay
from engine.domain import User
from engine.report import (STRATEGY_DESC, STRATEGY_LABEL, card_rows, reason_group, replay_month, tier_info,
                           this_month_tiers)
from engine.state import UserState


def test_tier_info():
    assert tier_info([300_000, 500_000], 320_000) == {"first_tier": 300_000, "tier_reached": 300_000,
                                                      "achieved": True, "short_of_first": 0}
    assert tier_info([200_000], 150_000) == {"first_tier": 200_000, "tier_reached": None,
                                             "achieved": False, "short_of_first": 50_000}
    none = {"first_tier": None, "tier_reached": None, "achieved": None, "short_of_first": None}
    assert tier_info([0], 10_000) == none
    assert tier_info([], 10_000) == none


def _states(catalog, params):
    sept = [pay(101, 320_000, "CAFE", at(8, 5)),     # 8월 실적 32만 → 9월 혜택 10% (한도 1만)
            pay(101, 320_000, "CAFE", at(9, 5)), pay(103, 150_000, "TRANSIT", at(9, 6), merchant=20)]
    now, prev = UserState(User(1), USER_CARDS, catalog, params), UserState(User(1), USER_CARDS, catalog, params)
    for p in sept:
        now.apply(p)
        prev.apply(p)
    prev.roll_to("2026-09")
    now.apply(pay(101, 10_000, "CAFE", at(10, 3)))
    now.roll_to("2026-10")
    return now, prev


def test_card_rows_이번_달과_지난달(catalog, params):
    now, prev = _states(catalog, params)
    rows = {r["user_card_id"]: r for r in card_rows(now, prev, catalog)}
    r101, r102, r103 = rows[101], rows[102], rows[103]

    assert r101["name"] == catalog.card_label(1) and r101["card_id"] == 1 and r101["synced_note"] is False
    assert r101["prev_month"]["perf"] == 320_000 and r101["prev_month"]["achieved"] is True
    assert r101["prev_month"]["payments"] == 1 and r101["prev_month"]["benefit"] == 10_000
    t = r101["this_month"]
    assert (t["perf"], t["payments"], t["tier_min"]) == (10_000, 1, 300_000)
    assert (t["next_tier"], t["remaining_to_next"], t["remaining_to_keep"]) == (300_000, 290_000, 290_000)
    assert t["benefit"] == now.ledger[101].discount == 1_000
    assert t["limits"] == [{"name": "", "used": 1_000, "limit": 10_000, "left": 9_000}]

    assert r103["synced_note"] is True
    assert r103["prev_month"]["short_of_first"] == 50_000 and r103["prev_month"]["achieved"] is False
    assert r103["this_month"]["tier_min"] is None and r103["this_month"]["next_tier"] == 200_000

    assert r102["prev_month"]["payments"] == 0 and r102["prev_month"]["perf"] == 0
    assert r102["prev_month"]["achieved"] is False


def test_무실적_카드는_구간_칸이_비어_있다(catalog, params):
    cards = USER_CARDS + [type(USER_CARDS[0])(104, 4, "SHINHAN", 4)]
    now, prev = (UserState(User(1), cards, catalog, params) for _ in range(2))
    for s, ym in ((now, "2026-10"), (prev, "2026-09")):
        s.roll_to(ym)
    r = next(r for r in card_rows(now, prev, catalog) if r["user_card_id"] == 104)
    assert all(r["this_month"][k] is None for k in ("tier_min", "remaining_to_keep", "next_tier", "remaining_to_next"))
    assert r["prev_month"] == {"perf": 0, "benefit": 0, "payments": 0, "first_tier": None, "tier_reached": None,
                               "achieved": None, "short_of_first": None}


def test_this_month_tiers_구간_0원_카드는_0_그대로(catalog, params):
    now, _ = _states(catalog, params)
    assert this_month_tiers([300_000, 500_000], now.ledger[101]) == {
        "tier_min": 300_000, "remaining_to_keep": 290_000, "next_tier": 300_000, "remaining_to_next": 290_000}
    assert this_month_tiers([0], now.ledger[101]) == {
        "tier_min": 0, "remaining_to_keep": None, "next_tier": None, "remaining_to_next": 0}


# ---------- 카드 배치 전략 근거 ----------

def _service(catalog, priors, params):
    from engine.service import PlacementEngine, PlacementService
    from tests.test_service_api import FakeStore
    return PlacementService(FakeStore(User(1)), PlacementEngine(catalog, priors, params))


def test_strategy_info_규칙이_있으면_rule(catalog, priors, params):
    svc = _service(catalog, priors, params)
    svc.store.save_rules(1, [{"rule_type": "order", "settings": {"base_order": "none"}}])
    out = svc.strategy_info(1, at(10, 7))
    assert out["chosen_by"] == "rule" and out["current"] == "none" and out["label"] == "실적 안 채움"
    assert out["description"] == STRATEGY_DESC["none"]
    assert out["compare"] == [] and out["compare_months"] is None


def test_strategy_info_월간_맞춤_꺼짐이면_default(catalog, priors, params):
    svc = _service(catalog, priors, params.with_(adaptive_months=0))
    out = svc.strategy_info(1, at(10, 7))
    assert out["chosen_by"] == "default" and out["label"] == STRATEGY_LABEL[out["current"]]
    assert out["chosen_by_label"] == "기본 방식" and out["compare"] == [] and out["compare_months"] is None


def test_strategy_info_미리_읽은_context를_쓴다(catalog, priors, params):
    svc = _service(catalog, priors, params)
    context = svc.store.context(1, at(10, 7))
    svc.store.context = lambda *a: (_ for _ in ()).throw(AssertionError("다시 읽음"))
    assert svc.strategy_info(1, at(10, 7), context)["chosen_by"] in (
        "monthly", "insufficient_history", "default", "user_confirmed")


def test_strategy_info_월간_맞춤_비교는_혜택_큰_순(catalog, priors, params):
    svc = _service(catalog, priors, params)
    svc.monthly_strategy = lambda *a: {"strategy": "value", "status": "ready", "months": 3,
                                       "scores": {"first_tier": 10_000.4, "value": 25_000.6, "main_top": 18_000}}
    out = svc.strategy_info(1, at(10, 7))
    assert out["chosen_by"] == "monthly" and out["label"] == "가치 최대" and out["compare_months"] == 3
    assert out["compare"] == [{"method": "value", "label": "가치 최대", "benefit": 25_001},
                              {"method": "main_top", "label": "주력 카드 우선", "benefit": 18_000},
                              {"method": "first_tier", "label": "첫 구간 우선", "benefit": 10_000}]


def test_reason_group():
    assert reason_group("RULE") == "사용자 규칙"
    assert reason_group("PROMOTION") == "프로모션" and reason_group("PROMOTION_CARD") == "프로모션"
    assert reason_group("PERFORMANCE") == reason_group("HOLD") == reason_group("BASE_CHANGED") == "실적 채우기"
    assert reason_group("TIME_BENEFIT") == "혜택 비교"


# ---------- SOL페이 효과 (지난달) ----------

def _warm(catalog, params, per_card):
    """9월 실적만 넣고 10월로 넘기지 않은 상태를 만드는 start (replay_month 가 10월로 넘긴다)."""
    def start():
        s = UserState(User(1), USER_CARDS, catalog, params)
        for uc, amount in per_card.items():
            s.apply(online(uc, amount, at(9, 15)))
        return s
    return start


def _no_promo(card, p):
    return 0


def test_replay_month_같은_카드면_차이_0(catalog, params):
    payments = [pay(101, 10_000, "CAFE", at(10, 5)), online(101, 50_000, at(10, 6)), pay(101, 10_000, "CAFE", at(10, 8))]
    out = replay_month(_warm(catalog, params, {101: 320_000}), payments, lambda view, p: (p.user_card_id, "TIME_BENEFIT"),
                       lambda card, p: 300, catalog, "2026-10")
    assert out["month"] == "2026-10" and out["placement_payments"] == 2 and out["changed_payments"] == 0
    assert out["actual"] == out["recommended"] == {"card": 2_000, "promotion": 600, "next_month": 0}
    assert out["diff"] == {"card": 0, "promotion": 0, "next_month": 0, "total": 0}
    assert out["top_changes"] == [] and out["tier_changes"] == []


def test_replay_month_덜_받으면_음수와_이유(catalog, params):
    payments = [pay(101, 10_000, "CAFE", at(10, 5))]
    out = replay_month(_warm(catalog, params, {101: 320_000}), payments, lambda view, p: (102, "PERFORMANCE"),
                       _no_promo, catalog, "2026-10")
    assert out["changed_payments"] == 1
    assert out["actual"]["card"] == 1_000 and out["recommended"]["card"] == 0
    assert out["diff"]["card"] == -1_000
    assert out["diff"]["total"] == out["diff"]["card"] + out["diff"]["promotion"] + out["diff"]["next_month"] == -1_000
    assert out["top_changes"][0] == {"day": "2026-10-05", "category": "카페", "amount": 10_000,
                                     "actual_card": catalog.card_label(1), "recommended_card": catalog.card_label(2),
                                     "diff": -1_000, "why": "실적 채우기"}


def test_replay_month_온라인_결제는_바꾸지_않는다(catalog, params):
    seen = []

    def choose(view, p):
        assert p.is_placement, "온라인 결제로 choose 를 불렀다"
        seen.append(view.ledger[101].perf)
        return 102, "TIME_BENEFIT"

    def promo(card, p):
        assert p.is_placement, "온라인 결제로 promo 를 불렀다"
        return 0

    payments = [online(101, 300_000, at(10, 2), synced_at=at(10, 6)),     # 6일에야 엔진이 안다
                pay(101, 10_000, "CAFE", at(10, 5)), pay(101, 10_000, "CAFE", at(10, 8))]
    out = replay_month(_warm(catalog, params, {101: 320_000}), payments, choose, promo, catalog, "2026-10")
    assert seen == [0, 300_000]          # 5일엔 9월 실적이 아니라 10월 0원, 8일엔 동기화된 온라인 결제가 보인다
    assert out["placement_payments"] == 2 and out["changed_payments"] == 2
    assert out["tier_changes"] == []     # 온라인 30만 원은 추천에서도 101 에 남아 30만 구간이 같다
    assert out["actual"] == {"card": 2_000, "promotion": 0, "next_month": 2_000}
    assert out["recommended"] == {"card": 0, "promotion": 0, "next_month": 0}


def test_replay_month_결제화면_결제가_없으면_None(catalog, params):
    def choose(view, p):
        raise AssertionError("choose 를 불렀다")
    start = _warm(catalog, params, {101: 320_000})
    assert replay_month(start, [online(101, 10_000, at(10, 3))], choose, _no_promo, catalog, "2026-10") is None
    assert replay_month(start, [], choose, _no_promo, catalog, "2026-10") is None


def test_replay_month_구간이_달라진_카드(catalog, params):
    payments = [pay(101, 110_000, "TRANSIT", at(10, 5), merchant=20), pay(101, 110_000, "TRANSIT", at(10, 9), merchant=20)]
    out = replay_month(_warm(catalog, params, {101: 320_000}), payments, lambda view, p: (103, "PERFORMANCE"),
                       lambda card, p: 500 if card == 103 else 0, catalog, "2026-10")
    assert out["tier_changes"] == [{"card": catalog.card_label(3), "first_tier": 200_000, "actual_perf": 0,
                                    "recommended_perf": 220_000, "actual_tier": None, "recommended_tier": 200_000}]
    # 10월 카드 혜택은 같고, 103 프로모션 500원 × 2, 11월 교통 5% (한도 5천)
    assert out["diff"] == {"card": 0, "promotion": 1_000, "next_month": 5_000, "total": 6_000}
    assert [c["diff"] for c in out["top_changes"]] == [500, 500]     # 결제별 차이 = 카드 혜택 + 프로모션
    assert [c["day"] for c in out["top_changes"]] == ["2026-10-05", "2026-10-09"]


def test_replay_month_이유는_차이_큰_순_3건(catalog, params):
    start = _warm(catalog, params, {101: 320_000, 102: 320_000})
    to_102 = lambda view, p: (102, "TIME_BENEFIT")
    cafe = lambda amount, day: pay(101, amount, "CAFE", at(10, day))
    rest = lambda amount, day: pay(101, amount, "REST", at(10, day), merchant=11)

    more = replay_month(start, [rest(20_000, 3), cafe(10_000, 4), rest(30_000, 5)], to_102, _no_promo, catalog, "2026-10")
    assert more["diff"]["total"] == 4_000
    assert [c["diff"] for c in more["top_changes"]] == [3_000, 2_000, -1_000]     # 더 받은 결제 먼저

    less = replay_month(start, [cafe(10_000, 3), cafe(30_000, 4), rest(20_000, 5), cafe(20_000, 6)], to_102, _no_promo,
                        catalog, "2026-10")
    assert less["diff"]["total"] == -4_000
    assert [c["diff"] for c in less["top_changes"]] == [-3_000, -2_000, -1_000]   # 덜 받은 결제 먼저, 3건만
    assert [c["category"] for c in less["top_changes"]] == ["카페"] * 3


# ---------- 서비스·API·캐시 (월간 리포트) ----------
import csv
import json
import os
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from engine.api import create_app
from engine.domain import Promotion
from engine.loader import ARTIFACTS
from engine.team_db import team_db_dir
from tests.conftest import KST
from tests.test_service_api import FakeStore

SEP_OCT = (datetime(2026, 9, 1, tzinfo=KST), datetime(2026, 10, 31, 23, 59, tzinfo=KST))


class ReportStore(FakeStore):
    """8월 실적(9월 혜택용) → 9월: 결제화면 2건 + 온라인, 10월: 온라인 + 결제화면 1건. 9~10월 카페 행사 500원(신한)."""

    def __init__(self):
        super().__init__(User(1))
        self.payments = [online(uc, 320_000, at(8, 15)) for uc in (101, 102)]
        self.payments += [pay(101, 10_000, "CAFE", at(9, 5)), pay(102, 20_000, "REST", at(9, 10), merchant=11)]
        self.payments += [online(uc, a, at(9, 15)) for uc, a in ((101, 600_000), (102, 400_000), (103, 300_000))]
        self.payments += [online(uc, a, at(10, 1)) for uc, a in ((101, 600_000), (102, 400_000), (103, 300_000))]
        self.payments += [pay(101, 10_000, "CAFE", at(10, 3))]
        self.promotions = [Promotion(1, "카페", *SEP_OCT, frozenset({10}), issuer="SHINHAN", amount=500, title="카페 500원")]


@pytest.fixture
def report_svc(catalog, priors, params):
    from engine.service import PlacementEngine, PlacementService
    return PlacementService(ReportStore(), PlacementEngine(catalog, priors, params))


def test_monthly_report_형식과_캐시(report_svc):
    first = report_svc.monthly_report(1, at(10, 7))
    assert {"user_id", "at", "month", "prev_month", "cached", "summary", "copy_source", "copy_log", "totals",
            "cards", "strategy", "solpay_effect", "effect_note"} <= set(first)
    assert (first["user_id"], first["month"], first["prev_month"]) == (1, "2026-10", "2026-09")
    assert first["at"] == at(10, 7).isoformat()
    assert first["copy_source"] == "template" and first["cached"] is False
    assert first["summary"]["headline"] == "9월에 카드 혜택 3,000원을 받았어요." and first["summary"]["points"]

    cards = {c["user_card_id"]: c for c in first["cards"]}
    assert (cards[101]["this_month"]["perf"], cards[101]["this_month"]["benefit"]) == (610_000, 1_000)
    assert (cards[101]["prev_month"]["perf"], cards[101]["prev_month"]["benefit"]) == (610_000, 1_000)
    assert (cards[102]["prev_month"]["perf"], cards[102]["prev_month"]["benefit"]) == (420_000, 2_000)
    assert first["totals"] == {"this_month_benefit": 1_000, "prev_month_benefit": 3_000}

    st = first["strategy"]
    assert {"current", "label", "description", "chosen_by", "chosen_by_label", "compare_months", "compare",
            "base_card", "current_order", "message"} <= set(st)
    assert st["current_order"][0]["rank"] == 1 and st["current_order"][0]["name"] in {c["name"] for c in first["cards"]}
    assert isinstance(st["message"], str) and st["message"]
    base = cards[st["base_card"]["user_card_id"]]           # 구간 칸은 그 카드의 this_month_tiers 그대로 (구간 지키기 문구와 같은 기준)
    tier_keys = ("tier_min", "remaining_to_keep", "next_tier", "remaining_to_next")
    assert st["base_card"] == {"user_card_id": base["user_card_id"], "name": base["name"],
                               **{k: base["this_month"][k] for k in tier_keys}}
    assert set(st["base_card"]) == {"user_card_id", "name", *tier_keys}

    ef = first["solpay_effect"]
    assert ef["month"] == "2026-09" and ef["placement_payments"] == 2 and first["effect_note"] is None
    assert ef["actual"]["promotion"] == 500                    # 9/5 카페를 신한카드(101)로 냈다
    d = ef["diff"]
    assert d["total"] == d["card"] + d["promotion"] + d["next_month"]
    assert "promotion" not in json.dumps(first["cards"])        # 카드별 프로모션은 주지 않는다

    second = report_svc.monthly_report(1, at(10, 7, 20))
    assert second["cached"] is True and {**second, "cached": False} == first


def test_monthly_report_지난달에_끝난_행사도_효과에_넣는다(report_svc):
    # 9월에만 진행하고 끝난 행사: 10월 7일의 context 에는 없지만 지난달 효과에는 들어가야 한다
    sept_only = (datetime(2026, 9, 1, tzinfo=KST), datetime(2026, 9, 30, 23, 59, tzinfo=KST))
    report_svc.store.promotions = [Promotion(2, "카페", *sept_only, frozenset({10}), issuer="SHINHAN", amount=700,
                                             title="9월 카페 700원")]
    assert report_svc.store.context(1, at(10, 7)).promotions == []
    ef = report_svc.monthly_report(1, at(10, 7))["solpay_effect"]
    assert ef["actual"]["promotion"] == 700                    # 9/5 카페를 신한카드(101)로 냈다


def test_monthly_report_월초_0시(report_svc):
    r = report_svc.monthly_report(1, datetime(2026, 10, 1, 0, 0, tzinfo=KST))
    assert (r["month"], r["prev_month"]) == ("2026-10", "2026-09")
    assert all(c["this_month"]["perf"] == 0 and c["this_month"]["payments"] == 0 for c in r["cards"])
    assert {c["user_card_id"]: c["prev_month"]["perf"] for c in r["cards"]} == {101: 610_000, 102: 420_000, 103: 300_000}
    assert r["totals"] == {"this_month_benefit": 0, "prev_month_benefit": 3_000}


def test_monthly_report_지난달_결제화면_결제가_없으면_효과_없음(catalog, priors, params):
    svc = _service(catalog, priors, params)          # 9월 결제가 온라인뿐
    r = svc.monthly_report(1, at(10, 7))
    assert r["solpay_effect"] is None and r["effect_note"] == "지난달 결제화면 결제가 없어 비교하지 않았어요"
    assert r["summary"]["headline"] and r["copy_source"] == "template"


def test_monthly_report_문구_작성기는_하루_한_번(report_svc):
    seen = []

    class Writer:
        def write(self, facts):
            seen.append(facts)
            return {"headline": "요약", "points": ["한 줄"]}, "llm", {"ms": 3}

    first = report_svc.monthly_report(1, at(10, 7), Writer())
    again = report_svc.monthly_report(1, at(10, 7, 22), Writer())
    assert first["summary"] == {"headline": "요약", "points": ["한 줄"]} and first["copy_source"] == "llm"
    assert again["cached"] is True and len(seen) == 1
    assert "user_id" not in json.dumps(seen[0], ensure_ascii=False)
    report_svc.monthly_report(1, at(10, 8), Writer())               # 날짜가 바뀌면 다시 계산
    assert len(seen) == 2


def test_api_404_와_응답(report_svc):
    with TestClient(create_app(report_svc, chat_client=None)) as c:
        missing = c.get("/internal/users/2/monthly-report", params={"at": at(10, 7).isoformat()})
        r = c.get("/internal/users/1/monthly-report", params={"at": at(10, 7).isoformat()})
        again = c.get("/internal/users/1/monthly-report", params={"at": at(10, 7, 15).isoformat()})
        dev = c.get("/dev")
    assert missing.status_code == 404
    body = r.json()
    assert r.status_code == 200 and body["month"] == "2026-10" and isinstance(body["cards"], list)
    assert body["copy_source"] == "template" and body["copy_log"]["reason"] == "no_api_key"     # 앱의 작성기 (키 없음)
    assert isinstance(body["summary"]["headline"], str) and again.json()["cached"] is True
    assert dev.status_code == 200 and "monthly-report" in dev.text and "월간 리포트 보기" in dev.text


# ---------- 팀 DB CSV (없으면 건너뜀) ----------

@pytest.fixture(scope="module")
def service(tmp_path_factory):
    if not (team_db_dir() / "payments.csv").exists() or not (ARTIFACTS / "priors.json").exists():
        pytest.skip("팀 DB CSV 또는 artifacts 가 없습니다")
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_STRATEGY_DB"] = str(tmp_path_factory.mktemp("report") / "strategy.sqlite")
    from engine.api import build_service
    return build_service()


def test_팀DB_1번_10월_숫자가_card_month_status_와_같다(service):
    service.store.reset()
    report = service.monthly_report(1, datetime(2026, 11, 5, 12, 0, tzinfo=KST))
    with open(team_db_dir() / "card_month_status.csv", encoding="utf-8") as f:
        want = {int(r["user_card_id"]): (int(r["perf"]), int(r["benefit_amount"]))
                for r in csv.DictReader(f) if r["year_month"] == "2026-10"}
    got = {c["user_card_id"]: (c["prev_month"]["perf"], c["prev_month"]["benefit"]) for c in report["cards"]}
    assert len(got) == 3 and got == {uc: want[uc] for uc in got}
    assert got[1] == (1_542_790, 43_220)                             # 신한카드 Discount Plan+
    assert report["prev_month"] == "2026-10" and report["solpay_effect"]["month"] == "2026-10"
    assert report["totals"]["prev_month_benefit"] == sum(v[1] for v in got.values())
