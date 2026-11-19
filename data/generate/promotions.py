"""최종 프로모션 (2026-11-18 사용자 결정). 팀 DB 폴더·엔진 데이터·DB 결제의 프로모션을 모두 여기서 만든다.

원본: config/promotions.yml (SOL 페이 혜택 정보.xlsx, 신한 SOL페이 이벤트 6건·마이샵 25건, 2026-11).
- 가맹점을 식별할 수 없는 2건(30 미식 브랜드, 31 종합쇼핑몰)은 뺀다 → 29건.
- 응모·선착순 조건은 생략하고 일반 행사로 본다 (needs_check 를 쓰지 않는다).
- 11월 행사가 아니라 데이터 전체 기간에 있는 행사로 본다: 시작일 = 2025-11-01, 종료일 = 원래 종료일.
- 모두 신한카드 결제 대상이다. 팀 DB promotions 표에는 kind(event/myshop)·min_amount 두 칸을 더하고, 원본의 5건은 지운다.
- 결제 한 건에는 조건이 맞는 행사 중 가장 큰 하나만 붙는다. 마이샵은 사용자가 ON 을 켜야 받는다.
  습관대로 결제는 사용자·행사·달마다 30% 만 켰다고 본다 (solpay-ai evaluation/replay.myshop_on 과 같은 규칙).
"""

from datetime import date

import numpy as np
import pandas as pd

from .common import load_config

EXCLUDE = {30, 31}                    # 원본에서 정확한 가맹점명을 식별할 수 없는 행사
PERIOD_START = date(2025, 11, 1)      # 데이터 첫날. 전체 기간에 있는 행사로 본다
MYSHOP_ON = 0.3
REPLAY_SEED = 20261127                # solpay-ai evaluation/replay.SEED. ON 난수 = default_rng([SEED + 3, 사용자, 행사, 연월])
ISSUER_DB, ISSUER_CODE = "신한", "SHINHAN"

DB_COLUMNS = ["promotion_id", "card_id", "issuer", "merchant_id", "promo_name", "category", "merchant_name",
              "value_type", "value", "max_amount", "start_date", "end_date", "kind", "min_amount"]
ENGINE_COLUMNS = ["promotion_id", "kind", "brand", "match_brand", "category_code", "title", "issuer_code", "card_id",
                  "benefit_type", "amount", "rate", "min_amount", "max_amount", "starts_at", "ends_at", "payout", "note",
                  "needs_check", "data_origin"]


def final_promotions() -> list[dict]:
    out = []
    for r in load_config("promotions")["promotions"]:
        if int(r["id"]) in EXCLUDE:
            continue
        out.append({
            "promotion_id": int(r["id"]), "kind": r.get("kind", "event"), "brand": r["brand"],
            "match": r.get("match") or r["brand"], "title": r.get("title") or r["brand"],
            "benefit_type": r.get("benefit") or "discount",
            "amount": None if r.get("amount") is None else int(r["amount"]),
            "rate": None if r.get("rate") is None else float(r["rate"]),
            "min_amount": int(r.get("min_amount") or 0),
            "max_amount": None if r.get("max_amount") is None else int(r["max_amount"]),
            "start": PERIOD_START, "end": r["ends"], "payout": r.get("payout"), "note": r.get("note"),
        })
    return out


def merchant_ids(promo: dict, merchants: pd.DataFrame) -> set[int]:
    """행사 가맹점: 브랜드 코드나 브랜드가 같거나, 가게 이름이 브랜드명으로 시작하는 곳 (엔진 loader.promotion_from_row 와 같은 규칙)."""
    if merchants.empty:
        return set()
    key = promo["match"]
    hit = (merchants.brand_code == key) | (merchants.brand == key) | merchants.place_name.astype(str).str.startswith(key)
    return set(int(m) for m in merchants.loc[hit.fillna(False), "merchant_id"])


def promo_value(promo: dict, amount: int) -> int:
    """엔진 Promotion.value 와 같은 계산: 최소 결제액 미만이면 0, 정률은 10원 단위 내림, 건당 상한."""
    if amount < (promo.get("min_amount") or 0):
        return 0
    got = min(promo["amount"], amount) if promo.get("amount") is not None else int(amount * (promo["rate"] or 0) / 10) * 10
    return min(got, promo["max_amount"]) if promo.get("max_amount") is not None else got


