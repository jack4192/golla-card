"""팀 DB 형식(카드서비스_DB_1년, 23개 표)을 엔진 값으로 바꾼다 (2026-11-19).

지금은 CSV 폴더(`CsvSource`)를 읽고, 나중에 같은 표를 PostgreSQL 에서 읽도록(`PostgresSource`) 출처만 바꾼다.
표 이름과 칸 이름은 팀 DB 명세서(schema.sql) 그대로이며, 엔진이 쓰는 표는 아래와 같다.

| 엔진 값 | 팀 DB 표 |
|---|---|
| 카드·혜택·한도 | cards, card_tiers, benefits, benefit_tiers, benefit_targets, benefit_groups, benefit_group_tiers |
| 업종 이름 | categories |
| 가맹점 | merchants (+ 결제에만 나오는 온라인·동네 가맹점) |
| 사용자·보유 카드 | users, user_cards, user_card_details |
| 결제 | payments, payment_details |
| 행사 | promotions |

카드 코드·카드사 코드·브랜드 표기 규칙은 데이터가 아니라 설정이라 `data/config/card_db_map.yml` 을 읽는다
(생성기 `data/generate/card_db.py` 와 같은 규칙. 두 곳을 함께 고친다).

가맹점 ID: 팀 DB merchants 의 지점은 그 ID 를 그대로 쓴다. 결제(payments.merchant_name)는 브랜드 단위라
(브랜드, 업종)마다 대표 지점 하나로 잇고, 지점이 없는 온라인·동네 가맹점은 VIRTUAL_MERCHANT_START 부터 번호를 붙인다.
"""

import os
import re
from dataclasses import dataclass
from datetime import datetime, time
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

import pandas as pd
import yaml

from engine.benefit_calc import DAYS, Benefit, Card
from engine.catalog import Catalog
from engine.domain import Merchant, Payment, Promotion, User, UserCard
from engine.loader import ROOT, promotion_from_row

KST = ZoneInfo("Asia/Seoul")
KIND = {"DISCOUNT": "discount", "POINT": "point", "CASHBACK": "cashback"}
VIRTUAL_MERCHANT_START = 10_000_001
LOCAL_PREFIX = "동네 "                   # 브랜드 없는 동네 가맹점 (payments.merchant_name '동네 카페' 등)


def team_db_dir() -> Path:
    return Path(os.environ.get("SOLPAY_TEAM_DB_DIR", ROOT.parent / "카드서비스_DB_1년"))


def card_map_path() -> Path:
    return Path(os.environ.get("SOLPAY_CARD_MAP", ROOT.parent / "data" / "config" / "card_db_map.yml"))


# ---------- 출처: 표 이름 → DataFrame ----------

class TableSource(Protocol):
    def read(self, table: str) -> pd.DataFrame: ...


class CsvSource:
    """카드서비스_DB_1년 같은 CSV 폴더 (표 하나 = 파일 하나)."""

    def __init__(self, directory: Path | str | None = None):
        self.directory = Path(directory or team_db_dir())

    def read(self, table: str) -> pd.DataFrame:
        path = self.directory / f"{table}.csv"
        if not path.exists():
            raise FileNotFoundError(f"{path} 가 없습니다. SOLPAY_TEAM_DB_DIR 를 확인하세요.")
        return pd.read_csv(path, encoding="utf-8-sig", low_memory=False)


class PostgresSource:
    """같은 표를 PostgreSQL 에서 읽는다 (schema.sql → load_all.sql 로 적재한 DB). 읽기 전용 계정이면 된다."""

    def __init__(self, url: str, schema: str = "public"):
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
            raise ValueError(f"스키마 이름이 올바르지 않습니다: {schema}")
        self.url, self.schema = url, schema

    def read(self, table: str) -> pd.DataFrame:
        import psycopg
        if not re.fullmatch(r"[a-z_]+", table):
            raise ValueError(f"표 이름이 올바르지 않습니다: {table}")
        with psycopg.connect(self.url) as conn, conn.cursor() as cur:
            cur.execute(f'select * from "{self.schema}"."{table}"')
            cols = [d.name for d in cur.description]
            return pd.DataFrame(cur.fetchall(), columns=cols)


def source_from_env() -> TableSource:
    if os.environ.get("SOLPAY_TEAM_DB_SOURCE", "csv") == "postgres":
        return PostgresSource(os.environ["SOLPAY_DATABASE_URL"], os.environ.get("SOLPAY_TEAM_DB_SCHEMA", "public"))
    return CsvSource()


