"""SOL페이 AI 카드 배치 데모 서버 (FastAPI).

실제 구조에서 Spring 이 맡을 역할을 한다: 일회용 토큰 발급, 가상 POS 승인, 거래 저장.
카드 순서와 안내 문구, 하루 일정, 신규 카드 추천은 AI 추천 엔진(solpay-ai)에 HTTP 로 묻는다.
위치(GPS)는 받지도 보내지도 않는다 (2026-11-14 멘토링 반영).
실제 결제망·카드사와 연결되지 않으며, 이 서버가 발급한 토큰만 이 서버의 가상 POS 에서 승인된다.
"""
import hashlib
import hmac
import os
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, time as dtime
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, codes, db, demo

TOKEN_TTL_SEC = 60          # 토큰 유효시간
TOKEN_DIGITS = 18           # 바코드에 담기는 숫자 자릿수
PAYMENT_ID_BASE = 900_000_000   # AI 엔진에 보내는 시연 결제 번호 (가상 데이터 번호와 겹치지 않게)

# 토큰 해시용 비밀키. 환경변수가 없으면 실행할 때마다 새로 만든다
# (서버를 재시작하면 그 전에 발급된 토큰은 모두 무효가 된다).
_SECRET = os.environ.get("SOLPAY_SECRET", "").encode() or secrets.token_bytes(32)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

_merchants: dict[int, dict] = {}            # AI 엔진의 가맹점 목록 (처음 성공했을 때 한 번 받는다)
_cards: dict[int, list[dict]] = {}          # 사용자별 마지막 카드 현황. AI 가 꺼져도 기본 순서를 보여 주려고 둔다
_last_order: dict[int, list[int]] = {}      # 사용자별 마지막 AI 카드 순서


def _now() -> float:
    """현재 시각. 테스트에서 시간을 조작할 수 있도록 함수로 분리."""
    return time.time()


def hash_token(raw: str) -> str:
    return hmac.new(_SECRET, raw.encode(), hashlib.sha256).hexdigest()


def new_token_number() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(TOKEN_DIGITS))


def token_status(row) -> str:
    if row["used_at"] is not None:
        return "USED"
    if row["revoked_at"] is not None:
        return "REVOKED"
    if _now() > row["expires_at"]:
        return "EXPIRED"
    return "ACTIVE"


def merchants() -> dict[int, dict]:
    if not _merchants:
        try:
            _merchants.update({m["merchant_id"]: m for m in ai.merchants()})
        except ai.AIUnavailable:
            pass
    return _merchants


def state() -> dict:
    with db.connect() as con:
        return dict(con.execute("SELECT * FROM demo_state WHERE id = 1").fetchone())


def card_view(c: dict) -> dict:
    return {"user_card_id": c["user_card_id"], "name": c["name"], "issuer": c["issuer"],
            "color": demo.ISSUER_COLORS.get(c["issuer"], "#4b5563"), "last4": demo.last4(c["user_card_id"]),
            "display_order": c["display_order"], "status": c}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init(demo.USERS[0]["user_id"], demo.DEFAULT_TIME)
    yield


