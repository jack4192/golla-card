"""AI 추천 엔진(solpay-ai) 호출. 실제 구조처럼 Spring 역할인 이 서버가 HTTP 로 부른다.

카드 순서 요청은 0.8초 안에 답이 없으면 기본 순서로 결제화면을 구성한다.
"""
import os
import time

import httpx

BASE_URL = os.environ.get("SOLPAY_AI_URL", "http://127.0.0.1:8001")
RANK_TIMEOUT_SEC = 0.8
OTHER_TIMEOUT_SEC = 3.0
POPUP_TIMEOUT_SEC = 10.0

_client: httpx.Client | None = None


class AIUnavailable(RuntimeError):
    pass


def client() -> httpx.Client:
    global _client
    if _client is None:
        headers = {}
        if os.environ.get("SOLPAY_AI_TOKEN"):
            headers["X-Internal-Token"] = os.environ["SOLPAY_AI_TOKEN"]
        _client = httpx.Client(base_url=BASE_URL, headers=headers)
    return _client


def use_client(c: httpx.Client | None) -> None:
    """테스트에서 가짜 AI 서버를 끼울 때 쓴다."""
    global _client
    _client = c


def _call(method: str, path: str, timeout: float, **kw):
    try:
        res = client().request(method, path, timeout=timeout, **kw)
    except httpx.HTTPError as e:
        raise AIUnavailable(str(e)) from e
    if res.status_code >= 500:
        raise AIUnavailable(f"AI 서버 오류 {res.status_code}")
    res.raise_for_status()
    return res.json()


def rank(user_id: int, at: str) -> tuple[dict, float]:
    body = {"user_id": user_id, "at": at, "explain": True}
    started = time.perf_counter()
    data = _call("POST", "/internal/rank", RANK_TIMEOUT_SEC, json=body)
    return data, (time.perf_counter() - started) * 1000


def cards(user_id: int, at: str) -> list[dict]:
    return _call("GET", f"/internal/users/{user_id}/cards", OTHER_TIMEOUT_SEC, params={"at": at})


def user(user_id: int) -> dict:
    return _call("GET", f"/internal/users/{user_id}", OTHER_TIMEOUT_SEC)


def schedule(user_id: int, day: str) -> dict:
    return _call("GET", f"/internal/users/{user_id}/schedules/{day}", OTHER_TIMEOUT_SEC)


def put_schedule(user_id: int, day: str, items: list[dict], at: str) -> dict:
    """하루 일정을 통째로 바꾼다 (빈 목록이면 지운다). 시간·업종·예상 금액만 보낸다."""
    return _call("PUT", f"/internal/users/{user_id}/schedules/{day}", OTHER_TIMEOUT_SEC,
                 params={"at": at}, json={"items": items})


def recommend_card(user_id: int, at: str) -> dict:
    return _call("POST", f"/internal/users/{user_id}/card-recommendation", OTHER_TIMEOUT_SEC, json={"at": at})


def schedule_popup(user_id: int, at: str) -> dict:
    """일정 저장 뒤 팝업: 3일마다 카드 추천, 그 외의 날은 일정에 맞는 프로모션 추천 (설계서 v4.1)."""
    # 결제 화면이 아니라 일정 저장 뒤 화면이라 0.8초 규칙은 없다. 카드 추천 계산(신한카드별 30일 재현)이 첫 호출에
    # 몇 초 걸릴 수 있어 넉넉히 기다린다
    return _call("POST", f"/internal/users/{user_id}/schedule-popup", POPUP_TIMEOUT_SEC, json={"at": at})


def strategy(user_id: int, at: str) -> dict:
    """이번 달 실적 채우기 방식."""
    return _call("GET", f"/internal/users/{user_id}/strategy", OTHER_TIMEOUT_SEC, params={"at": at})


def missed_benefit(user_id: int, at: str) -> list[dict]:
    return _call("GET", f"/internal/users/{user_id}/missed-benefit", 10.0, params={"at": at})


def rules(user_id: int) -> list[dict]:
    return _call("GET", f"/internal/users/{user_id}/rules", OTHER_TIMEOUT_SEC)


def save_rules(user_id: int, rules_: list[dict]) -> dict:
    return _call("PUT", f"/internal/users/{user_id}/rules", OTHER_TIMEOUT_SEC, json=rules_)


def merchants() -> list[dict]:
    return _call("GET", "/internal/merchants", OTHER_TIMEOUT_SEC)


def evaluate(user_id: int, at: str, category: str, amount: int, user_card_id: int, merchant_id: int | None = None) -> dict:
    return _call("POST", "/internal/payments/evaluate", OTHER_TIMEOUT_SEC,
                 json={"user_id": user_id, "at": at, "category_code": category, "amount": amount,
                       "user_card_id": user_card_id, "merchant_id": merchant_id})


def save_payment(payment: dict) -> dict:
    return _call("POST", "/internal/payments", OTHER_TIMEOUT_SEC, json=payment)


def reset() -> dict:
    return _call("POST", "/internal/dev/reset", OTHER_TIMEOUT_SEC)
