"""가상 데이터(parquet)를 엔진 값으로 바꾼다."""

import os
from pathlib import Path

import pandas as pd

from engine.catalog import Catalog, build_card
from engine.domain import Merchant, Payment, User, UserCard

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
    benefits, tiers = {}, {}
    for row in records(read("card_benefits", directory)):
        benefits.setdefault(row["card_id"], []).append(row)
    for row in records(read("card_cap_tiers", directory)):
        tiers.setdefault(row["card_id"], []).append(row)
    cards = {r["card_id"]: build_card(r, benefits.get(r["card_id"], []), tiers.get(r["card_id"], [])) for r in catalog}
    merchants = {}
    for m in records(read("merchants", directory)):
        merchants[m["merchant_id"]] = Merchant(m["merchant_id"], m["place_name"], m["category_code"],
                                               m["lat"], m["lng"], bool(m["is_online"]), m["zone_code"])
    categories = read("merchant_categories", directory)
    return Catalog(cards, merchants, dict(zip(categories.category_code, categories.category_name)))


def load_users(directory: Path | None = None) -> dict[int, User]:
    df = read("users", directory)
    return {int(r.user_id): User(int(r.user_id), bool(r.loc_consent), bool(r.loc_feature_on))
            for r in df.itertuples()}


def load_user_cards(directory: Path | None = None) -> dict[int, list[UserCard]]:
    out: dict[int, list[UserCard]] = {}
    df = read("user_cards", directory).sort_values(["user_id", "display_order"])
    for r in df.itertuples():
        out.setdefault(int(r.user_id), []).append(UserCard(
            int(r.user_card_id), int(r.card_id), r.issuer_code, int(r.display_order), bool(r.exclude_from_placement)))
    return out


def read_payments(directory: Path | None = None) -> pd.DataFrame:
    df = read("payments", directory).drop(columns=list(BANNED_COLUMNS), errors="ignore")
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