# ---------- 값 변환 ----------

def _none(v):
    return None if v is None or (not isinstance(v, str) and pd.isna(v)) else v


def _int(v) -> int | None:
    v = _none(v)
    return None if v is None else int(v)


def _float(v) -> float | None:
    v = _none(v)
    return None if v is None else float(v)      # DB 의 NUMERIC 은 Decimal 로 온다


def _days(v) -> tuple[int, ...] | None:
    v = _none(v)
    return None if v is None else tuple(DAYS[d.strip().lower()] for d in str(v).split(","))


def _hour(v) -> int | None:
    v = _none(v)
    return None if v is None else int(str(v).split(":")[0])


def _kst(v) -> datetime | None:
    """팀 DB TIMESTAMP 는 시간대 없는 한국 시각이다."""
    v = _none(v)
    if v is None:
        return None
    ts = pd.Timestamp(v)
    return (ts.tz_localize(KST) if ts.tzinfo is None else ts.tz_convert(KST)).to_pydatetime()


def _bool(v) -> bool:
    v = _none(v)
    if isinstance(v, str):
        return v.strip().lower() in ("true", "t", "1", "y")
    return bool(v)


@dataclass
class CardMap:
    """card_db_map.yml: 카드 코드, 카드사 코드, 해외 대상 제외, 브랜드 표기."""
    card_codes: dict[int, str]
    issuer_codes: dict[str, str]
    kpass_cards: set[str]
    exclude_categories: set[str]
    brand_canonical: dict[str, str]
    brand_aliases: dict[str, str]              # 가맹점 표기 → 브랜드 (card_db_map brand_aliases)
    alias_resolve: dict[str, str]              # 두 브랜드에 걸친 표기를 고정 (SSG닷컴 → SSG.COM 등)

    @classmethod
    def load(cls, path: Path | None = None) -> "CardMap":
        raw = yaml.safe_load(Path(path or card_map_path()).read_text(encoding="utf-8"))
        return cls({int(k): v for k, v in raw["card_codes"].items()},
                   {k: v["code"] for k, v in raw["issuers"].items()},
                   set(raw.get("kpass_cards", [])), set(raw.get("exclude_target_categories", [])),
                   dict(raw.get("brand_canonical") or {}), dict(raw.get("brand_aliases") or {}),
                   dict(raw.get("alias_resolve") or {}))

    def brand(self, name: str) -> str:
        """혜택 대상의 브랜드 표기 (생성기 canonical_brand 와 같다)."""
        return self.brand_canonical.get(name, name)

    def merchant_brand(self, name: str, table_aliases: dict[str, str]) -> str:
        """가맹점·행사의 브랜드 표기 → 결제(payments.merchant_name)와 같은 브랜드 코드.
        팀 DB merchant_aliases → card_db_map brand_aliases → alias_resolve 순서로 덮어쓴다 (생성기 alias_table 과 같은 순서)."""
        key = name.strip()
        out = self.brand(key)
        out = self.brand(table_aliases.get(key, out))
        out = self.brand(self.brand_aliases.get(key, out))
        return self.alias_resolve.get(key, out)

    def issuer(self, label: str) -> str:
        return self.issuer_codes.get(label, label)


