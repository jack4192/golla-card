"""결제 흐름과 AI 연동 테스트. AI 엔진은 conftest 의 가짜 서버를 쓴다."""
import segno


def issue(client, card_id=2):
    r = client.post("/api/tokens", json={"card_id": card_id})
    assert r.status_code == 200, r.text
    return r.json()


def pay(client, token, amount=13000, merchant_id=75):
    r = client.post("/api/pos/approve", json={"token": token, "merchant_id": merchant_id, "amount": amount})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 토큰 보안 규칙 (예전 MVP 와 같음) ----------

def test_issue_returns_codes(env):
    client, _, _ = env
    t = issue(client)
    assert len(t["token"]) == 18 and t["token"].isdigit()
    assert t["barcode"].startswith("data:image/svg+xml") and t["qr"].startswith("data:image/svg+xml")
    assert client.get(f"/api/tokens/{t['token_id']}").json()["status"] == "ACTIVE"


def test_approve_once_then_reuse_declined(env):
    client, _, _ = env
    t = issue(client)
    first = pay(client, t["token"])
    assert first["result"] == "APPROVED" and len(first["approval_no"]) == 8
    assert "신한 외식 신용" in first["card"]
    second = pay(client, t["token"])
    assert second["result"] == "DECLINED" and "이미 사용" in second["reason"]


def test_expired_declined(env):
    client, clock, _ = env
    t = issue(client)
    clock["t"] += 61
    assert "유효시간" in pay(client, t["token"])["reason"]
    assert client.get(f"/api/tokens/{t['token_id']}").json()["status"] == "EXPIRED"


def test_random_and_malformed_declined(env):
    client, _, _ = env
    issue(client)
    assert "발급되지 않은" in pay(client, "123456789012345678")["reason"]
    assert "형식" in pay(client, "abc")["reason"]


def test_reissue_revokes_previous(env):
    client, _, _ = env
    old, new = issue(client), issue(client)
    assert "새 코드" in pay(client, old["token"])["reason"]
    assert pay(client, new["token"])["result"] == "APPROVED"


def test_invalid_amount_and_unknown_merchant(env):
    client, _, _ = env
    t = issue(client)
    assert client.post("/api/pos/approve", json={"token": t["token"], "merchant_id": 75, "amount": 0}).status_code == 422
    assert client.post("/api/pos/approve", json={"token": t["token"], "merchant_id": 999, "amount": 1000}).status_code == 422


def test_unknown_card_rejected(env):
    client, _, _ = env
    assert client.post("/api/tokens", json={"card_id": 999}).status_code == 404


def test_qr_is_standard_not_micro():
    assert not segno.make("123456789012345678", error="m", micro=False).is_micro


# ---------- AI 연동 ----------

def test_결제화면은_AI_순서와_문구를_따른다(env):
    client, _, fake = env
    me = client.get("/api/me").json()
    assert [c["user_card_id"] for c in me["cards"]] == [2, 1, 4]
    assert me["default_card_id"] == 2 and me["cards"][0]["shown"] and not me["cards"][1]["shown"]
    assert "10,000원 이상" in me["cards"][0]["message"]
    assert me["ai"]["ok"] and me["explanation"]["base_card_name"] == "신한 생활 신용"
    rank_call = [b for m, p, b in fake.calls if p == "/internal/rank"][-1]
    assert rank_call["at"] == me["at"] and rank_call["explain"] is True and "lat" not in rank_call


def test_오늘_일정을_저장하면_엔진에_시간_업종_금액만_보낸다(env):
    client, _, fake = env
    day = client.get("/api/demo/state").json()["demo_at"][:10]
    r = client.put("/api/schedule", json={"items": [{"start": "12:00", "end": "14:00", "category": "PET",
                                                     "amount": 300000}]})
    assert r.status_code == 200 and r.json()["items"][0]["category_name"] == "동물병원"
    method, path, body = [c for c in fake.calls if c[1].startswith("/internal/users/1/schedules/")][-1]
    assert method == "PUT" and path.endswith(day)
    assert body == {"items": [{"start": "12:00", "end": "14:00", "category": "PET", "amount": 300000}]}
    me = client.get("/api/me").json()
    assert me["version"] == "schedule" and me["mode_label"] == "오늘 일정에 맞춤"
    assert me["schedule"][0]["start"] == "12:00" and "location" not in me and "chips" not in me


