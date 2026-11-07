"""FastAPI 추천 엔진. Spring 만 호출하는 내부 API 다.

Spring 은 0.8초 안에 응답이 없으면 기본 순서로 결제화면을 구성한다.
"""

import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, Field

from engine.category_model import CategoryModel
from engine.domain import Payment, RankRequest
from engine.loader import ARTIFACTS
from engine.params import Params
from engine.priors import Priors
from engine.rules import RuleError, parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import ParquetStore, UnknownUser

KST = ZoneInfo("Asia/Seoul")


class RankBody(BaseModel):
    user_id: int
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    at: datetime | None = None
    selected_merchant_id: int | None = None
    explain: bool = False                  # 추천 근거를 함께 받는다 (시연·로그 확인용)


class CardBody(BaseModel):
    user_card_id: int
    rank: int
    score_won: int
    message: str


class ChipBody(BaseModel):
    merchant_id: int
    probability: float


class RankResponse(BaseModel):
    recommendation_id: int
    cards: list[CardBody]
    display_count: int
    merchant_chips: list[ChipBody]
    reason_code: str
    rule_applied: int | None
    version: str
    scenario_mode: str
    explanation: dict | None = None


class ConsentBody(BaseModel):
    loc_consent: bool
    loc_feature_on: bool


class EvaluateBody(BaseModel):
    user_id: int
    category_code: str
    amount: int = Field(gt=0)
    at: datetime | None = None
    user_card_id: int | None = None


class PaymentBody(BaseModel):
    payment_id: int
    user_id: int
    user_card_id: int
    merchant_id: int | None = None
    category_code: str
    channel: str
    card_select_mode: str
    amount: int = Field(gt=0)
    paid_at: datetime
    synced_at: datetime | None = None


def build_service() -> PlacementService:
    kind = os.environ.get("SOLPAY_STORE", "parquet")
    if kind == "postgres":
        from engine.pg_store import PostgresStore
        store = PostgresStore(os.environ["SOLPAY_DATABASE_URL"])
    elif kind == "parquet":
        store = ParquetStore()
    else:
        raise ValueError(f"알 수 없는 저장소: {kind}")
    priors_path = ARTIFACTS / "priors.json"
    if not priors_path.exists():
        raise FileNotFoundError(f"{priors_path} 가 없습니다. `uv run python -m training.build_priors` 를 먼저 실행하세요.")
    model = CategoryModel.load(ARTIFACTS) if os.environ.get("SOLPAY_CATEGORY_MODEL") == "v2" else None
    return PlacementService(store, PlacementEngine(store.load_catalog(), Priors.load(priors_path), Params(), model))


def check_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("SOLPAY_INTERNAL_TOKEN")
    if expected and not hmac.compare_digest(x_internal_token or "", expected):
        raise HTTPException(status_code=401, detail="내부 호출 토큰이 맞지 않습니다")


def _explain(svc: PlacementService, result) -> dict:
    catalog = svc.engine.catalog
    return {
        "base_card": result.base_card, "swapped": result.swapped, "swap_reason": result.swap_reason,
        "repeat_applied": result.repeat_applied, "top_category": result.top_category,
        "scenarios": [{**s, "category_name": catalog.category_name(s["category"])} for s in result.scenarios],
        "card_scores": {str(k): v for k, v in result.card_scores.items()},
    }


