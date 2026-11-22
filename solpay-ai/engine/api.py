"""FastAPI 추천 엔진. Spring 만 호출하는 내부 API 다.

Spring 은 0.8초 안에 응답이 없으면 기본 순서로 결제화면을 구성한다.
"""

import asyncio
import hmac
import json
import os
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from engine.category_model import CategoryModel
from engine.ml import load as load_models
from engine.domain import Payment, RankRequest
from engine.jobs import daily_purge, purge_past_schedules
from engine.loader import ARTIFACTS
from engine.params import Params
from engine.priors import Priors
from engine.rules import RuleError, parse_rule
from engine.service import PlacementEngine, PlacementService
from engine.store import ParquetStore, UnknownUser

KST = ZoneInfo("Asia/Seoul")


class RankBody(BaseModel):
    """GPS 는 받지 않는다 (2026-11-14). 일정이 있으면 일정, 없으면 소비 패턴으로 정한다."""
    user_id: int
    at: datetime | None = None
    explain: bool = False                  # 추천 근거를 함께 받는다 (시연·로그 확인용)


class CardBody(BaseModel):
    user_card_id: int
    rank: int
    score_won: int
    message: str


class RankResponse(BaseModel):
    recommendation_id: int
    cards: list[CardBody]
    display_count: int
    reason_code: str
    rule_applied: int | None
    version: str
    scenario_mode: str
    explanation: dict | None = None


class ScheduleItemBody(BaseModel):
    """하루 일정 한 줄. 시간·업종·예상 금액만 받는다 (장소·메모 등 자유 입력 없음)."""
    start: time
    end: time
    category: str = Field(max_length=40)
    amount: int = Field(gt=0, le=10_000_000)


class ScheduleBody(BaseModel):
    items: list[ScheduleItemBody] = Field(max_length=10)


class AtBody(BaseModel):
    at: datetime | None = None


class EvaluateBody(BaseModel):
    user_id: int
    category_code: str
    amount: int = Field(gt=0)
    at: datetime | None = None
    user_card_id: int | None = None
    merchant_id: int | None = None      # 있으면 프로모션도 계산한다


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    text: str = Field(max_length=2000)


class ChatScreen(BaseModel):
    name: str | None = None                 # pay: 결제 화면에서 열었을 때
    recommendation_id: int | None = None


class ChatBody(BaseModel):
    """Spring 이 로그인한 사용자 ID 와 같은 세션의 최근 대화를 붙여 보낸다. LLM 은 사용자 ID 를 바꿀 수 없다."""
    user_id: int
    session_id: str | None = Field(default=None, max_length=64)
    message: str = Field(min_length=1, max_length=1000)
    at: datetime | None = None
    history: list[ChatTurn] = Field(default_factory=list, max_length=40)
    screen: ChatScreen | None = None


class ChatResponse(BaseModel):
    reply: str
    blocks: list[dict]                      # 화면 요소 (score_table, card_compare, card_status, benefit_list, rule_card, new_card_list, pay_button)
    rule_draft: dict | None                 # 규칙 초안. 사용자가 저장을 누르면 Spring 이 /internal/rules/validate 뒤 저장한다
    fallback: bool
    log: dict                               # 쓴 도구, 결과 요약, 토큰 수, 걸린 시간 (Spring 이 대화와 함께 저장)


class RuleValidateBody(BaseModel):
    user_id: int
    rule: dict


