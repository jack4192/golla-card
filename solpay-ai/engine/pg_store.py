"""PostgreSQL 저장소. 스키마는 sql/001_placement.sql 을 쓴다.

엔진은 결제를 쓰지 않고 읽기만 한다. 결제 저장과 실적 갱신은 Spring 이 맡는다.
"""

import json
from datetime import datetime, timedelta

import psycopg
from psycopg.rows import dict_row

from engine.catalog import Catalog, build_card
from engine.domain import Merchant, Payment, Promotion, User, UserCard, UserWeights
from engine.rules import parse_rule
from engine.store import UnknownUser, UserContext

HISTORY_DAYS = 190      # 패턴 학습에 쓰는 기간. 요청마다 이 기간의 결제로 상태를 만든다


class PostgresStore:
    def __init__(self, url: str):
        self.url = url

    def _connect(self):
        return psycopg.connect(self.url, row_factory=dict_row, autocommit=True)

    def load_catalog(self) -> Catalog:
        with self._connect() as c:
            cards = c.execute("select * from placement.card_catalog").fetchall()
            benefits = c.execute("select * from placement.card_benefits").fetchall()
            tiers = c.execute("select * from placement.card_cap_tiers").fetchall()
            merchants = c.execute("select * from placement.merchants").fetchall()
            categories = c.execute("select * from placement.merchant_categories").fetchall()
        by_benefit, by_tier = {}, {}
        for b in benefits:
            b["rate"] = float(b["rate"]) if b["rate"] is not None else None
            by_benefit.setdefault(b["card_id"], []).append(b)
        for t in tiers:
            by_tier.setdefault(t["card_id"], []).append(t)
        return Catalog(
            {r["card_id"]: build_card(r, by_benefit.get(r["card_id"], []), by_tier.get(r["card_id"], [])) for r in cards},
            {m["merchant_id"]: Merchant(m["merchant_id"], m["place_name"], m["category_code"], m["lat"], m["lng"],
                                        m["is_online"], m["zone_code"]) for m in merchants},
            {r["category_code"]: r["category_name"] for r in categories},
        )

    def user(self, user_id: int) -> User:
        with self._connect() as c:
            row = c.execute("select * from placement.users where user_id = %s", (user_id,)).fetchone()
        if row is None:
            raise UnknownUser(user_id)
        return User(row["user_id"], row["loc_consent"], row["loc_feature_on"])

    def set_consent(self, user_id: int, loc_consent: bool, loc_feature_on: bool) -> None:
        with self._connect() as c:
            if c.execute("update placement.users set loc_consent = %s, loc_feature_on = %s where user_id = %s",
                         (loc_consent, loc_feature_on, user_id)).rowcount == 0:
                raise UnknownUser(user_id)

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
        return UserContext(
            user=User(user["user_id"], user["loc_consent"], user["loc_feature_on"]),
            cards=[UserCard(r["user_card_id"], r["card_id"], r["issuer_code"], r["display_order"],
                            r["exclude_from_placement"]) for r in cards],
            payments=[p for p in rows if p.visible_at <= at],
            rules=[parse_rule(r["rule"], r["rule_id"], r["created_seq"]) for r in rules],
            weights=UserWeights(weights["w1"], weights["w2"], weights["switch_threshold"], weights["base_order"])
            if weights else None,
            promotions=[Promotion(p["promotion_id"], p["merchant_id"], p["starts_at"], p["ends_at"], p["card_id"],
                                  p["amount"], float(p["rate"]) if p["rate"] is not None else None,
                                  p["min_amount"], p["title"]) for p in promotions],
            last_base=last["base_card"] if last else None,
        )

    def log_recommendation(self, record: dict) -> int:
        with self._connect() as c:
            row = c.execute(
                "insert into placement.recommendation_logs (user_id, recommended_at, lat, lng, version, scenario_mode,"
                " base_card, chips, scenarios, scores, ranking, display_count, reason_code)"
                " values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning recommendation_id",
                (record["user_id"], record["at"], record["lat"], record["lng"], record["version"],
                 record["scenario_mode"], record["base_card"], json.dumps(record["chips"]),
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