app = FastAPI(title="SOL페이 AI 카드 배치 데모", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---------- 페이지 ----------

@app.get("/", include_in_schema=False)
def index():
    return RedirectResponse("/pay")


@app.get("/pay", include_in_schema=False)
def pay_page():
    return FileResponse(STATIC_DIR / "pay.html")


@app.get("/pos", include_in_schema=False)
def pos_page():
    return FileResponse(STATIC_DIR / "pos.html")


# ---------- 시연 설정 ----------

@app.get("/api/demo/options")
def options():
    by_zone: dict[str, list[dict]] = {}
    for m in sorted(merchants().values(), key=lambda m: (demo.CATEGORY_ORDER.get(m["category_code"], 99), m["name"])):
        by_zone.setdefault(m["zone"], []).append(
            {"merchant_id": m["merchant_id"], "name": m["name"], "category_code": m["category_code"],
             "category_name": m["category_name"], "typical_amount": demo.TYPICAL_AMOUNT.get(m["category_code"], 10000)})
    return {"users": [{**u, "zones": [{"code": z, "name": demo.ZONES[z], "role": r} for z, r in u["zones"]]}
                      for u in demo.USERS],
            "times": demo.TIMES, "zones": demo.ZONES, "merchants": by_zone,
            "schedule_categories": [{"code": c, "name": n, "typical_amount": demo.TYPICAL_AMOUNT.get(c, 10000)}
                                    for c, n in demo.SCHEDULE_CATEGORIES]}


class StateUpdate(BaseModel):
    user_id: int | None = None
    demo_at: datetime | None = None


@app.put("/api/demo/state")
def update_state(body: StateUpdate):
    changes = body.model_fields_set
    with db.connect() as con:
        if "user_id" in changes and body.user_id is not None:
            if body.user_id not in {u["user_id"] for u in demo.USERS}:
                raise HTTPException(404, "데모 사용자가 아닙니다.")
            con.execute("UPDATE demo_state SET user_id = ? WHERE id = 1", (body.user_id,))
        if "demo_at" in changes and body.demo_at is not None:
            at = body.demo_at if body.demo_at.tzinfo else body.demo_at.astimezone()
            con.execute("UPDATE demo_state SET demo_at = ? WHERE id = 1", (at.isoformat(),))
    return state()


@app.get("/api/demo/state")
def get_state():
    return state()


@app.post("/api/demo/reset")
def reset():
    """시연 중 쌓은 결제·규칙·일정·카드 추천 기록을 지우고 처음 상태로 돌아간다."""
    db.clear_activity()
    with db.connect() as con:
        con.execute("UPDATE demo_state SET user_id = ?, demo_at = ? WHERE id = 1",
                    (demo.USERS[0]["user_id"], demo.DEFAULT_TIME))
    _cards.clear()
    _last_order.clear()
    try:
        ai.reset()
    except (ai.AIUnavailable, httpx.HTTPStatusError):
        raise HTTPException(503, "AI 엔진을 초기화하지 못했습니다. AI 서버가 켜져 있는지 확인하세요.")
    return {"reset": True}


# ---------- 결제 화면 ----------

@app.get("/api/me")
def me():
    """결제화면 구성: AI 가 정한 카드 순서, 안내 문구, 오늘 일정, 판단 근거, 카드별 실적."""
    st = state()
    user_id, at = st["user_id"], st["demo_at"]
    merchants()                                  # AI 가 꺼져도 POS 가 쓸 수 있게 가맹점 목록을 받아 둔다
    profile = demo.user(user_id)
    result = {"user": {k: profile[k] for k in ("user_id", "name", "desc")}, "at": at,
              "ai": {"ok": False, "ms": None, "error": None}}

    try:
        status = ai.cards(user_id, at)
        _cards[user_id] = status
    except ai.AIUnavailable as e:
        status = _cards.get(user_id)
        result["ai"]["error"] = str(e)
        if status is None:
            raise HTTPException(503, "AI 엔진에 연결할 수 없습니다. solpay-ai 서버를 먼저 켜 주세요.")
    by_id = {c["user_card_id"]: card_view(c) for c in status}

    try:
        rank, ms = ai.rank(user_id, at)
        result["ai"].update(ok=True, ms=round(ms, 1))
    except ai.AIUnavailable as e:
        # 실제 서비스와 같이 0.8초 안에 답이 없으면 기본 순서로 보여 준다
        result["ai"]["error"] = str(e)
        order = sorted(by_id.values(), key=lambda c: c["display_order"])
        rank = {"cards": [{"user_card_id": c["user_card_id"], "rank": i + 1, "score_won": 0,
                           "message": "AI 응답이 없어 기본 순서로 보여 드려요" if i == 0 else ""}
                          for i, c in enumerate(order)],
                "display_count": 1, "reason_code": "FALLBACK", "rule_applied": None,
                "version": "unknown", "scenario_mode": "fallback", "explanation": None}

    cards = []
    for c in rank["cards"]:
        view = by_id[c["user_card_id"]]
        cards.append({**view, "rank": c["rank"], "message": c["message"], "score_won": c["score_won"],
                      "shown": c["rank"] <= rank["display_count"]})
    _last_order[user_id] = [c["user_card_id"] for c in cards]

    explanation = rank.get("explanation")
    if explanation:
        names = {c["user_card_id"]: c["name"] for c in cards}
        explanation["base_card_name"] = names.get(explanation["base_card"])
        explanation["card_scores"] = [{"user_card_id": int(k), "name": names.get(int(k)), **v}
                                      for k, v in explanation["card_scores"].items()]
        explanation["card_scores"].sort(key=lambda r: -r["total"])

    try:
        rules = ai.rules(user_id)
        schedule = _schedule_view(ai.schedule(user_id, at[:10])["items"])
    except ai.AIUnavailable:
        rules, schedule = [], []
    try:
        code = ai.strategy(user_id, at).get("strategy")
        strategy = {"code": code, "label": demo.STRATEGY_LABELS.get(code, code)} if code else None
    except (ai.AIUnavailable, httpx.HTTPStatusError):
        strategy = None
    result.update(state=st, schedule=schedule, strategy=strategy,
        cards=cards, display_count=rank["display_count"], default_card_id=cards[0]["user_card_id"],
        reason_code=rank["reason_code"],
        rule_applied=rank["rule_applied"], version=rank["version"], scenario_mode=rank["scenario_mode"],
        mode_label=demo.MODE_LABELS.get(rank["scenario_mode"], rank["scenario_mode"]),
        explanation=explanation, rules=rules,
    )
    return result


# ---------- 하루 일정과 신규 카드 추천 ----------

_CATEGORY_NAMES = dict(demo.SCHEDULE_CATEGORIES)


def _schedule_view(items: list[dict]) -> list[dict]:
    return [{**i, "category_name": _CATEGORY_NAMES.get(i["category"], i["category"])} for i in items]


class ScheduleItem(BaseModel):
    """하루 일정 한 줄: 시간 범위, 업종, 예상 금액만 받는다 (장소·메모 같은 자유 입력은 없다)."""
    start: dtime
    end: dtime
    category: str = Field(..., max_length=40)
    amount: int = Field(..., ge=1, le=10_000_000)


class ScheduleRequest(BaseModel):
    items: list[ScheduleItem] = Field(default_factory=list, max_length=10)


@app.get("/api/schedule")
def get_schedule():
    st = state()
    try:
        return {"day": st["demo_at"][:10], "items": _schedule_view(ai.schedule(st["user_id"], st["demo_at"][:10])["items"])}
    except ai.AIUnavailable:
        raise HTTPException(503, "AI 엔진이 꺼져 있어 일정을 불러올 수 없습니다.")


@app.put("/api/schedule")
def put_schedule(req: ScheduleRequest):
    """오늘 일정을 통째로 저장한다. 빈 목록이면 '일정 없음'으로 보고 지운다."""
    st = state()
    if any(i.category not in _CATEGORY_NAMES for i in req.items):
        raise HTTPException(422, "고를 수 없는 업종입니다.")
    items = [{"start": i.start.strftime("%H:%M"), "end": i.end.strftime("%H:%M"), "category": i.category,
              "amount": i.amount} for i in req.items]
    try:
        saved = ai.put_schedule(st["user_id"], st["demo_at"][:10], items, st["demo_at"])
    except ai.AIUnavailable:
        raise HTTPException(503, "AI 엔진이 꺼져 있어 일정을 저장할 수 없습니다.")
    except httpx.HTTPStatusError as e:
        raise HTTPException(422, _detail(e))
    return {"day": saved["day"], "items": _schedule_view(saved["items"])}


def _detail(e: httpx.HTTPStatusError) -> str:
    try:
        detail = e.response.json().get("detail")
    except ValueError:
        detail = None
    return detail if isinstance(detail, str) else "일정을 확인해 주세요 (끝 시각은 시작보다 늦게, 금액은 1천만 원 이하)."


@app.post("/api/schedule-popup")
def schedule_popup():
    """일정 입력 다음 화면 (설계서 v4.1). kind=card: 새 신한카드 추천(3일마다), kind=promotion: 일정에 맞는 프로모션과
    그 프로모션을 받을 신한카드(그 일정 시간에는 이 카드를 먼저 보여 줌), kind=none: 팝업 없이 결제 화면."""
    st = state()
    try:
        popup = ai.schedule_popup(st["user_id"], st["demo_at"])
    except ai.AIUnavailable:
        return {"kind": "none", "error": "AI 엔진이 꺼져 있어 추천을 건너뜁니다."}
    for offer in popup.get("offers", []):
        offer["window"] = f"{offer['window_from'][11:16]}~{offer['window_to'][11:16]}"
        offer["schedule_time"] = f"{offer['start'][11:16]}~{offer['end'][11:16]}"
    return popup


@app.post("/api/card-recommendation")
def card_recommendation():
    """일정 입력 다음 화면. 계기(특수 고액 일정·특수 업종 방문·같은 업종 반복·3일 간격)가 없으면 recommend=false."""
    st = state()
    try:
        return ai.recommend_card(st["user_id"], st["demo_at"])
    except ai.AIUnavailable:
        return {"recommend": False, "error": "AI 엔진이 꺼져 있어 추천을 건너뜁니다."}


@app.get("/api/missed-benefit")
def missed_benefit():
    """연말 결산 미리보기: 지난 1년 동안 그 신한카드가 있었다면 더 받았을 혜택 (상위 3장)."""
    st = state()
    try:
        return {"at": st["demo_at"], "cards": ai.missed_benefit(st["user_id"], st["demo_at"])}
    except ai.AIUnavailable:
        raise HTTPException(503, "AI 엔진이 꺼져 있어 계산할 수 없습니다.")


class IssueRequest(BaseModel):
    card_id: int


@app.post("/api/tokens")
def issue_token(req: IssueRequest):
    now = _now()
    user_id = state()["user_id"]
    card = next((c for c in _cards.get(user_id, []) if c["user_card_id"] == req.card_id), None)
    if card is None:
        raise HTTPException(404, "등록되지 않은 카드입니다.")
    order = _last_order.get(user_id, [])
    ai_rank = order.index(req.card_id) + 1 if req.card_id in order else None
    last4 = demo.last4(card["user_card_id"])

    with db.connect() as con:
        # 새 코드를 받으면 이 사용자의 아직 살아 있는 이전 코드는 모두 무효화
        con.execute("""UPDATE tokens SET revoked_at = ?
                       WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at >= ?""",
                    (now, user_id, now))
        token_id = uuid.uuid4().hex
        while True:  # 18자리 난수 충돌은 사실상 없지만, 나면 다시 뽑는다
            raw = new_token_number()
            try:
                con.execute("INSERT INTO tokens (id, token_hash, user_id, card_id, card_name, card_last4, "
                            "ai_first_card, ai_rank, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            (token_id, hash_token(raw), user_id, card["user_card_id"], card["name"], last4,
                             order[0] if order else None, ai_rank, now, now + TOKEN_TTL_SEC))
                break
            except db.sqlite3.IntegrityError:
                continue

    return {
        "token_id": token_id,
        "token": raw,                       # 원문은 이 응답에서 한 번만 내려간다
        "issued_at": now,
        "expires_at": now + TOKEN_TTL_SEC,
        "ttl_sec": TOKEN_TTL_SEC,
        "card": {"id": card["user_card_id"], "name": card["name"], "last4": last4, "ai_rank": ai_rank},
        "barcode": codes.barcode_data_uri(raw),
        "qr": codes.qr_data_uri(raw),
    }


