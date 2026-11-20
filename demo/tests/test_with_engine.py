"""실제 AI 엔진(solpay-ai)과 끝까지 돌려 보는 테스트.

solpay-ai 폴더를 SOLPAY_AI_DIR 로 알려 주고 그 가상환경에서 실행한다 (README 참고). 없으면 건너뛴다.
"""
import importlib
import os
import sys
from pathlib import Path

import pytest

AI_DIR = os.environ.get("SOLPAY_AI_DIR")
pytestmark = pytest.mark.skipif(not AI_DIR, reason="SOLPAY_AI_DIR 이 없습니다")


@pytest.fixture()
def both(tmp_path, monkeypatch):
    sys.path.insert(0, AI_DIR)
    from fastapi.testclient import TestClient
    from engine import loader
    from engine.api import create_app
    from engine.params import Params
    from engine.service import PlacementEngine, PlacementService
    from engine.store import ParquetStore
    from training.build_priors import priors_from_frame
    store = ParquetStore()
    engine = PlacementEngine(store.load_catalog(), priors_from_frame(loader.read_payments(), Params()))
    ai_client = TestClient(create_app(PlacementService(store, engine)))
    ai_client.__enter__()

    monkeypatch.setenv("SOLPAY_DB", str(tmp_path / "e2e.db"))
    from app import ai, db, main
    importlib.reload(db)
    importlib.reload(main)
    main._merchants.clear(); main._cards.clear(); main._last_order.clear()
    ai.use_client(ai_client)
    with TestClient(main.app) as client:
        yield client, store
    ai.use_client(None)
    ai_client.__exit__(None, None, None)


def test_실제_엔진으로_추천하고_결제하면_실적이_쌓인다(both):
    client, store = both
    client.put("/api/demo/state", json={"user_id": 1, "demo_at": "2026-11-05T12:20:00+09:00"})
    gangnam = client.get("/api/demo/options").json()["merchants"]["GANGNAM"]
    rest = next(m for m in gangnam if m["category_code"] == "RESTAURANT")
    me = client.get("/api/me").json()
    assert me["ai"]["ok"] and me["version"] == "pattern" and len(me["cards"]) == 3          # 최종 카드 DB test1 카드 3장
    first = me["default_card_id"]
    before = {c["user_card_id"]: c["status"]["perf"] for c in me["cards"]}

    token = client.post("/api/tokens", json={"card_id": first}).json()
    r = client.post("/api/pos/approve", json={"token": token["token"], "merchant_id": rest["merchant_id"], "amount": 15000}).json()
    assert r["result"] == "APPROVED" and r["ai_synced"] == 1 and r["benefit"] is not None
    after = {c["user_card_id"]: c["status"]["perf"] for c in client.get("/api/me").json()["cards"]}
    assert after[first] - before[first] == 15000


def test_실제_엔진으로_일정을_넣으면_일정_기준으로_바뀌고_초기화하면_지워진다(both):
    client, store = both
    client.put("/api/demo/state", json={"user_id": 3, "demo_at": "2026-11-05T08:00:00+09:00"})
    saved = client.put("/api/schedule", json={"items": [{"start": "08:00", "end": "09:00", "category": "PET",
                                                         "amount": 300000}]})
    assert saved.status_code == 200, saved.text
    me = client.get("/api/me").json()
    assert me["version"] == "schedule" and me["scenario_mode"] == "schedule"
    assert me["explanation"]["scenarios"][0]["category"] == "PET"
    rec = client.post("/api/card-recommendation").json()
    assert set(rec) >= {"recommend"}
    if rec["recommend"]:
        assert rec["gain"] >= 3000 and rec["card_name"]
    missed = client.get("/api/missed-benefit").json()["cards"]
    assert all(m["gain"] > 0 for m in missed)
    client.post("/api/demo/reset")
    client.put("/api/demo/state", json={"user_id": 3, "demo_at": "2026-11-05T08:00:00+09:00"})
    assert client.get("/api/me").json()["version"] == "pattern"