def load_cards(src: TableSource, cmap: CardMap) -> dict[int, Card]:
    """혜택 × 구간(benefit_tiers) 한 줄이 계산용 Benefit 한 행 (data/generate/card_db.load_cards 와 같은 규칙)."""
    cards_df, tiers = src.read("cards"), src.read("card_tiers")
    groups, group_tiers = src.read("benefit_groups"), src.read("benefit_group_tiers")
    targets, btiers, benefits = src.read("benefit_targets"), src.read("benefit_tiers"), src.read("benefits")
    skip = cmap.exclude_categories
    has_target = set(targets.benefit_id)
    domestic = set(targets[~targets.category.isin(skip)].benefit_id)
    benefits = benefits[~(benefits.benefit_id.isin(has_target) & ~benefits.benefit_id.isin(domestic))]   # 해외 전용 제외
    tier_min = dict(zip(tiers.tier_id, tiers.min_amount))
    targets_by = {k: g for k, g in targets[~targets.category.isin(skip)].groupby("benefit_id")}
    btiers_by = {k: g for k, g in btiers.groupby("benefit_id")}

    out = {}
    for c in cards_df.sort_values("card_id").itertuples():
        my_tiers = tiers[tiers.card_id == c.card_id].sort_values("tier_no")
        lows = sorted(set(int(x) for x in my_tiers.min_amount))
        next_low = {lo: (lows[i + 1] if i + 1 < len(lows) else None) for i, lo in enumerate(lows)}
        total_caps = tuple((int(t.min_amount), _int(t.total_limit)) for t in my_tiers.itertuples())
        if all(cap is None for _, cap in total_caps):
            total_caps = ()
        cap_tiers = {}
        for g in groups[groups.card_id == c.card_id].itertuples():
            gt = group_tiers[group_tiers.group_id == g.group_id]
            cap_tiers[f"G{g.group_id}"] = tuple(sorted((int(tier_min[t.tier_id]), int(t.monthly_limit))
                                                       for t in gt.itertuples()))
        rows = []
        for r in benefits[benefits.card_id == c.card_id].itertuples():
            mine = targets_by.get(r.benefit_id)
            tgt = () if mine is None else tuple(sorted(
                {(t.category, None if _none(t.merchant_name) is None else cmap.brand(t.merchant_name))
                 for t in mine.itertuples()}, key=lambda x: (x[0], x[1] or "")))
            brands = frozenset(b for _, b in tgt if b is not None) or None
            start, end = _hour(r.time_from), _hour(r.time_to)
            for bt in btiers_by.get(r.benefit_id, pd.DataFrame()).itertuples():
                low = int(tier_min[bt.tier_id])
                value = float(bt.value)
                rows.append(Benefit(
                    benefit_id=int(bt.benefit_tier_id), category=tgt[0][0] if tgt else "*",
                    type=KIND[r.benefit_kind],
                    rate=value / 100 if r.value_type == "RATE" else None,
                    amount=int(value) if r.value_type == "FIXED" else None,
                    per_liter=int(value) if r.value_type == "PER_LITER" else None,
                    min_amount=_int(r.min_pay_amount) or 0, min_prev=low,
                    max_per_tx=_int(bt.per_payment_limit), monthly_count=_int(bt.monthly_count),
                    daily_count=_int(r.daily_count),
                    cap_group=None if _none(r.group_id) is None else f"G{int(r.group_id)}",
                    row_cap=_int(bt.monthly_limit), days=_days(r.days),
                    hours=(start, end) if start is not None and end is not None else None,
                    brands=brands, name=r.benefit_name, targets=tgt or None, max_prev=next_low.get(low),
                    basis="usage" if r.limit_basis == "USAGE" else "benefit",
                    pay=_none(r.pay_type), source_id=int(r.benefit_id),
                ))
        code = cmap.card_codes.get(int(c.card_id), f"CARD_{int(c.card_id)}")
        tags = [c.card_type.lower()] + (["kpass"] if code in cmap.kpass_cards else [])
        out[int(c.card_id)] = Card(
            card_id=int(c.card_id), code=code, issuer=cmap.issuer(c.issuer), name=c.card_name,
            card_type=c.card_type.lower(), tags=tuple(tags), annual_fee=int(c.annual_fee_domestic),
            cap_tiers=cap_tiers, benefits=tuple(sorted(rows, key=lambda b: b.benefit_id)), total_caps=total_caps)
    return out


@dataclass
class TeamData:
    catalog: Catalog
    promotions: list[Promotion]
    users: dict[int, User]
    user_cards: dict[int, list[UserCard]]
    payments: dict[int, list[Payment]]
    merchant_key: dict[tuple[str, str], int]      # (payments.merchant_name, 업종) → 엔진 가맹점 ID
    card_info: pd.DataFrame                        # cards 표 원본 (연회비·설명 등 챗봇 안내용)
    benefit_rows: pd.DataFrame                     # benefits 표 원본 (혜택 이름·설명)


def _table_aliases(src: TableSource) -> dict[str, str]:
    a = src.read("merchant_aliases")
    return {str(k).strip(): str(v).strip() for k, v in zip(a.alias_name, a.brand_name)}


def brand_alias_index(src: TableSource, cmap: CardMap) -> dict[str, str]:
    norm = lambda t: re.sub(r"[\s·\-/()&.,_'\"]", "", str(t)).lower()
    table = _table_aliases(src)
    names = list(table) + list(cmap.brand_aliases) + list(cmap.alias_resolve)
    return {norm(n): cmap.merchant_brand(n, table) for n in names}


