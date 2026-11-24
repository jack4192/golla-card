"""가짜 AI 엔진. 실제 solpay-ai 와 같은 경로·응답 형식을 흉내 낸다."""
import importlib
import json

import httpx
import pytest
from fastapi.testclient import TestClient

CARDS = [
    {"user_card_id": 1, "card_id": 1, "name": "신한 생활 신용", "issuer": "SHINHAN", "display_order": 1, "excluded": False,
     "prev_perf": 600000, "perf": 120000, "tiers": [300000, 500000], "eligible_tier": 500000, "next_tier": 300000,
     "remaining": 180000, "benefit_this_month": 1200, "synced_note": False},
    {"user_card_id": 2, "card_id": 2, "name": "신한 외식 신용", "issuer": "SHINHAN", "display_order": 2, "excluded": False,
     "prev_perf": 350000, "perf": 50000, "tiers": [300000], "eligible_tier": 300000, "next_tier": 300000,
     "remaining": 250000, "benefit_this_month": 0, "synced_note": False},
    {"user_card_id": 4, "card_id": 8, "name": "KB국민 카페·뷰티 체크", "issuer": "KB", "display_order": 3, "excluded": False,
     "prev_perf": 0, "perf": 0, "tiers": [200000], "eligible_tier": None, "next_tier": 200000,
     "remaining": 200000, "benefit_this_month": 0, "synced_note": True},
]
MERCHANTS = [
    {"merchant_id": 75, "name": "강남 한식당", "category_code": "RESTAURANT", "category_name": "음식점/패스트푸드", "zone": "GANGNAM"},
    {"merchant_id": 90, "name": "메가커피 강남역점", "category_code": "CAFE", "category_name": "카페", "zone": "GANGNAM"},
]


CLASSIFY = {"category": "CAFE", "category_name": "카페/커피전문점", "brand": "스타벅스", "brand_name": "스타벅스",
            "source": "search", "candidates": [], "amount_hint": 6500, "ms": 3}
PAGE = {"source": "schedule", "card_day": True, "tabs": ["card", "merchant"], "copy_source": "template", "cached": False,
        "day": "2026-11-05",
        "card": {"card_id": 7, "card_name": "신한 카페 카드", "gain": 600, "show_amount": True, "keyword": "스타벅스 10% 할인",
                 "first_month_note": None, "copy": {"title": "스타벅스엔 이 카드", "summary": "오늘 스타벅스 일정에서 600원 더",
                                                    "amount_label": "오늘 600원 더", "reasons": ["스타벅스 10% 할인"]}},
        "merchant": {"copy": {"title": "오늘 일정 혜택", "summary": "스타벅스 행사"},
                     "offers": [{"item_id": 1, "start": "2026-11-05T14:00:00+09:00", "end": "2026-11-05T15:00:00+09:00",
                                 "category": "CAFE", "category_name": "카페/커피전문점", "amount": 6500, "promotion_id": 3,
                                 "brand": "스타벅스", "title": "스타벅스 신한 데이", "kind": "event", "user_card_id": 1,
                                 "card_id": 1, "card_name": "신한 생활 신용", "promo_value": 500, "card_value": 650,
                                 "total": 1150, "alternatives": [], "window_from": "2026-11-05T13:30:00+09:00",
                                 "window_to": "2026-11-05T15:30:00+09:00"}]}}


