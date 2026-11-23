"""가상 데이터(parquet)를 엔진 값으로 바꾼다."""

import os
from pathlib import Path

import pandas as pd

from engine.catalog import Catalog, build_card
from engine.domain import Merchant, Payment, Promotion, User, UserCard

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = Path(os.environ.get("SOLPAY_ARTIFACTS", ROOT / "artifacts"))
BANNED_COLUMNS = ("choice_reason",)     # 생성기 전용 정답. 입력으로 쓰지 않는다


def data_dir() -> Path:
    return Path(os.environ.get("SOLPAY_DATA_DIR", ROOT.parent / "data" / "out" / "parquet"))


def records(df: pd.DataFrame) -> list[dict]:
    return df.astype(object).where(df.notna(), None).to_dict("records")


def read(name: str, directory: Path | None = None) -> pd.DataFrame:
    path = (directory or data_dir()) / f"{name}.parquet"
    if not path.exists():
        raise FileNotFoundError(f"{path} 가 없습니다. data 폴더에서 `uv run python -m generate.main` 을 먼저 실행하세요.")
    return pd.read_parquet(path)


def load_catalog(directory: Path | None = None) -> Catalog:
    catalog = records(read("card_catalog", directory))
    benefits, tiers, rewards, totals = {}, {}, {}, {}
    for row in records(read("card_benefits", directory)):
        benefits.setdefault(row["card_id"], []).append(row)
    for row in records(read("card_cap_tiers", directory)):
        tiers.setdefault(row["card_id"], []).append(row)
    if ((directory or data_dir()) / "card_rewards.parquet").exists():
        for row in records(read("card_rewards", directory)):
            rewards.setdefault(row["card_id"], []).append(row)
    if ((directory or data_dir()) / "card_total_caps.parquet").exists():
        for row in records(read("card_total_caps", directory)):
            totals.setdefault(row["card_id"], []).append(row)
    cards = {r["card_id"]: build_card(r, benefits.get(r["card_id"], []), tiers.get(r["card_id"], []),
                                      rewards.get(r["card_id"], []), totals.get(r["card_id"], [])) for r in catalog}
    merchants = {}
    for m in records(read("merchants", directory)):
        merchants[m["merchant_id"]] = Merchant(m["merchant_id"], m["place_name"], m["category_code"],
                                               m["lat"], m["lng"], bool(m["is_online"]), m["zone_code"], m["brand"],
                                               m.get("brand_code"))
    categories = read("merchant_categories", directory)
    return Catalog(cards, merchants, dict(zip(categories.category_code, categories.category_name)))


def promotion_from_row(row: dict, catalog: Catalog) -> Promotion:
    """promotions 테이블 한 행. 브랜드가 있으면 그 브랜드 가맹점, 없으면 그 업종 전체.
    브랜드도 업종도 없으면 가맹점을 찾을 수 없는 행사라 어느 가맹점에도 적용하지 않는다 (예전에는 모든 가맹점에 적용됐다)."""
    category = row.get("category_code")
    key = row.get("match_brand") if "category_code" in row else (row.get("match_brand") or row["brand"])
    if key:
        ids = frozenset(m.merchant_id for m in catalog.merchants.values()
                        if (m.brand_code == key or m.is_brand(key)) and (category is None or m.category == category))
    elif category is not None:
        ids = frozenset(m.merchant_id for m in catalog.merchants.values() if m.category == category)
    else:
        ids = frozenset()
    return Promotion(
        promotion_id=int(row["promotion_id"]), brand=row["brand"], starts_at=row["starts_at"], ends_at=row["ends_at"],
        merchant_ids=ids, issuer=row.get("issuer_code"), card_id=row.get("card_id"),
        amount=None if row.get("amount") is None else int(row["amount"]),
        rate=None if row.get("rate") is None else float(row["rate"]), min_amount=int(row.get("min_amount") or 0),
        max_amount=None if row.get("max_amount") is None else int(row["max_amount"]),
        title=row.get("title") or "", kind=row.get("kind") or "event", needs_check=bool(row.get("needs_check", False)),
        display_name=row.get("display_name") or "", shown_from=row.get("shown_from"), shown_to=row.get("shown_to"),
        logo_url=row.get("logo_url") or None,
    )