def test_일정_입력이_잘못되면_422로_알려준다(env):
    client, _, _ = env
    bad_time = client.put("/api/schedule", json={"items": [{"start": "14:00", "end": "12:00", "category": "CAFE", "amount": 5000}]})
    assert bad_time.status_code == 422 and "끝 시각" in bad_time.json()["detail"]
    assert client.put("/api/schedule", json={"items": [{"start": "12:00", "end": "13:00", "category": "TRANSIT",
                                                        "amount": 1500}]}).status_code == 422      # 고를 수 없는 업종
    assert client.put("/api/schedule", json={"items": [{"start": "12:00", "end": "13:00", "category": "CAFE",
                                                        "amount": 0}]}).status_code == 422
    too_many = [{"start": "12:00", "end": "13:00", "category": "CAFE", "amount": 5000}] * 11
    assert client.put("/api/schedule", json={"items": too_many}).status_code == 422


def test_일정_없음이면_지우고_패턴으로_정한다(env):
    client, _, fake = env
    client.put("/api/schedule", json={"items": [{"start": "12:00", "end": "14:00", "category": "CAFE", "amount": 5000}]})
    assert client.put("/api/schedule", json={"items": []}).json()["items"] == []
    me = client.get("/api/me").json()
    assert me["version"] == "pattern" and me["schedule"] == []


def test_특수_고액_일정이면_새_카드를_추천하고_다시는_추천하지_않는다(env):
    client, _, _ = env
    assert client.post("/api/card-recommendation").json() == {"recommend": False}
    client.put("/api/schedule", json={"items": [{"start": "12:00", "end": "14:00", "category": "PET",
                                                 "amount": 300000}]})
    rec = client.post("/api/card-recommendation").json()
    assert rec["recommend"] and rec["card_name"] == "신한 펫 카드" and rec["trigger"] == "schedule"
    assert client.post("/api/card-recommendation").json()["recommend"] is False


def test_AI가_꺼져_있으면_추천을_건너뛴다(env):
    client, _, fake = env
    fake.down = True
    rec = client.post("/api/card-recommendation").json()
    assert rec["recommend"] is False and "꺼져" in rec["error"]
    assert client.put("/api/schedule", json={"items": []}).status_code == 503


def test_연말_결산_미리보기(env):
    client, _, _ = env
    r = client.get("/api/missed-benefit").json()
    assert r["cards"][0]["gain"] == 52000 and r["cards"][0]["months"] == 10


def test_사용자를_바꿀_수_있다(env):
    client, _, _ = env
    st = client.put("/api/demo/state", json={"user_id": 2}).json()
    assert st["user_id"] == 2 and set(st) == {"id", "user_id", "demo_at"}
    assert client.put("/api/demo/state", json={"user_id": 99}).status_code == 404


def test_승인되면_혜택을_계산하고_결제를_AI에_보낸다(env):
    client, _, fake = env
    t = issue(client, 1)                         # AI 2순위 카드로 결제
    r = pay(client, t["token"], amount=13000)
    assert r["benefit"] == 0 and r["best_card"] == "신한 외식 신용" and r["best_benefit"] == 1300
    paths = [p for m, p, b in fake.calls]
    assert paths.index("/internal/payments/evaluate") < paths.index("/internal/payments")   # 반영 전 상태로 계산
    sent = fake.payments[-1]
    assert sent["user_card_id"] == 1 and sent["category_code"] == "RESTAURANT" and sent["card_select_mode"] == "manual"
    assert sent["paid_at"] == client.get("/api/demo/state").json()["demo_at"]
    tx = client.get(f"/api/tokens/{t['token_id']}").json()["transaction"]
    assert tx["benefit"] == 0 and tx["best_benefit"] == 1300 and tx["ai_rank"] == 2 and tx["ai_synced"] == 1
    row = client.get("/api/transactions").json()[0]
    assert row["card_name"] == "신한 생활 신용" and row["best_card"] == "신한 외식 신용"