class FakeAI:
    def __init__(self):
        self.down = False
        self.calls = []
        self.payments = []
        self.rules = []
        self.schedules = {}
        self.recommended = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("AI 서버 꺼짐", request=request)
        path, method = request.url.path, request.method
        body = json.loads(request.content) if request.content else None
        self.calls.append((method, path, body))
        if path == "/internal/merchants":
            return httpx.Response(200, json=MERCHANTS)
        if path == "/internal/users/1/cards":
            return httpx.Response(200, json=CARDS)
        if path == "/internal/users/1" and method == "GET":
            return httpx.Response(200, json={"user_id": 1})
        if path.startswith("/internal/users/1/schedules/"):
            day = path.rsplit("/", 1)[1]
            if method == "PUT":
                if day < request.url.params["at"][:10]:
                    return httpx.Response(422, json={"detail": "지난 날의 일정은 넣을 수 없습니다"})
                if any(i["end"] <= i["start"] for i in body["items"]):
                    return httpx.Response(422, json={"detail": "끝 시각은 시작 시각보다 늦어야 합니다"})
                self.schedules[day] = body["items"]
            return httpx.Response(200, json={"day": day, "items": self.schedules.get(day, [])})
        if path == "/internal/users/1/card-recommendation":
            items = [i for d in self.schedules.values() for i in d]
            vet = next((i for i in items if i["category"] == "PET"), None)
            if vet is None or 7 in self.recommended:
                return httpx.Response(200, json={"recommend": False})
            self.recommended.append(7)
            return httpx.Response(200, json={"recommend": True, "card_id": 7, "card_name": "신한 펫 카드", "gain": 24000,
                                             "trigger": "schedule", "reason": "오늘 동물병원 300,000원 일정이 있어요.",
                                             "first_month_note": None})
        if path == "/internal/users/1/schedule-popup":
            items = [i for d in self.schedules.values() for i in d]
            cafe = next((i for i in items if i["category"] == "CAFE"), None)
            if cafe is None:
                return httpx.Response(200, json={"kind": "none", "offers": []})
            return httpx.Response(200, json={"kind": "promotion", "offers": [{
                "item_id": 1, "start": "2026-11-05T14:00:00+09:00", "end": "2026-11-05T15:00:00+09:00",
                "category": "CAFE", "category_name": "카페", "amount": cafe["amount"], "promotion_id": 1,
                "brand": "메가MGC커피", "title": "메가MGC커피 마실 땐 신한 슈퍼SOL/SOL페이!", "kind": "event",
                "user_card_id": 1, "card_id": 1, "card_name": "신한 생활 신용", "promo_value": 500, "card_value": 600,
                "total": 1100, "alternatives": [], "window_from": "2026-11-05T13:30:00+09:00",
                "window_to": "2026-11-05T15:30:00+09:00"}]})
        if path == "/internal/places/classify":
            return httpx.Response(200, json=CLASSIFY)
        if path == "/internal/users/1/recommendation-page":
            return httpx.Response(200, json=PAGE)
        if path == "/internal/users/1/strategy":
            return httpx.Response(200, json={"strategy": "main_top", "status": "ready", "scores": {}})
        if path == "/internal/users/1/missed-benefit":
            return httpx.Response(200, json=[{"card_id": 7, "card_name": "신한 펫 카드", "gain": 52000, "months": 10}])
        if path == "/internal/users/1/rules":
            if method == "PUT":
                self.rules = body
                return httpx.Response(200, json={"saved": len(body)})
            return httpx.Response(200, json=self.rules)
        if path == "/internal/rank":
            sched = bool(self.schedules.get(body["at"][:10]))
            return httpx.Response(200, json={
                "recommendation_id": 1, "display_count": 1, "reason_code": "AMOUNT_BENEFIT",
                "rule_applied": None, "version": "schedule" if sched else "pattern",
                "scenario_mode": "schedule" if sched else "time",
                "cards": [{"user_card_id": 2, "rank": 1, "score_won": 1300, "message": "일반음식점에서 10,000원 이상 결제하면 10% 할인을 받을 수 있어요!"},
                          {"user_card_id": 1, "rank": 2, "score_won": 200, "message": ""},
                          {"user_card_id": 4, "rank": 3, "score_won": 100, "message": ""}],
                "explanation": {"base_card": 1, "swapped": True, "swap_reason": "benefit", "repeat_applied": False,
                                "top_category": "RESTAURANT",
                                "scenarios": [{"category": "RESTAURANT", "category_name": "음식점/패스트푸드", "prob": 0.7, "amounts": [9000, 13000, 16000]}],
                                "card_scores": {"2": {"immediate": 1300, "performance": 0, "promotion": 0, "total": 1300},
                                                "1": {"immediate": 200, "performance": 0, "promotion": 0, "total": 200},
                                                "4": {"immediate": 100, "performance": 0, "promotion": 0, "total": 100}}}})
        if path == "/internal/payments/evaluate":
            values = {1: 0, 2: 1300, 4: 0}
            return httpx.Response(200, json={"cards": [], "best_card": 2, "best_benefit": 1300,
                                             "used_card": body["user_card_id"], "used_benefit": values[body["user_card_id"]]})
        if path == "/internal/payments":
            self.payments.append(body)
            return httpx.Response(200, json={"saved": True})
        if path == "/internal/dev/reset":
            self.payments.clear()
            self.rules = []
            self.schedules.clear()
            self.recommended.clear()
            return httpx.Response(200, json={"reset": True})
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        return httpx.Response(404, json={"detail": "없음"})


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("SOLPAY_DB", str(tmp_path / "test.db"))
    from app import ai, db, main
    importlib.reload(db)
    importlib.reload(main)
    # 개발자 PC 의 단말기 키(환경 변수·demo/data/terminal_keys.json)가 시험에 섞이지 않게 비워 둔다
    from app import terminals
    monkeypatch.delenv("SOLPAY_FIXED_TERMINAL_KEYS", raising=False)
    monkeypatch.delenv("SOLPAY_BACKEND_URL", raising=False)
    monkeypatch.setattr(terminals, "KEYS_FILE", tmp_path / "terminal_keys.json")
    monkeypatch.setattr(main, "_POS_TRANSPORT", None)
    fake = FakeAI()
    ai.use_client(httpx.Client(base_url="http://ai", transport=httpx.MockTransport(fake.handle)))
    main._merchants.clear()
    main._cards.clear()
    main._last_order.clear()
    clock = {"t": 1_800_000_000.0}
    monkeypatch.setattr(main, "_now", lambda: clock["t"])
    with TestClient(main.app) as client:
        client.get("/api/me")                 # 카드 목록과 AI 순서를 받아 둔다
        yield client, clock, fake
    ai.use_client(None)