def online_share(pays: pd.DataFrame) -> pd.Series:
    """(결제 표기, 업종) → 온라인 결제가 절반을 넘는지. DB 저장소는 같은 값을 SQL 로 구한다."""
    return pays.groupby(["merchant_name", "category"]).channel.agg(lambda s: (s == "online").mean() > 0.5)


def _merchants(src: TableSource, online: pd.Series, cmap: CardMap) -> tuple[dict[int, Merchant], dict]:
    """팀 DB 지점 + 결제에만 나오는 가맹점. (결제 표기, 업종) → 가맹점 ID 도 돌려준다.
    online: (결제 표기, 업종) → 온라인 여부 (online_share)."""
    aliases = _table_aliases(src)
    merchants: dict[int, Merchant] = {}
    key: dict[tuple[str, str], int] = {}
    for m in src.read("merchants").sort_values("merchant_id").itertuples():
        name = str(m.merchant_name)
        brand = None if name.startswith(LOCAL_PREFIX) else cmap.merchant_brand(name, aliases)
        branch = _none(m.branch_name)
        merchants[int(m.merchant_id)] = Merchant(
            int(m.merchant_id), f"{name} {branch}" if branch else name, m.category,
            _float(m.latitude), _float(m.longitude), False, None, name, brand)
        key.setdefault((name, m.category), int(m.merchant_id))
    next_id = VIRTUAL_MERCHANT_START
    for (name, category), is_online in online.sort_index().items():
        if (name, category) in key:
            continue
        brand = None if name.startswith(LOCAL_PREFIX) else cmap.merchant_brand(name, aliases)
        merchants[next_id] = Merchant(next_id, name, category, None, None, bool(is_online), None, name, brand)
        key[(name, category)] = next_id
        next_id += 1
    return merchants, key


def load_team(src: TableSource | None = None, cmap: CardMap | None = None) -> TeamData:
    src = src or source_from_env()
    cmap = cmap or CardMap.load()
    cards = load_cards(src, cmap)
    card_issuer = {int(k): cmap.issuer(v) for k, v in zip(src.read("cards").card_id, src.read("cards").issuer)}

    ucards = src.read("user_cards").merge(src.read("user_card_details"), on="user_card_id", how="left")
    owner = dict(zip(ucards.user_card_id.astype(int), ucards.user_id.astype(int)))
    user_cards: dict[int, list[UserCard]] = {}
    for r in ucards.sort_values(["user_id", "display_order", "user_card_id"]).itertuples():
        user_cards.setdefault(int(r.user_id), []).append(UserCard(
            int(r.user_card_id), int(r.card_id), card_issuer[int(r.card_id)],
            int(r.display_order) if _none(r.display_order) is not None else 99, _bool(r.exclude_from_placement)))

    pays = src.read("payments").merge(src.read("payment_details"), on="payment_id", how="left")
    pays["channel"] = pays.channel.fillna("offline_qr")
    pays["card_select_mode"] = pays.card_select_mode.fillna("manual")
    merchants, key = _merchants(src, online_share(pays), cmap)
    categories = src.read("categories")
    catalog = Catalog(cards, merchants, dict(zip(categories.category, categories.category_name)))
    catalog.aliases = brand_alias_index(src, cmap)          # 챗봇 가맹점 검색용 (공백·기호 뺀 소문자 표기 → 브랜드)

    pays["paid_at"] = pd.to_datetime(pays.paid_at).dt.tz_localize(KST)
    pays["synced_at"] = pd.to_datetime(pays.synced_at).dt.tz_localize(KST)
    pays = pays.sort_values(["paid_at", "payment_id"], kind="stable")
    payments: dict[int, list[Payment]] = {}
    for r in pays.itertuples():
        uc = int(r.user_card_id)
        user_id = owner[uc]
        synced = None if pd.isna(r.synced_at) else r.synced_at.to_pydatetime()
        promo = getattr(r, "promotion_amount", None)            # 실제로 받은 프로모션 (칸이 없으면 기록 없음)
        payments.setdefault(user_id, []).append(Payment(
            int(r.payment_id), user_id, uc, key.get((r.merchant_name, r.category)), r.category, r.channel,
            r.card_select_mode, int(r.amount), r.paid_at.to_pydatetime(), synced,
            None if promo is None else (0 if pd.isna(promo) else int(promo))))

    users = {int(u): User(int(u)) for u in src.read("users").user_id}
    return TeamData(catalog, load_promotions(src, catalog, cmap), users, user_cards, payments, key,
                    src.read("cards"), src.read("benefits"))