class DraftDecisionBody(BaseModel):
    user_id: int


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
    # 기본은 로컬 개인 DB (2026-11-19 결정): 팀 DB 23개 표를 요청마다 조회하고, 쓰기는 app 스키마 (engine/db_store.py).
    # DB 주소가 없으면 팀 DB 형식 CSV(카드서비스_DB_1년)를 메모리에 올려 쓴다 (SOLPAY_STORE=teamdb).
    from engine.settings import database_url, load_env
    load_env()
    url = database_url()
    kind = os.environ.get("SOLPAY_STORE") or ("db" if url else "teamdb")
    if kind == "db":
        import psycopg
        from engine.db_store import TeamDbPgStore
        if not url:
            raise ValueError("DB 주소가 없습니다. 루트 .env 의 POSTGRES_* 또는 SOLPAY_DATABASE_URL 을 확인하세요.")
        try:
            store = TeamDbPgStore(url, os.environ.get("SOLPAY_TEAM_DB_SCHEMA", "public"),
                                  os.environ.get("SOLPAY_APP_SCHEMA", "app"))
        except psycopg.OperationalError as e:
            raise RuntimeError("DB 에 연결할 수 없습니다. 저장소 루트에서 `docker compose up -d db` 로 로컬 DB 를 켜거나, "
                               "SOLPAY_STORE=teamdb 로 CSV 를 쓰세요.") from e
    elif kind == "teamdb":
        from engine.strategy_store import StrategyStore
        from engine.team_db import TeamDbStore
        store = TeamDbStore()
        store.strategy_store = StrategyStore(os.environ.get("SOLPAY_STRATEGY_DB",
                                                            str(ARTIFACTS / "strategy_teamdb.sqlite")))
    elif kind == "postgres":
        from engine.pg_store import PostgresStore
        store = PostgresStore(os.environ["SOLPAY_DATABASE_URL"])
    elif kind == "parquet":
        store = ParquetStore()
        from engine.strategy_store import StrategyStore
        store.strategy_store = StrategyStore(os.environ.get("SOLPAY_STRATEGY_DB", str(ARTIFACTS / "strategy_demo.sqlite")))
    else:
        raise ValueError(f"알 수 없는 저장소: {kind}")
    priors_path = ARTIFACTS / "priors.json"
    if not priors_path.exists():
        raise FileNotFoundError(f"{priors_path} 가 없습니다. `uv run python -m training.build_priors` 를 먼저 실행하세요.")
    # 업종 예측은 LightGBM 이 기본 (SOLPAY_CATEGORY_MODEL=v1 이면 시간대 빈도).
    # 전략 선택 모델·남은 소비 예측은 재생 평가에서 이득이 없어 기본으로 끄고 SOLPAY_ML=on 일 때만 쓴다.
    model = None if os.environ.get("SOLPAY_CATEGORY_MODEL") == "v1" else CategoryModel.load(ARTIFACTS)
    models = load_models(ARTIFACTS) if os.environ.get("SOLPAY_ML") == "on" else None
    return PlacementService(store, PlacementEngine(store.load_catalog(), Priors.load(priors_path), Params(), model,
                                                   models))


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


_DEFAULT = object()