def load_promotions(catalog: Catalog, directory: Path | None = None) -> list[Promotion]:
    path = (directory or data_dir()) / "promotions.parquet"
    if not path.exists():
        return []
    rows = records(pd.read_parquet(path))
    for r in rows:
        r["starts_at"], r["ends_at"] = r["starts_at"].to_pydatetime(), r["ends_at"].to_pydatetime()
    return [promotion_from_row(r, catalog) for r in rows]


def popup_promotions_path() -> Path:
    """일정 팝업용 프로모션 목록 (SOL 페이 혜택 정보.xlsx 를 옮긴 31건). 팀 DB 에는 넣지 않고 읽기만 한다."""
    return Path(os.environ.get("SOLPAY_POPUP_PROMOTIONS", ROOT.parent / "data" / "config" / "promotions.yml"))


def load_popup_promotions(catalog: Catalog, path: Path | None = None) -> list[Promotion]:
    """promotions.yml → Promotion. 모두 신한카드 결제 대상이고(2026-11-11 결정), 기간은 시작일 0시 ~ 종료일 23:59:59 (KST).
    needs_check(응모·선착순·가맹점 식별 불가)는 그대로 실어 두고 추천할 때 뺀다."""
    from datetime import datetime
    from zoneinfo import ZoneInfo

    import yaml
    path = Path(path or popup_promotions_path())
    if not path.exists():
        return []
    kst = ZoneInfo("Asia/Seoul")
    rows = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("promotions", [])
    out = []
    for r in rows:
        s, e = r["starts"], r["ends"]
        out.append(promotion_from_row({
            "promotion_id": int(r["id"]), "brand": r["brand"], "match_brand": r.get("match"),
            "issuer_code": "SHINHAN", "card_id": None, "amount": r.get("amount"), "rate": r.get("rate"),
            "min_amount": r.get("min_amount", 0), "max_amount": r.get("max_amount"),
            "starts_at": datetime(s.year, s.month, s.day, tzinfo=kst),
            "ends_at": datetime(e.year, e.month, e.day, 23, 59, 59, tzinfo=kst),
            "title": r.get("title", ""), "kind": r.get("kind", "event"), "needs_check": bool(r.get("needs_check", False)),
        }, catalog))
    return out


def load_users(directory: Path | None = None) -> dict[int, User]:
    df = read("users", directory)
    return {int(r.user_id): User(int(r.user_id)) for r in df.itertuples()}


def load_user_cards(directory: Path | None = None) -> dict[int, list[UserCard]]:
    out: dict[int, list[UserCard]] = {}
    df = read("user_cards", directory).sort_values(["user_id", "display_order"])
    for r in df.itertuples():
        out.setdefault(int(r.user_id), []).append(UserCard(
            int(r.user_card_id), int(r.card_id), r.issuer_code, int(r.display_order), bool(r.exclude_from_placement)))
    return out


def read_payments(directory: Path | None = None) -> pd.DataFrame:
    """결제 내역. 가맹점의 브랜드 코드를 붙여 둔다 (전체 사용자 브랜드 비중 계산용)."""
    df = read("payments", directory).drop(columns=list(BANNED_COLUMNS), errors="ignore")
    merchants = read("merchants", directory)
    if "brand_code" in merchants.columns:
        df = df.merge(merchants[["merchant_id", "brand_code"]], on="merchant_id", how="left")
    return df.sort_values(["paid_at", "payment_id"]).reset_index(drop=True)


def payments_from_frame(df: pd.DataFrame) -> dict[int, list[Payment]]:
    out: dict[int, list[Payment]] = {}
    for r in df.itertuples():
        merchant = None if pd.isna(r.merchant_id) else int(r.merchant_id)
        synced = None if pd.isna(r.synced_at) else r.synced_at.to_pydatetime()
        out.setdefault(int(r.user_id), []).append(Payment(
            int(r.payment_id), int(r.user_id), int(r.user_card_id), merchant, r.category_code, r.channel,
            r.card_select_mode, int(r.amount), r.paid_at.to_pydatetime(), synced))
    return out
