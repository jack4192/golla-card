"""생성된 소비 데이터 검증.

먼저 생성한 뒤 실행:  uv run python -m generate.main && uv run pytest
"""

import numpy as np
import pandas as pd
import pytest

from generate.benefit import load_cards
from generate.common import OUT_DIR, load_config
from generate.merchants import build_merchants
from generate.payments import Simulator, simulate
from generate.users import build_users

P = OUT_DIR / "parquet"


@pytest.fixture(scope="module")
def t():
    if not (P / "payments.parquet").exists():
        pytest.skip("생성 결과가 없습니다. 먼저 uv run python -m generate.main")
    return {f.stem: pd.read_parquet(f) for f in P.glob("*.parquet")}


def test_기간_안의_결제만(t):
    s = load_config("settings")
    pay = t["payments"]
    start = pd.Timestamp(s["start_date"]).tz_localize("Asia/Seoul")
    as_of = pd.Timestamp(s["as_of"]).tz_convert("Asia/Seoul")
    assert pay.paid_at.min() >= start
    assert pay.paid_at.max() < as_of


def test_결제_카드는_본인_카드(t):
    m = t["payments"].merge(t["user_cards"], on="user_card_id", suffixes=("", "_uc"))
    assert len(m) == len(t["payments"])
    assert (m.user_id == m.user_id_uc).all()
    assert (m.card_id == m.card_id_uc).all()
    assert (m.issuer_code == m.issuer_code_uc).all()


def test_가맹점_업종과_결제_업종이_같음(t):
    m = t["payments"].merge(t["merchants"][["merchant_id", "category_code"]], on="merchant_id",
                            suffixes=("", "_m"), how="left")
    assert m.merchant_id.notna().all()
    assert (m.category_code == m.category_code_m).all()


def test_금액(t):
    pay = t["payments"]
    assert (pay.amount > 0).all()
    non_transit = pay[pay.category_code != "TRANSIT"]
    assert (non_transit[~non_transit.category_code.isin(["SUBSCR"])].amount % 100 == 0).all()


def test_마이데이터_반영_시각(t):
    pay = t["payments"]
    own = pay[pay.source == "own"]
    assert (own.synced_at == own.paid_at).all()
    assert (pay.synced_at >= pay.paid_at).all()
    assert (pay[pay.issuer_code == "SHINHAN"].source == "own").all()
    assert (pay[pay.issuer_code != "SHINHAN"].source == "mydata").all()


def test_자동이체_업종(t):
    auto = t["payments"][t["payments"].card_select_mode == "auto_debit"]
    assert set(auto.category_code) <= {"TELECOM", "SUBSCR", "EDU"}


def test_보유_카드_규칙(t):
    uc = t["user_cards"].merge(t["card_catalog"][["card_id", "card_type"]], on="card_id")
    g = uc.groupby("user_id")
    assert g.size().between(3, 5).all()
    assert g.issuer_code.apply(lambda s: "SHINHAN" in set(s)).all()
    assert (g.issuer_code.nunique() >= 2).all()
    assert g.card_type.apply(lambda s: "check" in set(s)).all()
    # 기본 순서는 사용자마다 1부터 빈틈없이
    assert g.display_order.apply(lambda s: sorted(s) == list(range(1, len(s) + 1))).all()


def test_교통_대표_카드와_K패스(t):
    uc = t["user_cards"]
    assert (uc.groupby("user_id").is_transit_default.sum() == 1).all()
    assert (uc.groupby("user_id").is_kpass_registered.sum() <= 1).all()
    kp = uc[uc.is_kpass_registered].merge(t["card_catalog"], on="card_id")
    assert kp.tags.str.contains("kpass").all()


def test_업종별_습관_카드는_본인_카드(t):
    h = t["user_category_habits"].merge(t["user_cards"][["user_card_id", "user_id"]], on="user_card_id",
                                        suffixes=("", "_uc"))
    assert (h.user_id == h.user_id_uc).all()
    users = t["users"].set_index("user_id")
    assert (users.loc[h.user_id.unique(), "choice_model"] == "category_habit").all()


def test_오프라인_가맹점_좌표가_동네_근처(t):
    zones = {z["code"]: z for z in load_config("zones")["zones"]}
    m = t["merchants"][~t["merchants"].is_online]
    for _, r in m.iterrows():
        z = zones[r.zone_code]
        dy = (r.lat - z["lat"]) * 111_320
        dx = (r.lng - z["lng"]) * 111_320 * np.cos(np.radians(z["lat"]))
        assert np.hypot(dx, dy) <= z["radius_m"] * 1.5, r.place_name


def test_같은_시드면_같은_결과():
    def run():
        s = load_config("settings")
        d = load_config("distributions")
        rng = np.random.default_rng(s["seed"])
        cards = load_cards(load_config("cards"))
        merchants = build_merchants(rng)
        users = build_users(rng, cards, d, 3)
        sim = Simulator(s, d, load_config("programs"), load_config("categories")["categories"],
                        load_config("places"), merchants)
        return simulate(sim, users)

    pd.testing.assert_frame_equal(run(), run())