def create_app(service: PlacementService | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.service = service or build_service()
        yield

    app = FastAPI(title="SOL페이 카드 배치 엔진", version="0.1.0", lifespan=lifespan)

    def current(request: Request) -> PlacementService:
        return request.app.state.service

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.post("/internal/rank", response_model=RankResponse, dependencies=[Depends(check_token)])
    def rank(body: RankBody, svc: PlacementService = Depends(current)):
        at = (body.at or datetime.now(KST)).astimezone(KST)
        req = RankRequest(body.user_id, at, body.lat, body.lng, body.accuracy_m, body.selected_merchant_id)
        try:
            recommendation_id, result = svc.rank(req)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        return RankResponse(
            recommendation_id=recommendation_id,
            cards=[CardBody(user_card_id=c.user_card_id, rank=c.rank, score_won=c.score_won, message=c.message)
                   for c in result.cards],
            display_count=result.display_count, merchant_chips=result.merchant_chips,
            reason_code=result.reason_code, rule_applied=result.rule_applied,
            version=result.version, scenario_mode=result.scenario_mode,
            explanation=_explain(svc, result) if body.explain else None,
        )

    @app.get("/internal/users/{user_id}", dependencies=[Depends(check_token)])
    def user(user_id: int, svc: PlacementService = Depends(current)) -> dict:
        try:
            u = svc.store.user(user_id)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        return {"user_id": u.user_id, "loc_consent": u.loc_consent, "loc_feature_on": u.loc_feature_on,
                "version": "consent" if u.location_enabled else "no_consent"}

    @app.put("/internal/users/{user_id}/consent", dependencies=[Depends(check_token)])
    def set_consent(user_id: int, body: ConsentBody, svc: PlacementService = Depends(current)) -> dict:
        """위치 동의가 바뀌면 Spring 이 알린다. 다음 요청부터 그 버전으로 계산한다."""
        try:
            svc.store.set_consent(user_id, body.loc_consent, body.loc_feature_on)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        return user(user_id, svc)

    @app.get("/internal/users/{user_id}/cards", dependencies=[Depends(check_token)])
    def cards(user_id: int, at: datetime | None = None, svc: PlacementService = Depends(current)) -> list[dict]:
        """카드별 실적 현황. 타사 카드는 어제까지 기준이다."""
        try:
            return svc.card_status(user_id, (at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/users/{user_id}/rules", dependencies=[Depends(check_token)])
    def rules(user_id: int, svc: PlacementService = Depends(current)) -> list[dict]:
        try:
            return svc.store.raw_rules(user_id)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.post("/internal/payments/evaluate", dependencies=[Depends(check_token)])
    def evaluate_payment(body: EvaluateBody, svc: PlacementService = Depends(current)) -> dict:
        """승인 직전 결제를 카드마다 했을 때의 혜택. 결제 완료 화면과 사후 최적 카드에 쓴다."""
        at = (body.at or datetime.now(KST)).astimezone(KST)
        try:
            return svc.evaluate_payment(body.user_id, at, body.category_code, body.amount, body.user_card_id)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/merchants", dependencies=[Depends(check_token)])
    def merchants(zone: str | None = None, svc: PlacementService = Depends(current)) -> list[dict]:
        catalog = svc.engine.catalog
        return [{"merchant_id": m.merchant_id, "name": m.name, "category_code": m.category,
                 "category_name": catalog.category_name(m.category), "lat": m.lat, "lng": m.lng, "zone": m.zone}
                for m in catalog.merchants.values()
                if not m.is_online and m.lat is not None and (zone is None or m.zone == zone)]

    @app.post("/internal/dev/reset", dependencies=[Depends(check_token)])
    def reset(svc: PlacementService = Depends(current)) -> dict:
        """로컬 시연용. 시연 중 더한 결제, 규칙, 위치 설정을 지운다."""
        try:
            svc.store.reset()
        except NotImplementedError:
            raise HTTPException(status_code=405, detail="운영 저장소는 초기화할 수 없습니다")
        return {"reset": True}

    @app.put("/internal/users/{user_id}/rules", dependencies=[Depends(check_token)])
    def save_rules(user_id: int, rules: list[dict], svc: PlacementService = Depends(current)) -> dict:
        """챗봇이 사용자 확인을 받은 규칙을 통째로 저장한다."""
        try:
            for i, rule in enumerate(rules):
                parse_rule(rule, i + 1, i)
            svc.store.save_rules(user_id, rules)
        except RuleError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        return {"saved": len(rules)}

    @app.post("/internal/payments", dependencies=[Depends(check_token)])
    def add_payment(body: PaymentBody, svc: PlacementService = Depends(current)) -> dict:
        """로컬 시연용. 운영에서는 Spring 이 결제를 DB 에 저장하고 엔진은 DB 를 읽는다."""
        try:
            svc.store.add_payment(Payment(
                body.payment_id, body.user_id, body.user_card_id, body.merchant_id, body.category_code, body.channel,
                body.card_select_mode, body.amount, body.paid_at.astimezone(KST),
                body.synced_at.astimezone(KST) if body.synced_at else None))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        except NotImplementedError:
            raise HTTPException(status_code=405, detail="운영 저장소에서는 Spring 이 결제를 저장합니다")
        return {"saved": True}

    return app


app = create_app()