@app.get("/api/tokens/{token_id}")
def get_token(token_id: str):
    """결제 화면이 1초마다 물어보는 상태 조회. 결제되면 거래 요약과 혜택을 함께 준다."""
    with db.connect() as con:
        row = con.execute("SELECT * FROM tokens WHERE id = ?", (token_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "없는 토큰입니다.")
        status = token_status(row)
        tx = None
        if status == "USED":
            tx = con.execute("SELECT merchant, category, amount, approval_no, created_at, card_name, benefit, "
                             "best_card_id, best_card, best_benefit, ai_rank, ai_synced FROM transactions "
                             "WHERE token_id = ? AND result = 'APPROVED'", (token_id,)).fetchone()
    return {"token_id": token_id, "status": status, "expires_at": row["expires_at"],
            "transaction": dict(tx) if tx else None}


# ---------- 사용자 규칙 (챗봇 대신 간단한 입력) ----------

DAY_CODES = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAY_NAMES = "월화수목금토일"


class RuleRequest(BaseModel):
    kind: str = Field(..., pattern="^(force_now|force_always|exclude|prefer_immediate|order_top)$")
    user_card_id: int | None = None


def _rule_from(req: RuleRequest, user_id: int, at: str) -> dict:
    card = next((c for c in _cards.get(user_id, []) if c["user_card_id"] == req.user_card_id), None)
    if req.kind in ("force_now", "force_always", "exclude") and card is None:
        raise HTTPException(422, "대상 카드를 골라 주세요.")
    when = datetime.fromisoformat(at)
    if req.kind == "force_now":
        day, hour = when.weekday(), when.hour
        return {"rule_type": "force", "condition": {"days": [DAY_CODES[day]], "hours": [hour, hour + 1]},
                "target": {"user_card_ids": [card["user_card_id"]]}, "priority": 10,
                "source_text": f"{DAY_NAMES[day]}요일 {hour}시대에는 {card['name']}로 해줘"}
    if req.kind == "force_always":
        return {"rule_type": "force", "target": {"user_card_ids": [card["user_card_id"]]},
                "source_text": f"항상 {card['name']}로 해줘"}
    if req.kind == "exclude":
        return {"rule_type": "exclude", "target": {"user_card_ids": [card["user_card_id"]]},
                "source_text": f"{card['name']}는 추천하지 마"}
    if req.kind == "prefer_immediate":
        return {"rule_type": "preference", "settings": {"w1": 1.5, "w2": 0.5},
                "source_text": "실적보다 건당 혜택이 높은 카드를 추천해줘"}
    return {"rule_type": "order", "settings": {"base_order": "top_tier"},
            "source_text": "최고 구간까지 채우고 다음 카드로 넘어가줘"}


@app.post("/api/rules")
def add_rule(req: RuleRequest):
    st = state()
    try:
        rules = ai.rules(st["user_id"])
        rules.append(_rule_from(req, st["user_id"], st["demo_at"]))
        ai.save_rules(st["user_id"], rules)
    except ai.AIUnavailable:
        raise HTTPException(503, "AI 엔진이 꺼져 있어 규칙을 저장할 수 없습니다.")
    return rules


@app.delete("/api/rules/{index}")
def delete_rule(index: int):
    st = state()
    try:
        rules = ai.rules(st["user_id"])
        if not 0 <= index < len(rules):
            raise HTTPException(404, "없는 규칙입니다.")
        rules.pop(index)
        ai.save_rules(st["user_id"], rules)
    except ai.AIUnavailable:
        raise HTTPException(503, "AI 엔진이 꺼져 있어 규칙을 지울 수 없습니다.")
    return rules


# ---------- 가상 POS ----------

class ApproveRequest(BaseModel):
    token: str = Field(..., description="바코드·QR에서 읽은 숫자")
    merchant_id: int
    amount: int = Field(..., ge=1, le=10_000_000)


@app.post("/api/pos/approve")
def approve(req: ApproveRequest):
    now = _now()
    raw = "".join(req.token.split())  # 공백·줄바꿈 제거 (스캐너 입력 대비)
    merchant = merchants().get(req.merchant_id)
    if merchant is None:
        raise HTTPException(422, "가맹점 목록에 없는 가맹점입니다. AI 서버가 켜져 있는지 확인하세요.")
    demo_at = state()["demo_at"]

    with db.connect() as con:
        def record(result, reason=None, row=None, approval_no=None):
            cur = con.execute("""INSERT INTO transactions
                           (created_at, demo_at, result, reason, approval_no, token_id, user_id, card_id, card_name,
                            merchant_id, merchant, category, amount, ai_rank)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (now, demo_at, result, reason, approval_no,
                         row["id"] if row else None, row["user_id"] if row else None,
                         row["card_id"] if row else None, row["card_name"] if row else None,
                         merchant["merchant_id"], merchant["name"], merchant["category_name"], req.amount,
                         row["ai_rank"] if row else None))
            return cur.lastrowid, {"result": result, "reason": reason, "approval_no": approval_no,
                                   "merchant": merchant["name"], "amount": req.amount}

        if not (raw.isdigit() and len(raw) == TOKEN_DIGITS):
            return record("DECLINED", "코드 형식이 올바르지 않습니다.")[1]

        row = con.execute("SELECT * FROM tokens WHERE token_hash = ?", (hash_token(raw),)).fetchone()
        if row is None:
            return record("DECLINED", "발급되지 않은 코드입니다.")[1]

        status = token_status(row)
        if status != "ACTIVE":
            reason = {"USED": "이미 사용된 코드입니다.",
                      "REVOKED": "새 코드가 발급되어 무효가 된 코드입니다.",
                      "EXPIRED": "유효시간이 지난 코드입니다."}[status]
            return record("DECLINED", reason, row)[1]

        # 조건부 UPDATE로 '딱 한 번만' 사용되게 보장 (동시에 두 번 찍어도 하나만 성공)
        cur = con.execute("""UPDATE tokens SET used_at = ?
                             WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at >= ?""",
                          (now, row["id"], now))
        if cur.rowcount != 1:
            return record("DECLINED", "이미 처리된 코드입니다.", row)[1]
        tx_id, result = record("APPROVED", row=row, approval_no=f"{secrets.randbelow(10**8):08d}")
    result["card"] = f'{row["card_name"]} ({row["card_last4"]})'
    result.update(_after_approval(tx_id, row, merchant, req.amount, demo_at))
    return result


def _after_approval(tx_id: int, token_row, merchant: dict, amount: int, demo_at: str) -> dict:
    """승인 뒤: AI 로 이 결제의 혜택과 가장 유리했던 카드를 계산하고, 결제를 AI 엔진에 보낸다.

    AI 가 꺼져 있어도 결제는 승인된다. 혜택만 비워 둔다.
    """
    user_id, card_id = token_row["user_id"], token_row["card_id"]
    names = {c["user_card_id"]: c["name"] for c in _cards.get(user_id, [])}
    info = {"benefit": None, "best_card_id": None, "best_card": None, "best_benefit": None, "ai_synced": 0}
    try:
        check = ai.evaluate(user_id, demo_at, merchant["category_code"], amount, card_id,
                            merchant["merchant_id"])                                        # 결제 반영 전 상태
        info.update(benefit=check["used_benefit"], best_card_id=check["best_card"],
                    best_card=names.get(check["best_card"]), best_benefit=check["best_benefit"])
        ai.save_payment({"payment_id": PAYMENT_ID_BASE + tx_id, "user_id": user_id, "user_card_id": card_id,
                         "merchant_id": merchant["merchant_id"], "category_code": merchant["category_code"],
                         "channel": "offline_qr", "card_select_mode": "manual", "amount": amount,
                         "paid_at": demo_at})
        info["ai_synced"] = 1
    except (ai.AIUnavailable, httpx.HTTPStatusError):
        pass
    with db.connect() as con:
        con.execute("UPDATE transactions SET benefit = ?, best_card_id = ?, best_card = ?, best_benefit = ?, "
                    "ai_synced = ? WHERE id = ?",
                    (info["benefit"], info["best_card_id"], info["best_card"], info["best_benefit"],
                     info["ai_synced"], tx_id))
    return info


@app.get("/api/transactions")
def transactions(limit: int = 20):
    limit = max(1, min(limit, 200))
    with db.connect() as con:
        rows = con.execute("""SELECT id, created_at, demo_at, result, reason, approval_no, merchant, category,
                                     amount, card_name, card_id, benefit, best_card, best_benefit, ai_rank, ai_synced
                              FROM transactions ORDER BY id DESC LIMIT ?""", (limit,)).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/health")
def health():
    try:
        ai.client().get("/health", timeout=1.0).raise_for_status()
        ai_ok = True
    except httpx.HTTPError:
        ai_ok = False
    return {"status": "ok", "ai": ai_ok, "ai_url": ai.BASE_URL}