def load_promotions(src: TableSource, catalog: Catalog, cmap: CardMap) -> list[Promotion]:
    """promotions 표. 브랜드(merchant_name)로 가맹점을 찾는다 (업종 칸은 대표 업종이라 쓰지 않는다).
    점수 기간은 start_date 0시 ~ end_date 23:59:59 (KST, 가상 1년 결제용으로 대부분 2025-11-01 부터).
    화면용 칸(2026-11-23: display_name·display_start/end·needs_check·logo_url)이 있으면 싣고, 없으면(마이그레이션 전 DB·
    예전 zip·v2 폴더) promotions.yml 에서 같은 번호의 확인 필요·실제 기간·화면 이름을 채운다 (점수가 지금과 같게)."""
    aliases = _table_aliases(src)
    df = src.read("promotions")
    complete = "display_name" in df.columns
    fallback = {} if complete else {p.promotion_id: p for p in _yml_promotions(catalog)}
    out = []
    for r in df.itertuples():
        fixed = r.value_type == "FIXED"
        s, e = pd.Timestamp(r.start_date).date(), pd.Timestamp(r.end_date).date()
        brand = _none(r.merchant_name)
        pid = int(r.promotion_id)
        if complete:
            ds, de = _none(r.display_start), _none(r.display_end)
            shown_from = None if ds is None else datetime.combine(pd.Timestamp(ds).date(), time(0), tzinfo=KST)
            shown_to = None if de is None else datetime.combine(pd.Timestamp(de).date(), time(23, 59, 59), tzinfo=KST)
            display = {"display_name": _none(r.display_name), "shown_from": shown_from, "shown_to": shown_to,
                       "logo_url": _none(r.logo_url), "needs_check": _bool(r.needs_check)}
        else:
            y = fallback.get(pid)
            display = {"display_name": y.brand if y else None, "shown_from": y.starts_at if y else None,
                       "shown_to": y.ends_at if y else None, "logo_url": None,
                       "needs_check": bool(y.needs_check) if y else False}
        out.append(promotion_from_row({
            "promotion_id": pid, "brand": brand or r.promo_name,
            "match_brand": cmap.merchant_brand(brand, aliases) if brand else None, "category_code": None,
            "issuer_code": cmap.issuer(r.issuer) if _none(r.issuer) else None, "card_id": _int(r.card_id),
            "amount": int(r.value) if fixed else None, "rate": None if fixed else float(r.value) / 100,
            "min_amount": _int(getattr(r, "min_amount", 0)) or 0, "max_amount": _int(r.max_amount),
            "starts_at": datetime.combine(s, time(0), tzinfo=KST),
            "ends_at": datetime.combine(e, time(23, 59, 59), tzinfo=KST),
            "title": r.promo_name, "kind": _none(getattr(r, "kind", None)) or "event", **display,
        }, catalog))
    return out


def _yml_promotions(catalog: Catalog) -> list[Promotion]:
    from engine.loader import load_popup_promotions
    return load_popup_promotions(catalog)


# ---------- 저장소 ----------

from engine.store import ParquetStore  # noqa: E402  (store 가 loader 를 쓰므로 아래에서 가져온다)


class TeamDbStore(ParquetStore):
    """팀 DB 표를 메모리에 올려 쓴다. 규칙·일정·추천 기록은 시연용으로 메모리에 둔다
    (운영에서는 Spring 이 DB 에 쓰고 엔진은 읽기만 한다)."""
    promotions_complete = True    # 행사 목록이 화면 정보·확인 필요까지 갖춰 yml 을 합치지 않는다 (2026-11-23)

    def __init__(self, source: TableSource | None = None, card_map: CardMap | None = None):
        self.source = source or source_from_env()
        self.data = load_team(self.source, card_map)
        self.cards = self.data.user_cards
        self.directory = None
        self.reset()

    def reset(self) -> None:
        """시연 중 더한 결제, 규칙, 일정, 카드 추천 기록을 지우고 팀 DB 상태로 돌아간다."""
        self.users = dict(self.data.users)
        self.payments = {u: list(rows) for u, rows in self.data.payments.items()}
        self.rules, self.rules_raw, self.logs, self.last_bases = {}, {}, [], {}
        self.schedule_items, self.card_recommendations = {}, {}
        self.drafts = {}

    def load_catalog(self) -> Catalog:
        self.catalog = self.data.catalog
        self.promotions = self.data.promotions
        return self.catalog

    def merchant_for(self, name: str, category: str) -> int | None:
        return self.data.merchant_key.get((name, category))
