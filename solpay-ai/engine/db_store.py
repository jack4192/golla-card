"""로컬 개인 DB(PostgreSQL) 저장소 (2026-11-19 결정). 나중에 팀원과 합친 공동 DB 에도 접속 주소만 바꿔 쓴다.

- 읽기: 팀 DB 23개 표(public, 카드서비스_DB_1년 schema.sql). 카드·혜택·가맹점·행사·업종은 서버 시작 때 한 번 읽고,
  사용자·보유 카드·결제는 요청마다 그 사용자 것만 SQL 로 읽는다 (최근 HISTORY_DAYS 일).
- 쓰기: app 스키마(sql/002_app.sql)의 규칙·규칙 초안·실적 채우기 방식·추천 기록·일정·신규 카드 추천 기록·시연 결제.
  팀 23개 표에는 쓰지 않는다. Spring 이 붙으면 app 표를 Spring 표로 옮긴다.
- 표를 엔진 값으로 바꾸는 규칙은 engine/team_db.py (CSV 저장소)와 같다. tests/test_db_store.py 가 두 저장소를 대조한다.
"""

import json
import logging
import os
import re
from dataclasses import replace
from datetime import datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import pandas as pd
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from engine.catalog import Catalog
from engine.crypto import DataCipher, load_cipher
from engine.domain import Payment, ScheduleItem, User, UserCard
from engine.params import SELECTABLE, STRATEGIES
from engine.rules import parse_rule
from engine.store import UnknownUser, UserContext
from engine.team_db import (CardMap, PostgresSource, _merchants, brand_alias_index, load_cards, load_promotions)

KST = ZoneInfo("Asia/Seoul")
HISTORY_DAYS = 400                   # 월간 맞춤 6개월·업종 이력이 잘리지 않게 1년 남짓 (pg_store 와 같다)
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1", "")
APP_TABLES = ("user_rules", "chat_rule_drafts", "strategy_selections", "recommendation_logs", "schedules",
              "card_recommendations", "demo_payments")


