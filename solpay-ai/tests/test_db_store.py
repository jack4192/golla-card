"""로컬 개인 DB 저장소 (engine/db_store.py, 2026-11-19).

테스트 전용 DB(solpay_test, `uv run python -m scripts.setup_local_db --db solpay_test`)에서 돈다. 개인 DB 는 건드리지 않는다.
DB 가 꺼져 있으면 건너뛴다 (저장소 루트에서 `docker compose up -d db`).
"""

import json
from datetime import date, datetime, time
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from engine.domain import Payment, RankRequest, ScheduleItem
from engine.settings import database_url

KST = ZoneInfo("Asia/Seoul")
AT = datetime(2026, 11, 5, 12, 20, tzinfo=KST)
TEST_DB = "solpay_test"


@pytest.fixture(scope="module")
def db():
    import psycopg
    from engine.db_store import AppSchemaMissing, TeamDbPgStore
    url = database_url(TEST_DB)
    if not url:
        pytest.skip("DB 계정이 없습니다 (루트 .env)")
    try:
        store = TeamDbPgStore(url)
    except (psycopg.OperationalError, AppSchemaMissing) as e:
        pytest.skip(f"테스트 DB 를 쓸 수 없습니다: {e}")
    store.load_catalog()
    store.reset()
    yield store
    store.reset()


@pytest.fixture(scope="module")
def csv_store():
    from engine.team_db import TeamDbStore, team_db_dir
    if not (team_db_dir() / "payments.csv").exists():
        pytest.skip("팀 DB CSV 가 없습니다")
    store = TeamDbStore()
    store.load_catalog()
    return store


@pytest.fixture(scope="module")
def service(db):
    from engine.category_model import CategoryModel
    from engine.loader import ARTIFACTS
    from engine.params import Params
    from engine.priors import Priors
    from engine.service import PlacementEngine, PlacementService
    return PlacementService(db, PlacementEngine(db.catalog, Priors.load(ARTIFACTS / "priors.json"), Params(),
                                                CategoryModel.load(ARTIFACTS)))


def test_db_reads_the_same_as_csv(db, csv_store):
    assert db.catalog.cards == csv_store.catalog.cards
    assert db.catalog.merchants == csv_store.catalog.merchants
    assert db.merchant_key == csv_store.data.merchant_key
    assert db.benefit_start == "2025-12"
    key = lambda p: (p.promotion_id, p.amount, p.rate, p.min_amount, p.max_amount, p.starts_at, p.ends_at, p.merchant_ids)
    assert sorted(map(key, db.promotions)) == sorted(map(key, csv_store.promotions))
    for user_id in (1, 2, 3, 4, 5, 100, 365):
        a, b = csv_store.context(user_id, AT), db.context(user_id, AT)
        assert a.cards == b.cards and a.payments == b.payments, user_id


def test_rules_drafts_and_recommendations_are_written_to_app_schema(db, service):
    db.reset()
    rule = {"rule_type": "force", "condition": {"days": ["weekend"]}, "target": {"user_card_ids": [3]},
            "source_text": "주말엔 KB 먼저"}
    draft_id = db.save_draft(1, "s1", rule, "주말에는 KB ALL 카드를 먼저 보여 드려요")
    assert db.draft(draft_id)["status"] == "pending"
    rule_id = db.add_rule(1, rule)
    db.decide_draft(draft_id, "saved")
    assert db.draft(draft_id)["status"] == "saved"
    assert db.raw_rules(1) == [{**rule, "rule_id": rule_id}]
    saturday = datetime(2026, 11, 7, 12, 0, tzinfo=KST)
    rid, result = service.rank(RankRequest(1, saturday))
    assert result.rule_applied == rule_id and result.cards[0].user_card_id == 3
    record = db.recommendation(1, rid)
    assert record["ranking"][0] == 3 and db.recommendation(2, rid) is None      # 다른 사용자 기록은 못 읽는다
    db.save_rules(1, [])                                                         # 통째로 바꾸기 (지난 규칙은 비활성)
    assert db.raw_rules(1) == []