def myshop_on(user_id: int, promotion_id: int, ym: str, share: float = MYSHOP_ON) -> bool:
    """이 사용자가 그 달 이 마이샵 행사를 ON 으로 켰는지 (사용자·행사·달마다 고정)."""
    if share >= 1:
        return True
    if share <= 0:
        return False
    key = int(ym[:4]) * 100 + int(ym[5:7])
    return bool(np.random.default_rng([REPLAY_SEED + 3, user_id, promotion_id, key]).random() < share)


def index_by_merchant(promos: list[dict], merchants: pd.DataFrame) -> dict[int, list[dict]]:
    """가맹점 번호 → 그 가맹점에 걸린 행사들."""
    out: dict[int, list[dict]] = {}
    for p in promos:
        for m in merchant_ids(p, merchants):
            out.setdefault(m, []).append(p)
    return out


def best_promotion(index: dict[int, list[dict]], user_id: int, merchant_id, issuer_code: str, amount: int,
                   day: date, share: float = MYSHOP_ON) -> tuple[int | None, int]:
    """이 결제에 실제로 붙는 행사 (번호, 금액). 신한카드·기간·최소 결제액이 맞는 행사 중 가장 큰 하나.
    마이샵은 사용자가 그 달 ON 을 켰을 때만 (습관대로 결제의 가정)."""
    if issuer_code != ISSUER_CODE or merchant_id is None or pd.isna(merchant_id):
        return None, 0
    best_id, best = None, 0
    ym = f"{day.year:04d}-{day.month:02d}"
    for p in index.get(int(merchant_id), ()):
        if not p["start"] <= day <= p["end"]:
            continue
        v = promo_value(p, int(amount))
        if v > best and (p["kind"] != "myshop" or myshop_on(user_id, p["promotion_id"], ym, share)):
            best_id, best = p["promotion_id"], v
    return best_id, best


def _number(v: float) -> int | float:
    v = round(v, 2)
    return int(v) if v == int(v) else v


def db_frame(merchants: pd.DataFrame) -> pd.DataFrame:
    """팀 DB promotions 표 (원본 12칸 + kind·min_amount). 업종은 행사 가맹점의 업종(가장 많은 것), 없으면 비운다."""
    rows = []
    for p in final_promotions():
        ids = merchant_ids(p, merchants)
        cats = merchants[merchants.merchant_id.isin(ids)].category_code if ids else pd.Series(dtype=object)
        fixed = p["amount"] is not None
        rows.append({
            "promotion_id": p["promotion_id"], "card_id": None, "issuer": ISSUER_DB, "merchant_id": None,
            "promo_name": p["title"][:100], "category": cats.mode().iloc[0] if len(cats) else None,
            "merchant_name": p["match"], "value_type": "FIXED" if fixed else "RATE",
            "value": p["amount"] if fixed else _number(p["rate"] * 100), "max_amount": p["max_amount"],
            "start_date": p["start"].isoformat(), "end_date": p["end"].isoformat(), "kind": p["kind"],
            "min_amount": p["min_amount"],
        })
    df = pd.DataFrame(rows, columns=DB_COLUMNS)
    for col in ("card_id", "merchant_id", "max_amount"):
        df[col] = df[col].astype("Int64")
    return df


def engine_frame() -> pd.DataFrame:
    """엔진 데이터(data/out/parquet/promotions.parquet). 브랜드로 가맹점을 찾으므로 업종은 비운다."""
    rows = [{
        "promotion_id": p["promotion_id"], "kind": p["kind"], "brand": p["brand"], "match_brand": p["match"],
        "category_code": None, "title": p["title"], "issuer_code": ISSUER_CODE, "card_id": None,
        "benefit_type": p["benefit_type"], "amount": p["amount"], "rate": p["rate"], "min_amount": p["min_amount"],
        "max_amount": p["max_amount"], "starts_at": pd.Timestamp(p["start"], tz="Asia/Seoul"),
        "ends_at": pd.Timestamp(p["end"], tz="Asia/Seoul") + pd.Timedelta(days=1) - pd.Timedelta(seconds=1),
        "payout": None if p["payout"] is None else str(p["payout"]), "note": p["note"], "needs_check": False,
        "data_origin": "promotions_yml",
    } for p in final_promotions()]
    df = pd.DataFrame(rows, columns=ENGINE_COLUMNS)
    for col in ("card_id", "amount", "max_amount"):
        df[col] = df[col].astype("Int64")
    return df
