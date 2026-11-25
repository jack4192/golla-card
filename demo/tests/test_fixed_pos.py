"""가상 POS 를 SOL·Pay 백엔드 결제(/api/v1/pos/payments)에 잇는 부분 (2026-11-24 팀원 변경 보완).

- 백엔드 주소는 SOLPAY_BACKEND_URL (로컬 백엔드를 8090 으로 켜는 경우가 있어 8080 고정이면 승인이 엉뚱한 곳으로 간다).
- 단말기 키는 SOLPAY_FIXED_TERMINAL_KEYS(JSON) 가 먼저, 없으면 demo/data/terminal_keys.json (python -m app.terminals 가 만든다).
"""
import hashlib
import json

import httpx

from app import main, terminals


def backend(handler, seen):
    def record(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url), json.loads(request.content)))
        return handler(request)
    return httpx.MockTransport(record)


def approved(request):
    return httpx.Response(200, json={"approved": True, "approvalNo": "A0534800", "amount": 6500,
                                     "totalDiscount": 650, "paidAt": "2026-11-24T14:00:00"})


def test_backend_url_from_env(monkeypatch):
    monkeypatch.delenv("SOLPAY_BACKEND_URL", raising=False)
    assert main.fixed_pos_url() == "http://127.0.0.1:8080/api/v1/pos/payments"
    monkeypatch.setenv("SOLPAY_BACKEND_URL", "http://127.0.0.1:8090/")
    assert main.fixed_pos_url() == "http://127.0.0.1:8090/api/v1/pos/payments"


def test_approve_goes_to_backend_with_terminal_key(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("SOLPAY_BACKEND_URL", "http://127.0.0.1:8090")
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", json.dumps({"90": "key-90"}))
    seen = []
    monkeypatch.setattr(main, "_POS_TRANSPORT", backend(approved, seen))

    r = client.post("/api/pos/approve", json={"token": "PAYMATE:123456789012345678", "merchant_id": 90, "amount": 6500})

    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["result"], body["approval_no"], body["benefit"], body["amount"]) == ("APPROVED", "A0534800", 650, 6500)
    assert seen == [("http://127.0.0.1:8090/api/v1/pos/payments",
                     {"terminalKey": "key-90", "code": "PAYMATE:123456789012345678", "amount": 6500})]