def _ident(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        raise ValueError(f"스키마 이름이 올바르지 않습니다: {name}")
    return name


def _naive_kst(at: datetime) -> datetime:
    """팀 DB TIMESTAMP 는 시간대 없는 한국 시각이다."""
    return at.astimezone(KST).replace(tzinfo=None) if at.tzinfo else at


def _aware(v: datetime | None) -> datetime | None:
    if v is None:
        return None
    return v.replace(tzinfo=KST) if v.tzinfo is None else v.astimezone(KST)


log = logging.getLogger("solpay.db_store")


class AppSchemaMissing(RuntimeError):
    pass


class TeamDbPgStore:
    purge_daily = True          # 지난 일정은 요청 밖 하루 작업이 지운다 (engine/jobs.py)

    def __init__(self, url: str, schema: str = "public", app: str = "app", card_map: CardMap | None = None):
        self.url = url
        self.s, self.a = _ident(schema), _ident(app)
        self.source = PostgresSource(url, schema)
        self.cmap = card_map or CardMap.load()
        self.catalog: Catalog | None = None
        self.promotions: list = []
        self.merchant_key: dict[tuple[str, str], int] = {}
        self.benefit_start: str | None = None
        self.strategy_store = PgStrategyStore(self)
        # 연결 풀 (2026-11-20): 원격 공용 DB 는 접속마다 수십 ms 가 들어 결제 화면 0.8초 제한을 넘길 수 있다.
        # 접속을 재사용하고, 꺼내 줄 때 살아 있는지 확인한다 (클라우드 DB 가 놀던 연결을 끊는 경우).
        timeout = float(os.environ.get("SOLPAY_DB_POOL_TIMEOUT", "5"))
        self._pool = ConnectionPool(
            url, min_size=1, max_size=int(os.environ.get("SOLPAY_DB_POOL_MAX", "10")), timeout=timeout,
            kwargs={"row_factory": dict_row, "autocommit": True},
            check=ConnectionPool.check_connection, name="solpay-ai", open=True)
        try:
            self._pool.wait(timeout=timeout)       # DB 가 꺼져 있으면 여기서 바로 실패한다 (PoolTimeout)
            self._check_app_schema()
        except Exception:
            self._pool.close()
            raise

    def _connect(self):
        return self._pool.connection()

    def close(self) -> None:
        self._pool.close()

    def _check_app_schema(self) -> None:
        with self._connect() as c:
            found = {r["table_name"] for r in c.execute(
                "select table_name from information_schema.tables where table_schema = %s", (self.a,)).fetchall()}
        missing = [t for t in APP_TABLES if t not in found]
        if missing:
            raise AppSchemaMissing(f"{self.a} 스키마에 {missing} 표가 없습니다. "
                                   "`uv run python -m scripts.setup_local_db` 로 만드세요.")

    @property
    def is_local(self) -> bool:
        return (urlparse(self.url).hostname or "") in LOCAL_HOSTS

    # ---------- 시작 때 한 번 ----------
    def load_catalog(self) -> Catalog:
        src, s = self.source, self.s
        cards = load_cards(src, self.cmap)
        with self._connect() as c:
            rows = c.execute(
                f"select p.merchant_name, p.category, avg(case when d.channel = 'online' then 1.0 else 0 end) > 0.5 "
                f"as online from {s}.payments p left join {s}.payment_details d on d.payment_id = p.payment_id "
                f"group by 1, 2").fetchall()
            first = c.execute(f"select min(paid_at) as first from {s}.payments").fetchone()["first"]
        online = pd.Series({(r["merchant_name"], r["category"]): bool(r["online"]) for r in rows}, dtype=bool)
        if len(online):
            online.index = pd.MultiIndex.from_tuples(online.index, names=["merchant_name", "category"])
        merchants, self.merchant_key = _merchants(src, online, self.cmap)
        categories = src.read("categories")
        catalog = Catalog(cards, merchants, dict(zip(categories.category, categories.category_name)))
        catalog.aliases = brand_alias_index(src, self.cmap)
        self.catalog = catalog
        self.promotions = load_promotions(src, catalog, self.cmap)
        if first is not None:   # 데이터 첫 달은 전월 실적이 없어 혜택 없이 실적만 쌓는다 (CSV 저장소의 2025-12 와 같다)
            y, m = (first.year + (first.month == 12), first.month % 12 + 1)
            self.benefit_start = f"{y}-{m:02d}"
        return catalog

    def merchant_for(self, name: str, category: str) -> int | None:
        return self.merchant_key.get((name, category))

    # ---------- 요청마다 ----------
    def user(self, user_id: int) -> User:
        with self._connect() as c:
            row = c.execute(f"select user_id from {self.s}.users where user_id = %s", (user_id,)).fetchone()
        if row is None:
            raise UnknownUser(user_id)
        return User(int(row["user_id"]))

    def _cards(self, c, user_id: int) -> list[UserCard]:
        rows = c.execute(
            f"select uc.user_card_id, uc.card_id, k.issuer, d.display_order, d.exclude_from_placement "
            f"from {self.s}.user_cards uc join {self.s}.cards k on k.card_id = uc.card_id "
            f"left join {self.s}.user_card_details d on d.user_card_id = uc.user_card_id "
            f"where uc.user_id = %s order by d.display_order nulls last, uc.user_card_id", (user_id,)).fetchall()
        return [UserCard(int(r["user_card_id"]), int(r["card_id"]), self.cmap.issuer(r["issuer"]),
                         int(r["display_order"]) if r["display_order"] is not None else 99,
                         bool(r["exclude_from_placement"])) for r in rows]

    def _payments(self, c, user_id: int, since: datetime, at: datetime) -> list[Payment]:
        rows = c.execute(
            f"select p.payment_id, p.user_card_id, p.merchant_name, p.category, p.amount, p.paid_at, p.promotion_amount, "
            f"coalesce(d.channel, 'offline_qr') as channel, coalesce(d.card_select_mode, 'manual') as card_select_mode, "
            f"d.synced_at from {self.s}.payments p join {self.s}.user_cards uc on uc.user_card_id = p.user_card_id "
            f"left join {self.s}.payment_details d on d.payment_id = p.payment_id "
            f"where uc.user_id = %s and p.paid_at >= %s and p.paid_at <= %s",
            (user_id, _naive_kst(since), _naive_kst(at))).fetchall()
        out = [Payment(int(r["payment_id"]), user_id, int(r["user_card_id"]),
                       self.merchant_key.get((r["merchant_name"], r["category"])), r["category"], r["channel"],
                       r["card_select_mode"], int(r["amount"]), _aware(r["paid_at"]), _aware(r["synced_at"]),
                       int(r["promotion_amount"] or 0))             # 실제로 받은 프로모션 (월간 리포트 효과의 실제 쪽)
               for r in rows]
        demo = c.execute(
            f"select * from {self.a}.demo_payments where user_id = %s and paid_at >= %s and paid_at <= %s",
            (user_id, since, at)).fetchall()
        out += [Payment(int(r["payment_id"]), user_id, int(r["user_card_id"]), r["merchant_id"], r["category"],
                        r["channel"], r["card_select_mode"], int(r["amount"]), _aware(r["paid_at"]),
                        _aware(r["synced_at"])) for r in demo]
        return sorted(out, key=lambda p: (p.paid_at, p.payment_id))

    def context(self, user_id: int, at: datetime) -> UserContext:
        if self.catalog is None:
            self.load_catalog()
        since = at - timedelta(days=HISTORY_DAYS)
        with self._connect() as c:
            if c.execute(f"select 1 from {self.s}.users where user_id = %s", (user_id,)).fetchone() is None:
                raise UnknownUser(user_id)
            cards = self._cards(c, user_id)
            payments = self._payments(c, user_id, since, at)
            rules = c.execute(f"select rule_id, rule, created_seq, created_at from {self.a}.user_rules "
                              f"where user_id = %s and active order by created_seq, rule_id", (user_id,)).fetchall()
            last = c.execute(f"select base_card from {self.a}.recommendation_logs where user_id = %s "
                             f"order by recommendation_id desc limit 1", (user_id,)).fetchone()
        return UserContext(
            User(user_id), cards, [p for p in payments if p.visible_at <= at],
            [replace(parse_rule(r["rule"], int(r["rule_id"]), r["created_seq"]), created_at=_aware(r["created_at"]))
             for r in rules],
            promotions=[p for p in self.promotions if p.active(at)],
            last_base=int(last["base_card"]) if last and last["base_card"] is not None else None,
            benefit_start=self.benefit_start, schedules=self.schedules_or_empty(user_id, at.date()))

    # ---------- 추천 기록 ----------
    def log_recommendation(self, record: dict) -> int:
        with self._connect() as c:
            row = c.execute(
                f"insert into {self.a}.recommendation_logs (user_id, recommended_at, version, scenario_mode, base_card,"
                f" scenarios, scores, ranking, display_count, reason_code, messages, swapped, rule_applied)"
                f" values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning recommendation_id",
                (record["user_id"], record["at"], record["version"], record["scenario_mode"], record["base_card"],
                 json.dumps(record["scenarios"], ensure_ascii=False), json.dumps(record["scores"]),
                 json.dumps(record["ranking"]), record["display_count"], record["reason_code"],
                 json.dumps(record.get("messages") or {}, ensure_ascii=False), record.get("swapped"),
                 record.get("rule_applied"))).fetchone()
        return int(row["recommendation_id"])

    def recommendation(self, user_id: int, recommendation_id: int) -> dict | None:
        with self._connect() as c:
            r = c.execute(f"select * from {self.a}.recommendation_logs where recommendation_id = %s and user_id = %s",
                          (recommendation_id, user_id)).fetchone()
        if r is None:
            return None
        return {"user_id": r["user_id"], "at": r["recommended_at"], "version": r["version"],
                "scenario_mode": r["scenario_mode"], "base_card": r["base_card"], "scenarios": r["scenarios"],
                "scores": r["scores"], "ranking": r["ranking"], "display_count": r["display_count"],
                "reason_code": r["reason_code"], "messages": r["messages"] or {}, "swapped": r["swapped"],
                "rule_applied": r["rule_applied"]}

    # ---------- 규칙·규칙 초안 ----------
    def raw_rules(self, user_id: int) -> list[dict]:
        self.user(user_id)
        with self._connect() as c:
            rows = c.execute(f"select rule_id, rule from {self.a}.user_rules where user_id = %s and active "
                             f"order by created_seq, rule_id", (user_id,)).fetchall()
        return [{**r["rule"], "rule_id": int(r["rule_id"])} for r in rows]

    def save_rules(self, user_id: int, rules: list[dict]) -> None:
        """규칙을 통째로 바꾼다 (시연용 PUT). 지난 규칙은 지우지 않고 active=false 로 남긴다."""
        for i, r in enumerate(rules):
            parse_rule(r, i + 1, i)
        with self._connect() as c, c.transaction():
            if c.execute(f"select 1 from {self.s}.users where user_id = %s", (user_id,)).fetchone() is None:
                raise UnknownUser(user_id)
            c.execute(f"update {self.a}.user_rules set active = false where user_id = %s", (user_id,))
            for i, rule in enumerate(rules):
                rule = {k: v for k, v in rule.items() if k != "rule_id"}
                c.execute(f"insert into {self.a}.user_rules (user_id, rule, created_seq) values (%s, %s, %s)",
                          (user_id, json.dumps(rule, ensure_ascii=False), i))

    def add_rule(self, user_id: int, rule: dict) -> int:
        parse_rule(rule)
        with self._connect() as c:
            row = c.execute(
                f"insert into {self.a}.user_rules (user_id, rule, created_seq) select %s, %s, "
                f"coalesce(max(created_seq) + 1, 0) from {self.a}.user_rules where user_id = %s returning rule_id",
                (user_id, json.dumps(rule, ensure_ascii=False), user_id)).fetchone()
        return int(row["rule_id"])

    def save_draft(self, user_id: int, session_id: str | None, rule: dict, summary: str) -> int:
        with self._connect() as c:
            row = c.execute(f"insert into {self.a}.chat_rule_drafts (user_id, session_id, rule, summary) "
                            f"values (%s, %s, %s, %s) returning draft_id",
                            (user_id, session_id, json.dumps(rule, ensure_ascii=False), summary[:200])).fetchone()
        return int(row["draft_id"])

    def draft(self, draft_id: int) -> dict | None:
        with self._connect() as c:
            r = c.execute(f"select * from {self.a}.chat_rule_drafts where draft_id = %s", (draft_id,)).fetchone()
        return dict(r) if r else None

    def decide_draft(self, draft_id: int, status: str) -> None:
        with self._connect() as c:
            c.execute(f"update {self.a}.chat_rule_drafts set status = %s, decided_at = now() where draft_id = %s",
                      (status, draft_id))

    # ---------- 하루 일정: 암호문으로만 저장하고 지난 날은 지운다 ----------
    @property
    def cipher(self) -> DataCipher:
        if getattr(self, "_cipher", None) is None:
            self._cipher = load_cipher()
        return self._cipher

    def put_schedule(self, user_id: int, day, items: list[ScheduleItem]) -> None:
        self.user(user_id)
        payload = [{"start": i.start.isoformat(), "end": i.end.isoformat(), "category": i.category,
                    "amount": i.amount, "brand": i.brand} for i in items]
        with self._connect() as c, c.transaction():
            c.execute(f"delete from {self.a}.schedules where user_id = %s and day = %s", (user_id, day))
            if payload:
                c.execute(f"insert into {self.a}.schedules (user_id, day, payload) values (%s, %s, %s)",
                          (user_id, day, self.cipher.encrypt({"items": payload})))

    def schedules(self, user_id: int, day) -> list[ScheduleItem]:
        with self._connect() as c:
            row = c.execute(f"select payload from {self.a}.schedules where user_id = %s and day = %s",
                            (user_id, day)).fetchone()
        if row is None:
            return []
        items = self.cipher.decrypt(bytes(row["payload"]))["items"]
        return [ScheduleItem(i + 1, user_id, datetime.fromisoformat(x["start"]), datetime.fromisoformat(x["end"]),
                             x["category"], int(x["amount"]), x.get("brand")) for i, x in enumerate(items)]

    def schedules_or_empty(self, user_id: int, day) -> list[ScheduleItem]:
        """배치용 일정. 읽지 못하면(암호 키가 바뀜, 값이 깨짐) 일정이 없는 것으로 보고 소비 패턴으로 배치하게 한다
        (2026-11-22 사용자 결정: 추천은 계속 주기). 일정 조회 API 는 schedules 를 그대로 써서 오류를 알린다."""
        try:
            return self.schedules(user_id, day)
        except Exception:
            log.warning("일정을 읽지 못해 일정 없이 배치합니다 (user_id=%s, day=%s)", user_id, day, exc_info=True)
            return []

    def purge_schedules(self, today) -> int:
        with self._connect() as c:
            return c.execute(f"delete from {self.a}.schedules where day < %s", (today,)).rowcount

    # ---------- 신규 카드 추천 기록 ----------
    def recommendation_history(self, user_id: int) -> list[dict]:
        with self._connect() as c:
            rows = c.execute(f"select * from {self.a}.card_recommendations where user_id = %s order by recommended_at",
                             (user_id,)).fetchall()
        return [{"user_id": r["user_id"], "at": _aware(r["recommended_at"]), "card_id": r["card_id"],
                 "trigger": r["trigger"], "gain": r["gain"]} for r in rows]

    def log_card_recommendation(self, record: dict) -> None:
        with self._connect() as c:
            c.execute(f"insert into {self.a}.card_recommendations (user_id, recommended_at, card_id, trigger, gain)"
                      f" values (%s, %s, %s, %s, %s)",
                      (record["user_id"], record["at"], record["card_id"], record["trigger"], record["gain"]))

    # ---------- 시연 ----------
    def add_payment(self, payment: Payment) -> None:
        """로컬 시연(가상 POS) 결제. 팀 payments 표가 아니라 app.demo_payments 에 쓴다. 같은 번호는 한 번만."""
        with self._connect() as c:
            if c.execute(f"select 1 from {self.s}.users where user_id = %s", (payment.user_id,)).fetchone() is None:
                raise UnknownUser(payment.user_id)
            c.execute(
                f"insert into {self.a}.demo_payments (payment_id, user_id, user_card_id, merchant_id, category, channel,"
                f" card_select_mode, amount, paid_at, synced_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                f" on conflict (payment_id) do nothing",
                (payment.payment_id, payment.user_id, payment.user_card_id, payment.merchant_id, payment.category,
                 payment.channel, payment.card_select_mode, payment.amount, payment.paid_at, payment.synced_at))

    def reset(self) -> None:
        """시연 중 쓴 것(app 표)을 모두 지운다. 공동 DB 에서는 막는다 (접속 주소가 이 컴퓨터일 때만)."""
        if not self.is_local:
            raise NotImplementedError("공동 DB 는 초기화할 수 없습니다")
        with self._connect() as c:
            c.execute(f"truncate {', '.join(f'{self.a}.{t}' for t in APP_TABLES)} restart identity")


class PgStrategyStore:
    """실적 채우기 방식 저장 (engine.strategy_store.StrategyStore 와 같은 모양, app.strategy_selections)."""

    def __init__(self, store: TeamDbPgStore):
        self.store = store

    def get(self, user_id: int) -> dict | None:
        with self.store._connect() as c:
            r = c.execute(f"select * from {self.store.a}.strategy_selections where user_id = %s", (user_id,)).fetchone()
        if r is None:
            return None
        return {"strategy": r["strategy"], "source": r["source"], "updated_at": r["updated_at"].isoformat(),
                "metadata": r["metadata"]}

    def initialize(self, user_id: int, strategy: str, metadata: dict | None = None) -> dict:
        if strategy not in STRATEGIES:
            raise ValueError("유효하지 않은 방식입니다")
        with self.store._connect() as c:
            c.execute(f"insert into {self.store.a}.strategy_selections (user_id, strategy, source, metadata) "
                      f"values (%s, %s, 'initial', %s) on conflict (user_id) do nothing",
                      (user_id, strategy, json.dumps(metadata, ensure_ascii=False, default=str) if metadata else None))
        return self.get(user_id)

    def confirm_change(self, user_id: int, strategy: str) -> dict:
        if strategy not in SELECTABLE:
            raise ValueError("유효하지 않은 방식입니다")
        with self.store._connect() as c:
            c.execute(f"insert into {self.store.a}.strategy_selections (user_id, strategy, source) "
                      f"values (%s, %s, 'confirmed') on conflict (user_id) do update set strategy = excluded.strategy, "
                      f"source = excluded.source, metadata = null, updated_at = now()", (user_id, strategy))
        return self.get(user_id)