def test_AI가_꺼지면_기본_순서로_보여주고_결제는_된다(env):
    client, _, fake = env
    fake.down = True
    me = client.get("/api/me").json()
    assert not me["ai"]["ok"] and me["scenario_mode"] == "fallback"
    assert [c["user_card_id"] for c in me["cards"]] == [1, 2, 4]
    t = issue(client, 1)
    r = pay(client, t["token"])
    assert r["result"] == "APPROVED" and r["benefit"] is None and r["ai_synced"] == 0


def test_AI를_한_번도_못_부르면_안내한다(tmp_path, monkeypatch):
    import importlib

    import httpx
    from fastapi.testclient import TestClient
    monkeypatch.setenv("SOLPAY_DB", str(tmp_path / "x.db"))
    from app import ai, db, main
    importlib.reload(db)
    importlib.reload(main)

    def down(request):
        raise httpx.ConnectError("꺼짐", request=request)
    ai.use_client(httpx.Client(base_url="http://ai", transport=httpx.MockTransport(down)))
    with TestClient(main.app) as client:
        r = client.get("/api/me")
    ai.use_client(None)
    assert r.status_code == 503 and "solpay-ai" in r.json()["detail"]


def test_규칙을_만들어_AI에_저장한다(env):
    client, _, fake = env
    client.put("/api/demo/state", json={"demo_at": "2026-11-09T08:10:00+09:00"})     # 월요일 08시
    rules = client.post("/api/rules", json={"kind": "force_now", "user_card_id": 4}).json()
    assert rules[0]["condition"] == {"days": ["mon"], "hours": [8, 9]}
    assert rules[0]["target"] == {"user_card_ids": [4]} and "월요일 8시대" in rules[0]["source_text"]
    client.post("/api/rules", json={"kind": "order_top"})
    assert [r["rule_type"] for r in fake.rules] == ["force", "order"]
    client.delete("/api/rules/0")
    assert [r["rule_type"] for r in fake.rules] == ["order"]
    assert client.post("/api/rules", json={"kind": "exclude"}).status_code == 422


def test_시연_초기화(env):
    client, _, fake = env
    t = issue(client)
    pay(client, t["token"])
    assert client.post("/api/demo/reset").json() == {"reset": True}
    assert client.get("/api/transactions").json() == [] and fake.payments == []


def test_카페_일정을_저장하면_팝업이_프로모션과_신한카드를_알려준다(env):
    client, _, _ = env
    assert client.post("/api/schedule-popup").json()["kind"] == "none"
    client.put("/api/schedule", json={"items": [{"start": "14:00", "end": "15:00", "category": "CAFE", "amount": 6000}]})
    popup = client.post("/api/schedule-popup").json()
    assert popup["kind"] == "promotion"
    offer = popup["offers"][0]
    assert (offer["brand"], offer["card_name"], offer["total"]) == ("메가MGC커피", "신한 생활 신용", 1100)
    assert offer["window"] == "13:30~15:30"


def test_AI가_꺼져_있으면_팝업을_건너뛴다(env):
    client, _, fake = env
    fake.down = True
    popup = client.post("/api/schedule-popup").json()
    assert popup["kind"] == "none" and "꺼져" in popup["error"]


def test_결제_화면에_이번_달_실적_채우기_방식을_보여준다(env):
    client, _, _ = env
    me = client.get("/api/me").json()
    assert me["strategy"] == {"code": "main_top", "label": "② 주력 카드의 높은 구간부터"}