def test_declined_reason_is_shown(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", json.dumps({"90": "key-90"}))
    monkeypatch.setattr(main, "_POS_TRANSPORT", backend(
        lambda request: httpx.Response(200, json={"approved": False, "declineReason": "ALREADY_USED"}), []))

    body = client.post("/api/pos/approve", json={"token": "123456789012345678", "merchant_id": 90, "amount": 6500}).json()

    assert body["result"] == "DECLINED" and body["reason"] == "이미 사용된 코드입니다."


def test_backend_down_is_503(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", json.dumps({"90": "key-90"}))

    def down(request):
        raise httpx.ConnectError("꺼짐", request=request)
    monkeypatch.setattr(main, "_POS_TRANSPORT", httpx.MockTransport(down))

    r = client.post("/api/pos/approve", json={"token": "123456789012345678", "merchant_id": 90, "amount": 6500})

    assert r.status_code == 503 and "연결할 수 없습니다" in r.json()["detail"]


def test_options_list_only_merchants_with_keys(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", json.dumps({"90": "key-90"}))

    opts = client.get("/api/demo/options").json()

    names = [m["name"] for group in opts["merchants"].values() for m in group]
    assert opts["uses_fixed_pos"] is True and names == ["메가커피 강남역점"]


def test_keys_from_file_when_env_is_empty(env, tmp_path, monkeypatch):
    client, _, _ = env
    path = tmp_path / "keys.json"
    path.write_text(json.dumps({"75": "key-75"}), encoding="utf-8")
    monkeypatch.setattr(terminals, "KEYS_FILE", path)

    opts = client.get("/api/demo/options").json()

    names = [m["name"] for group in opts["merchants"].values() for m in group]
    assert opts["uses_fixed_pos"] is True and names == ["강남 한식당"]


def test_bad_keys_json_is_a_clear_error(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", "{bad")

    r = client.get("/api/demo/options")

    assert r.status_code == 500 and "JSON" in r.json()["detail"]


def test_new_terminal_saves_key_and_gives_sql(tmp_path):
    path = tmp_path / "data" / "terminal_keys.json"

    key, sql = terminals.new_terminal(560, path)
    key2, _ = terminals.new_terminal(25, path)

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved == {"560": key, "25": key2} and key != key2 and len(key) == 32
    assert hashlib.sha256(key.encode()).hexdigest() in sql and "(560," in sql
    assert key not in sql                                   # 키 원문은 DB 에 넣지 않는다
    assert "setval(pg_get_serial_sequence('public.terminals', 'terminal_id')" in sql


# ---------- 시연용 만능 키 (2026-11-24 팀 결정: 아무 가맹점이나 골라 결제) ----------
DEMO_KEY = "demo-terminal-key-0123456789"


def merchant_names(opts):
    return [m["name"] for group in opts["merchants"].values() for m in group]


def test_demo_key_lists_every_merchant_even_with_per_merchant_keys(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("POS_DEMO_TERMINAL_KEY", DEMO_KEY)
    monkeypatch.setenv("SOLPAY_FIXED_TERMINAL_KEYS", json.dumps({"90": "key-90"}))   # 만능 키가 먼저

    opts = client.get("/api/demo/options").json()

    assert opts["uses_fixed_pos"] is True
    assert sorted(merchant_names(opts)) == ["강남 한식당", "메가커피 강남역점"]


def test_merchants_without_zone_are_grouped_by_category(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("POS_DEMO_TERMINAL_KEY", DEMO_KEY)
    main._merchants.clear()
    main._merchants.update({
        560: {"merchant_id": 560, "name": "스타벅스 강남역점", "category_code": "CAFE", "category_name": "카페", "zone": None},
        700: {"merchant_id": 700, "name": "CU 강남역점", "category_code": "CONVENIENCE", "category_name": "편의점", "zone": None},
    })

    groups = client.get("/api/demo/options").json()["merchants"]

    assert {k: [m["name"] for m in v] for k, v in groups.items()} == {"카페": ["스타벅스 강남역점"], "편의점": ["CU 강남역점"]}


def test_demo_key_sends_the_chosen_merchant(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("POS_DEMO_TERMINAL_KEY", DEMO_KEY)
    seen = []
    monkeypatch.setattr(main, "_POS_TRANSPORT", backend(approved, seen))

    body = client.post("/api/pos/approve", json={"token": "123456789012345678", "merchant_id": 75, "amount": 6500}).json()

    assert body["result"] == "APPROVED" and body["merchant"] == "강남 한식당"
    assert seen[0][1] == {"terminalKey": DEMO_KEY, "code": "123456789012345678", "amount": 6500, "merchantId": 75}


def test_short_demo_key_is_ignored(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("POS_DEMO_TERMINAL_KEY", "short-key")

    assert client.get("/api/demo/options").json()["uses_fixed_pos"] is False


def test_backend_refusals_have_clear_messages(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setenv("POS_DEMO_TERMINAL_KEY", DEMO_KEY)
    req = {"token": "123456789012345678", "merchant_id": 75, "amount": 6500}

    monkeypatch.setattr(main, "_POS_TRANSPORT", backend(lambda r: httpx.Response(403, json={"code": "INVALID_TERMINAL"}), []))
    assert "POS_DEMO_TERMINAL_KEY" in client.post("/api/pos/approve", json=req).json()["detail"]

    monkeypatch.setattr(main, "_POS_TRANSPORT", backend(lambda r: httpx.Response(404, json={"code": "MERCHANT_NOT_FOUND"}), []))
    assert "단말기가 없습니다" in client.post("/api/pos/approve", json=req).json()["detail"]
