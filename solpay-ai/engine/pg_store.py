"""PostgreSQL 저장소. 스키마는 sql/001_placement.sql 을 쓴다.

엔진은 결제를 쓰지 않고 읽기만 한다. 결제 저장과 실적 갱신은 Spring 이 맡는다.
"""

import json
from datetime import datetime, timedelta

import psycopg
from psycopg.rows import dict_row

from engine.catalog import Catalog, build_card
from engine.crypto import DataCipher, load_cipher
from engine.domain import Merchant, Payment, ScheduleItem, User, UserCard, UserWeights
from engine.loader import promotion_from_row
from engine.rules import parse_rule
from engine.store import UnknownUser, UserContext

# 요청마다 이 기간의 결제로 상태를 만든다. 재생 평가·parquet 저장소는 전체 이력(1년 데이터)을 쓰므로
# 결과가 같도록 1년 남짓으로 둔다 (2026-11-18, 이전 190일은 4개월 데이터 때 값이라 월간 맞춤 6개월·업종 이력이 잘렸다)
HISTORY_DAYS = 400


class PostgresStore:
    def __init__(self, url: str):
        self.url = url
        self.catalog: Catalog | None = None

    def _connect(self):
        return psycopg.connect(self.url, row_factory=dict_row, autocommit=True)

    def load_catalog(self) -> Catalog:
        with self._connect() as c:
            cards = c.execute("select * from placement.card_catalog").fetchall()
            benefits = c.execute("select * from placement.card_benefits").fetchall()
            tiers = c.execute("select * from placement.card_cap_tiers").fetchall()
            rewards = c.execute("select * from placement.card_rewards").fetchall()
            totals = c.execute("select * from placement.card_total_caps").fetchall()
            merchants = c.execute("select * from placement.merchants").fetchall()
            categories = c.execute("select * from placement.merchant_categories").fetchall()
        by_benefit, by_tier, by_reward, by_total = {}, {}, {}, {}
        for t in totals:
            by_total.setdefault(t["card_id"], []).append(t)
        for b in benefits:
            b["rate"] = float(b["rate"]) if b["rate"] is not None else None
            b["plan_mult"] = float(b["plan_mult"]) if b.get("plan_mult") is not None else None
            by_benefit.setdefault(b["card_id"], []).append(b)
        for t in tiers:
            by_tier.setdefault(t["card_id"], []).append(t)
        for r in rewards:
            by_reward.setdefault(r["card_id"], []).append(r)
        catalog = Catalog(
            {r["card_id"]: build_card(r, by_benefit.get(r["card_id"], []), by_tier.get(r["card_id"], []),
                                      by_reward.get(r["card_id"], []), by_total.get(r["card_id"], [])) for r in cards},
            {m["merchant_id"]: Merchant(m["merchant_id"], m["place_name"], m["category_code"], m["lat"], m["lng"],
                                        m["is_online"], m["zone_code"], m.get("brand"), m.get("brand_code"))
             for m in merchants},
            {r["category_code"]: r["category_name"] for r in categories},
        )
        self.catalog = catalog
        return catalog

    def user(self, user_id: int) -> User:
        with self._connect() as c:
            row = c.execute("select * from placement.users where user_id = %s", (user_id,)).fetchone()
        if row is None:
            raise UnknownUser(user_id)
        return User(row["user_id"])

    # ---------- 하루 일정: 암호문으로만 저장하고 지난 날은 지운다 ----------
    @property
    def cipher(self) -> DataCipher:
        if getattr(self, "_cipher", None) is None:
            self._cipher = load_cipher()
        return self._cipher

    def put_schedule(self, user_id: int, day, items: list[ScheduleItem]) -> None:
        self.user(user_id)
        payload = [{"start": i.start.isoformat(), "end": i.end.isoformat(), "category": i.category,
                    "amount": i.amount} for i in items]
        with self._connect() as c, c.transaction():
            c.execute("delete from placement.schedules where user_id = %s and day = %s", (user_id, day))
            if payload:
                c.execute("insert into placement.schedules (user_id, day, payload) values (%s, %s, %s)",
                          (user_id, day, self.cipher.encrypt({"items": payload})))

    def schedules(self, user_id: int, day) -> list[ScheduleItem]:
        with self._connect() as c:
            row = c.execute("select payload from placement.schedules where user_id = %s and day = %s",
                            (user_id, day)).fetchone()
        if row is None:
            return []
        items = self.cipher.decrypt(row["payload"])["items"]
        return [ScheduleItem(i + 1, user_id, datetime.fromisoformat(x["start"]), datetime.fromisoformat(x["end"]),
                             x["category"], int(x["amount"])) for i, x in enumerate(items)]

    def purge_schedules(self, today) -> int:
        with self._connect() as c:
            return c.execute("delete from placement.schedules where day < %s", (today,)).rowcount

    def recommendation_history(self, user_id: int) -> list[dict]:
        with self._connect() as c:
            rows = c.execute("select * from placement.card_recommendations where user_id = %s "
                             "order by recommended_at", (user_id,)).fetchall()
        return [{"user_id": r["user_id"], "at": r["recommended_at"], "card_id": r["card_id"],
                 "trigger": r["trigger"], "gain": r["gain"]} for r in rows]

    def log_card_recommendation(self, record: dict) -> None:
        with self._connect() as c:
            c.execute("insert into placement.card_recommendations (user_id, recommended_at, card_id, trigger, gain)"
                      " values (%s, %s, %s, %s, %s)",
                      (record["user_id"], record["at"], record["card_id"], record["trigger"], record["gain"]))

    def raw_rules(self, user_id: int) -> list[dict]:
        self.user(user_id)
        with self._connect() as c:
            rows = c.execute("select rule from placement.user_rules where user_id = %s and active order by created_seq",
                             (user_id,)).fetchall()
        return [r["rule"] for r in rows]

    def reset(self) -> None:
        raise NotImplementedError

    def context(self, user_id: int, at: datetime) -> UserContext:
        since = at - timedelta(days=HISTORY_DAYS)
        with self._connect() as c:
            user = c.execute("select * from placement.users where user_id = %s", (user_id,)).fetchone()
            if user is None:
                raise UnknownUser(user_id)
            cards = c.execute("select * from placement.user_cards where user_id = %s order by display_order",
                              (user_id,)).fetchall()
            payments = c.execute(
                "select * from placement.payments where user_id = %s and paid_at >= %s and paid_at <= %s "
                "order by paid_at, payment_id", (user_id, since, at)).fetchall()
            rules = c.execute("select rule_id, rule, created_seq from placement.user_rules "
                              "where user_id = %s and active order by created_seq", (user_id,)).fetchall()
            weights = c.execute("select * from placement.user_weights where user_id = %s", (user_id,)).fetchone()
            promotions = c.execute("select * from placement.promotions where starts_at <= %s and ends_at >= %s",
                                   (at, at)).fetchall()
            last = c.execute("select base_card from placement.recommendation_logs where user_id = %s "
                             "order by recommendation_id desc limit 1", (user_id,)).fetchone()
        rows = [Payment(p["payment_id"], p["user_id"], p["user_card_id"], p["merchant_id"], p["category_code"],
                        p["channel"], p["card_select_mode"], p["amount"], p["paid_at"], p["synced_at"])
                for p in payments]
        self.purge_schedules(at.date())
        return UserContext(
            user=User(user["user_id"]),
            cards=[UserCard(r["user_card_id"], r["card_id"], r["issuer_code"], r["display_order"],
                            r["exclude_from_placement"]) for r in cards],
            payments=[p for p in rows if p.visible_at <= at],
            rules=[parse_rule(r["rule"], r["rule_id"], r["created_seq"]) for r in rules],
            weights=UserWeights(weights["w1"], weights["w2"], weights["switch_threshold"], weights["base_order"])
            if weights else None,
            promotions=[promotion_from_row(p, self.catalog or self.load_catalog()) for p in promotions],
            last_base=last["base_card"] if last else None,
            schedules=self.schedules(user_id, at.date()),
        )

    def log_recommendation(self, record: dict) -> int:
        with self._connect() as c:
            row = c.execute(
                "insert into placement.recommendation_logs (user_id, recommended_at, version, scenario_mode,"
                " base_card, scenarios, scores, ranking, display_count, reason_code)"
                " values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning recommendation_id",
                (record["user_id"], record["at"], record["version"],
                 record["scenario_mode"], record["base_card"],
                 json.dumps(record["scenarios"], ensure_ascii=False), json.dumps(record["scores"]),
                 json.dumps(record["ranking"]), record["display_count"], record["reason_code"])).fetchone()
        return row["recommendation_id"]

    def save_rules(self, user_id: int, rules: list[dict]) -> None:
        with self._connect() as c, c.transaction():
            if c.execute("select 1 from placement.users where user_id = %s", (user_id,)).fetchone() is None:
                raise UnknownUser(user_id)
            c.execute("update placement.user_rules set active = false where user_id = %s", (user_id,))
            for i, rule in enumerate(rules):
                c.execute("insert into placement.user_rules (user_id, rule, created_seq) values (%s, %s, %s)",
                          (user_id, json.dumps(rule, ensure_ascii=False), i))

    def add_payment(self, payment: Payment) -> None:
        raise NotImplementedError