def test_schedules_are_encrypted_and_demo_payments_join_history(db):
    db.reset()
    day = AT.date()
    item = ScheduleItem(1, 1, datetime.combine(day, time(12), KST), datetime.combine(day, time(13), KST), "CAFE", 6000)
    db.put_schedule(1, day, [item])
    with db._connect() as c:
        raw = bytes(c.execute("select payload from app.schedules where user_id = 1").fetchone()["payload"])
    assert b"CAFE" not in raw                                                    # 암호문으로만 저장
    assert [s.category for s in db.schedules(1, day)] == ["CAFE"]
    before = len(db.context(1, AT).payments)
    db.add_payment(Payment(9_000_001, 1, 1, None, "CAFE", "offline_qr", "app_selected", 4500, AT, AT))
    db.add_payment(Payment(9_000_001, 1, 1, None, "CAFE", "offline_qr", "app_selected", 4500, AT, AT))   # 같은 번호는 한 번
    assert len(db.context(1, AT).payments) == before + 1
    db.reset()
    assert len(db.context(1, AT).payments) == before and db.schedules(1, day) == []


def test_strategy_selection_is_stored(db):
    db.reset()
    s = db.strategy_store
    assert s.get(1) is None
    assert s.initialize(1, "main_top", {"why": "test"})["source"] == "initial"
    assert s.initialize(1, "value")["strategy"] == "main_top"                    # 최초 선택은 한 번만
    assert s.confirm_change(1, "none")["source"] == "confirmed"
    with pytest.raises(ValueError):
        s.confirm_change(1, "nope")


def _tool_call(name, args):
    return SimpleNamespace(id="call_1", function=SimpleNamespace(name=name, arguments=json.dumps(args, ensure_ascii=False)))


def test_chat_draft_confirm_flow_through_api(db, service):
    from fastapi.testclient import TestClient
    from engine.api import create_app
    db.reset()
    script = [[_tool_call("draft_rule", {"rule_type": "no_fill", "card_names": ["SOL트래블"],
                                         "source_text": "SOL트래블은 실적 안 채워도 돼"})],
              "SOL트래블 체크는 실적을 채우지 않고 건당 혜택만 보도록 초안을 만들었어요. 아래 카드에서 저장을 누르면 적용돼요."]
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=lambda **kw: (lambda step: SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=None if isinstance(step, list) else step,
                                                             tool_calls=step if isinstance(step, list) else None))],
            usage=None))(script.pop(0)))))
    with TestClient(create_app(service, chat_client=client)) as http:
        body = http.post("/internal/chat", json={"user_id": 1, "session_id": "s1", "message": "SOL트래블은 실적 안 채워도 돼",
                                                 "at": AT.isoformat()}).json()
        draft_id = body["rule_draft"]["draft_id"]
        assert [b.get("draft_id") for b in body["blocks"] if b["type"] == "rule_card"] == [draft_id]
        assert db.draft(draft_id)["status"] == "pending" and db.raw_rules(1) == []
        assert http.post(f"/internal/rules/drafts/{draft_id}/confirm", json={"user_id": 2}).status_code == 404
        ok = http.post(f"/internal/rules/drafts/{draft_id}/confirm", json={"user_id": 1})
        assert ok.status_code == 200 and ok.json()["saved"] is True
        assert db.raw_rules(1)[0]["rule_type"] == "no_fill"
        assert http.post(f"/internal/rules/drafts/{draft_id}/confirm", json={"user_id": 1}).status_code == 409
    db.reset()


def test_reset_is_refused_for_a_shared_db(db):
    from engine.db_store import TeamDbPgStore
    remote = TeamDbPgStore.__new__(TeamDbPgStore)
    remote.url = "postgresql://team:pw@team-db.example.com:5432/solpay"
    with pytest.raises(NotImplementedError):
        remote.reset()