def create_app(service: PlacementService | None = None, chat_client=_DEFAULT) -> FastAPI:
    """chat_client: OpenAI 클라이언트 (테스트는 가짜를 넣는다). 기본은 OPENAI_API_KEY 로 만들고, 키가 없으면 예비 답변만 한다."""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        from engine.chat.agent import ChatAgent, openai_client
        from engine.chat.page_copy import CopySettings, PageCopyWriter
        from engine.chat.report_copy import ReportCopyWriter
        app.state.service = service or build_service()
        client = openai_client() if chat_client is _DEFAULT else chat_client
        app.state.chat = ChatAgent(app.state.service, client)
        app.state.page_writer = PageCopyWriter(client, CopySettings.from_env())
        app.state.report_writer = ReportCopyWriter(client, CopySettings.from_env(ReportCopyWriter.settings_env))
        store = app.state.service.store
        purge = None
        if getattr(store, "purge_daily", False):          # DB 저장소: 지난 일정은 요청 밖에서 지운다 (engine/jobs.py)
            await asyncio.to_thread(purge_past_schedules, store)    # 첫 요청 전에 한 번
            purge = asyncio.create_task(daily_purge(store))
        try:
            yield
        finally:
            if purge is not None:
                purge.cancel()
                with suppress(asyncio.CancelledError):
                    await purge
            if service is None and hasattr(store, "close"):   # 앱이 만든 저장소만 닫는다 (연결 풀 반납)
                store.close()

    app = FastAPI(title="SOL페이 카드 배치 엔진", version="0.1.0", lifespan=lifespan)

    def current(request: Request) -> PlacementService:
        return request.app.state.service

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/dev", include_in_schema=False, response_class=HTMLResponse)
    def dev_console(svc: PlacementService = Depends(current)) -> str:
        """개발용 테스트 화면: 카드 배치·챗봇·추천 페이지를 브라우저에서 눌러 본다. 내부 API 를 그대로 부른다
        (SOLPAY_INTERNAL_TOKEN 을 켰으면 화면의 설정에 토큰을 넣어야 한다)."""
        from engine.chat.agent import CHIPS
        html = (Path(__file__).parent / "static" / "dev_console.html").read_text(encoding="utf-8")
        categories = {k: v for k, v in svc.engine.catalog.category_names.items() if k != "ALL"}
        return (html.replace("/*CATEGORIES*/{}", json.dumps(categories, ensure_ascii=False))
                .replace("/*CHIPS*/[]", json.dumps(list(CHIPS), ensure_ascii=False)))

    @app.post("/internal/rank", response_model=RankResponse, dependencies=[Depends(check_token)])
    def rank(body: RankBody, svc: PlacementService = Depends(current)):
        at = (body.at or datetime.now(KST)).astimezone(KST)
        req = RankRequest(body.user_id, at)
        try:
            recommendation_id, result = svc.rank(req)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        return RankResponse(
            recommendation_id=recommendation_id,
            cards=[CardBody(user_card_id=c.user_card_id, rank=c.rank, score_won=c.score_won, message=c.message)
                   for c in result.cards],
            display_count=result.display_count,
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
        return {"user_id": u.user_id}

    def _schedule_out(items) -> list[dict]:
        return [{"start": i.start.strftime("%H:%M"), "end": i.end.strftime("%H:%M"), "category": i.category,
                 "amount": i.amount} for i in items]

    @app.put("/internal/users/{user_id}/schedules/{day}", dependencies=[Depends(check_token)])
    def put_schedule(user_id: int, day: date, body: ScheduleBody, at: datetime | None = None,
                     svc: PlacementService = Depends(current)) -> dict:
        """하루 일정을 통째로 저장한다 (빈 목록이면 지운다). 그날이 지나면 엔진이 지운다."""
        try:
            items = svc.put_schedule(user_id, day, [i.model_dump() for i in body.items],
                                     (at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {"day": day.isoformat(), "items": _schedule_out(items)}

    @app.get("/internal/users/{user_id}/schedules/{day}", dependencies=[Depends(check_token)])
    def get_schedule(user_id: int, day: date, svc: PlacementService = Depends(current)) -> dict:
        return {"day": day.isoformat(), "items": _schedule_out(svc.store.schedules(user_id, day))}

    @app.delete("/internal/users/{user_id}/schedules/{day}", dependencies=[Depends(check_token)])
    def delete_schedule(user_id: int, day: date, svc: PlacementService = Depends(current)) -> dict:
        try:
            svc.store.put_schedule(user_id, day, [])
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        svc.forget_day(user_id, day)
        return {"day": day.isoformat(), "items": []}

    @app.post("/internal/users/{user_id}/recommendation-page", dependencies=[Depends(check_token)])
    def recommendation_page(user_id: int, body: AtBody, request: Request,
                            svc: PlacementService = Depends(current)) -> dict:
        """맞춤 추천 페이지 (일정 저장·건너뛰기 뒤). tabs: card(아직 없는 신한카드) / merchant(프로모션 가맹점).
        카드날(마지막 카드 추천 3일 뒤)은 두 탭, 그 외 날은 가맹점 탭, 프로모션이 없으면 카드 탭. 비면 페이지를 건너뛴다.
        카드·금액은 엔진 계산, 문구는 OpenAI (실패하면 정해진 문구 copy_source=template, 탭이 비면 none). 같은 날 다시 부르면 cached=true."""
        try:
            return svc.recommendation_page(user_id, (body.at or datetime.now(KST)).astimezone(KST),
                                           request.app.state.page_writer)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/users/{user_id}/monthly-report", dependencies=[Depends(check_token)])
    def monthly_report(user_id: int, request: Request, at: datetime | None = None,
                       svc: PlacementService = Depends(current)) -> dict:
        """월간 카드 리포트. 이번 달(at 이 속한 달, at 까지)·지난달 카드별 실적·혜택, 배치 전략과 근거,
        지난달 SOL페이 효과(결제화면 결제를 추천 1순위 카드로 냈다면: 카드 혜택·프로모션·이번 달 혜택 추정 차이와 이유),
        요약 문장(summary): headline 은 OpenAI 가 쓰고, points(카드 숫자 요점)는 엔진이 쓴 후보 문장 중 OpenAI 가 고른 1~2개
        (실패하면 정해진 문구 copy_source=template), effect(SOL페이 효과와 이유)·strategy(방식·고른 근거·지금 기본 카드)는
        엔진이 쓴 정해진 문장. 숫자와 숫자가 든 문장은 모두 엔진.
        같은 날 다시 부르면 cached=true."""
        try:
            return svc.monthly_report(user_id, (at or datetime.now(KST)).astimezone(KST),
                                      request.app.state.report_writer)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.post("/internal/users/{user_id}/card-recommendation", dependencies=[Depends(check_token)])
    def card_recommendation(user_id: int, body: AtBody, svc: PlacementService = Depends(current)) -> dict:
        """신규 카드 추천. 계기(일정·특수 업종 방문·반복 소비·3일 간격)가 없거나 이득이 작으면 recommend=false."""
        try:
            return svc.recommend_card(user_id, (body.at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.post("/internal/users/{user_id}/schedule-popup", dependencies=[Depends(check_token)])
    def schedule_popup(user_id: int, body: AtBody, svc: PlacementService = Depends(current)) -> dict:
        """일정 저장 뒤 팝업 (설계서 v4.1). 3일마다 카드 추천(kind=card), 그 외의 날은 일정에 맞는 프로모션 추천
        (kind=promotion, offers 최대 2건). 둘 다 없으면 kind=none. 프로모션을 추천한 일정 시간에는 그 신한카드가 1순위다."""
        try:
            return svc.schedule_popup(user_id, (body.at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/users/{user_id}/strategy", dependencies=[Depends(check_token)])
    def strategy(user_id: int, at: datetime | None = None, svc: PlacementService = Depends(current)) -> dict:
        """이번 달 실적 채우기 방식과 고른 근거 (화면·챗봇 표시용)."""
        try:
            return svc.monthly_strategy(user_id, (at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/users/{user_id}/missed-benefit", dependencies=[Depends(check_token)])
    def missed(user_id: int, at: datetime | None = None, days: int = 365,
               svc: PlacementService = Depends(current)) -> list[dict]:
        """연말정산 안내: 지난 기간에 각 신한카드가 있었다면 더 받았을 금액 (상위 3장)."""
        try:
            return svc.missed_benefit(user_id, (at or datetime.now(KST)).astimezone(KST), days)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.post("/internal/users/{user_id}/strategy/initialize", dependencies=[Depends(check_token)])
    def initialize_strategy(user_id: int, at: datetime | None = None, svc: PlacementService = Depends(current)):
        try:
            return svc.initialize_strategy(user_id, (at or datetime.now(KST)).astimezone(KST))
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        except NotImplementedError as e:
            raise HTTPException(status_code=501, detail=str(e))

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
            return svc.evaluate_payment(body.user_id, at, body.category_code, body.amount, body.user_card_id,
                                        body.merchant_id)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")

    @app.get("/internal/merchants", dependencies=[Depends(check_token)])
    def merchants(zone: str | None = None, svc: PlacementService = Depends(current)) -> list[dict]:
        catalog = svc.engine.catalog
        return [{"merchant_id": m.merchant_id, "name": m.name, "category_code": m.category,
                 "category_name": catalog.category_name(m.category), "zone": m.zone}
                for m in catalog.merchants.values()
                if not m.is_online and (zone is None or m.zone == zone)]

    @app.post("/internal/dev/reset", dependencies=[Depends(check_token)])
    def reset(svc: PlacementService = Depends(current)) -> dict:
        """로컬 시연용. 시연 중 더한 결제, 규칙, 일정, 카드 추천 기록을 지운다."""
        try:
            svc.store.reset()
        except NotImplementedError:
            raise HTTPException(status_code=405, detail="운영 저장소는 초기화할 수 없습니다")
        svc.popups.clear()
        svc.pages.clear()
        svc.reports.clear()
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
        svc.forget_reports(user_id)                 # 규칙이 바뀌면 월간 리포트(전략·효과)를 다시 계산한다
        return {"saved": len(rules)}

    @app.post("/internal/chat", response_model=ChatResponse, dependencies=[Depends(check_token)])
    def chat(body: ChatBody, request: Request) -> dict:
        """질문 하나에 답한다 (최대 15초). FastAPI 는 세션을 기억하지 않고 DB 에 쓰지 않는다."""
        at = (body.at or datetime.now(KST)).astimezone(KST)
        try:
            out = request.app.state.chat.answer(body.user_id, body.message, at,
                                                [t.model_dump() for t in body.history],
                                                body.screen.model_dump() if body.screen else None)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        draft = out.get("rule_draft")
        save = getattr(request.app.state.service.store, "save_draft", None)
        if draft and save is not None:     # Spring 이 붙기 전까지 초안을 개인 DB(app.chat_rule_drafts)에 '대기'로 둔다
            draft["draft_id"] = save(body.user_id, body.session_id, draft["rule"], draft["summary"])
            for block in out["blocks"]:
                if block.get("type") == "rule_card":
                    block["draft_id"] = draft["draft_id"]
        return out

    @app.post("/internal/rules/validate", dependencies=[Depends(check_token)])
    def validate_rule(body: RuleValidateBody, svc: PlacementService = Depends(current)) -> dict:
        """Spring 이 규칙 초안을 저장하기 직전에 다시 검사한다 (그사이 카드를 지웠으면 여기서 걸린다)."""
        from engine.chat.tools import rule_summary
        try:
            cards = svc.store.context(body.user_id, datetime.now(KST)).cards
            parse_rule(body.rule)
        except UnknownUser:
            raise HTTPException(status_code=404, detail="없는 사용자입니다")
        except RuleError as e:
            raise HTTPException(status_code=422, detail=str(e))
        owned = {c.user_card_id for c in cards}
        missing = [i for i in (body.rule.get("target") or {}).get("user_card_ids") or [] if i not in owned]
        if missing:
            raise HTTPException(status_code=422, detail=f"보유하지 않은 카드가 있습니다: {missing}")
        names = {c.user_card_id: svc.engine.catalog.card_label(c.card_id) for c in cards}
        return {"valid": True, "summary": rule_summary(body.rule, names)}

    def _pending_draft(svc: PlacementService, draft_id: int, user_id: int) -> dict:
        get = getattr(svc.store, "draft", None)
        draft = get(draft_id) if get is not None else None
        if draft is None or draft["user_id"] != user_id:
            raise HTTPException(status_code=404, detail="없는 규칙 초안입니다")
        if draft["status"] != "pending":
            raise HTTPException(status_code=409, detail=f"이미 처리한 초안입니다 ({draft['status']})")
        return draft

    @app.post("/internal/rules/drafts/{draft_id}/confirm", dependencies=[Depends(check_token)])
    def confirm_draft(draft_id: int, body: DraftDecisionBody, svc: PlacementService = Depends(current)) -> dict:
        """규칙 카드의 '저장'. 다시 검사한 뒤 규칙에 더한다 (Spring 이 붙으면 Spring 의 confirm API 가 이 일을 한다)."""
        draft = _pending_draft(svc, draft_id, body.user_id)
        result = validate_rule(RuleValidateBody(user_id=body.user_id, rule=draft["rule"]), svc)
        rule_id = svc.store.add_rule(body.user_id, draft["rule"])
        svc.store.decide_draft(draft_id, "saved")
        svc.forget_reports(body.user_id)
        return {"saved": True, "draft_id": draft_id, "rule_id": rule_id, "summary": result["summary"]}

    @app.post("/internal/rules/drafts/{draft_id}/cancel", dependencies=[Depends(check_token)])
    def cancel_draft(draft_id: int, body: DraftDecisionBody, svc: PlacementService = Depends(current)) -> dict:
        _pending_draft(svc, draft_id, body.user_id)
        svc.store.decide_draft(draft_id, "cancelled")
        return {"cancelled": True, "draft_id": draft_id}

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
        svc.forget_reports(body.user_id)            # 결제가 늘면 월간 리포트 숫자를 다시 계산한다
        return {"saved": True}

    return app


app = create_app()
