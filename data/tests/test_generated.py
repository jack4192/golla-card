"""생성된 소비 데이터 검증.

먼저 생성한 뒤 실행:  uv run python -m generate.main && uv run pytest
"""

from datetime import timedelta

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
    assert set(auto.category_code) <= {"TELECOM", "SUBSCR", "EDU", "UTILITY"}


def test_공과금(t):
    pay = t["payments"]
    bills = pay[pay.category_code == "UTILITY"].merge(t["merchants"][["merchant_id", "place_name"]], on="merchant_id")
    bills = bills.merge(t["users"][["user_id", "persona_code"]], on="user_id")
    assert (bills.card_select_mode == "auto_debit").all()
    assert set(bills[bills.place_name == "아파트 관리비"].persona_code) == {"FAMILY", "HOME50"}

    month = bills.paid_at.dt.tz_convert("Asia/Seoul").dt.month
    assert bills.groupby(["user_id", "place_name", month]).size().max() == 1   # 항목마다 한 달에 한 번

    gas = bills[bills.place_name == "도시가스"].amount.groupby(month).mean()
    assert gas[11] > gas[8]                                                     # 난방철이 더 많이 나온다

    # 고지서 카드로 나간다
    bill_cards = t["user_cards"].query("is_bill_card").set_index("user_id").user_card_id
    assert (bills.user_card_id == bills.user_id.map(bill_cards)).all()


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
    """가맹점은 연결된 동네마다 그 업종의 검색 반경 안에 있어야 한다 (가상 좌표는 동네 반경 1.3배)."""
    zones = {z["code"]: z for z in load_config("zones")["zones"]}
    places = load_config("places")
    reach = {cat: max(src.get("radius_m", 0) for src in srcs) for cat, srcs in places["kakao_sources"].items()}
    m = t["merchant_zones"].merge(t["merchants"], on="merchant_id", suffixes=("", "_m"))
    for _, r in m.iterrows():
        z = zones[r.zone_code]
        dy = (r.lat - z["lat"]) * 111_320
        dx = (r.lng - z["lng"]) * 111_320 * np.cos(np.radians(z["lat"]))
        limit = max(reach.get(r.category_code, 0), z["radius_m"] * 1.3) * 1.05
        assert np.hypot(dx, dy) <= limit, (r.place_name, r.zone_code)


def test_가맹점_중복_없음(t):
    m = t["merchants"]
    assert m.merchant_id.is_unique
    k = m[m.kakao_id.notna()].kakao_id
    assert k.is_unique


def test_배경_사용자_유형_비율(t):
    bg = t["users"].query("user_type == 'background'")
    share = bg.persona_code.value_counts(normalize=True)
    for archetype, expected in load_config("population")["archetype_share"].items():
        assert share[archetype] == pytest.approx(expected, abs=1 / len(bg))


def test_심야_결제(t):
    pay = t["payments"].merge(t["users"][["user_id", "persona_code"]], on="user_id")
    hour = pay.paid_at.dt.tz_convert("Asia/Seoul").dt.hour
    manual = pay[pay.card_select_mode == "manual"]
    dawn = pay[(hour < 6) & (pay.card_select_mode == "manual")]
    assert 0.01 <= len(dawn) / len(manual) <= 0.05
    assert set(dawn.category_code) <= {"ONLINE", "CVS", "TAXI", "DELIVERY", "TRANSIT"}   # 새벽에 가능한 업종만
    assert (dawn.paid_at.dt.tz_convert("Asia/Seoul").dt.hour == 0).sum() > (dawn.paid_at.dt.tz_convert("Asia/Seoul").dt.hour == 4).sum()

    share = dawn.groupby("persona_code").size() / manual.groupby("persona_code").size()
    assert share["NIGHTOWL"] > share["OFFICE"] > share["FAMILY"]


def test_데모_3번은_출근_없는_50대_여성(t):
    u = t["users"].set_index("user_id").loc[3]
    assert (u.persona_code, u.age_band, u.gender) == ("HOME50", "50s", "F")
    assert pd.isna(u.work_zone)

    pay = t["payments"].merge(t["merchants"][["merchant_id", "place_name"]], on="merchant_id")
    home_shopping = load_config("places")["home_shopping"]
    mine = pay[pay.user_id == 3]
    online = mine[mine.category_code == "ONLINE"]
    assert 0.3 <= online.place_name.isin(home_shopping).mean() <= 0.5
    assert not pay[pay.user_id != 3].place_name.isin(home_shopping).any()   # 홈쇼핑은 3번만

    assert (mine.category_code == "EDU").sum() == 3 + 1                      # 8~11월 학원비
    month = mine.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y%m")
    rides = mine[(mine.category_code == "TRANSIT") & month.isin(["202608", "202609", "202610"])]
    assert len(rides) / 3 >= 15                                              # K-패스 월 15회는 채운다


def test_사용자별_지출_격차(t):
    """배경 사용자의 월 지출은 평균이 중앙값보다 크고 위아래로 넓게 퍼진다 (제공 데이터는 24만/107만/352만)."""
    pay = t["payments"]
    month = pay.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y%m")
    full = pay[month.isin(["202608", "202609", "202610"])]
    spend = full.groupby("user_id").amount.sum() / 3
    bg = spend[spend.index >= 1000]
    assert bg.quantile(0.9) / bg.quantile(0.1) >= 5
    assert 1.3 <= bg.mean() / bg.median() <= 1.8
    assert 800_000 <= bg.median() <= 1_400_000


def _build(n_background: int):
    s = load_config("settings")
    d = load_config("distributions")
    rng = np.random.default_rng(s["seed"])
    cards = load_cards(load_config("cards"))
    merchants, merchant_zones = build_merchants(rng)
    users = build_users(rng, cards, d, n_background)
    sim = Simulator(s, d, load_config("programs"), load_config("categories")["categories"],
                    load_config("places"), merchants, merchant_zones)
    return s, d, users, sim


def test_충동_대형_결제는_배경_사용자만():
    s, d, users, sim = _build(100)
    days = [s["start_date"] + timedelta(days=i) for i in range(118)]

    def impulses(u) -> int:
        rng = np.random.default_rng([1, u.user_id])
        return sum(e[1] == "impulse" for day in days for e in sim._day_events(rng, u, day))

    assert sum(impulses(u) for u in users if u.user_type == "demo") == 0
    per_month = sum(impulses(u) for u in users if u.user_type == "background") / 100 / (118 / 30.4)
    assert per_month == pytest.approx(d["impulse"]["per_month"], abs=0.08)


def test_충동_대형_결제_금액():
    s, d, users, sim = _build(3)
    rule = d["impulse"]
    rng = np.random.default_rng(1)
    u = next(x for x in users if x.user_type == "background")
    won = [sim._impulse_amount(rng, u, "ONLINE") for _ in range(200)]
    assert rule["range"][0] <= min(won) and max(won) <= rule["range"][1]


def test_단골_확률은_배경_사용자마다_다름():
    _, d, users, _ = _build(50)
    lo, hi = load_config("population")["favorite_prob_range"]
    assert {u.favorite_prob for u in users if u.user_type == "demo"} == {d["favorite_prob"]}
    background = [u.favorite_prob for u in users if u.user_type == "background"]
    assert min(background) == pytest.approx(lo) and max(background) == pytest.approx(hi)


def test_같은_시드면_같은_결과():
    def run():
        s = load_config("settings")
        d = load_config("distributions")
        rng = np.random.default_rng(s["seed"])
        cards = load_cards(load_config("cards"))
        merchants, merchant_zones = build_merchants(rng)
        users = build_users(rng, cards, d, 3)
        sim = Simulator(s, d, load_config("programs"), load_config("categories")["categories"],
                        load_config("places"), merchants, merchant_zones)
        return simulate(sim, users)

    pd.testing.assert_frame_equal(run(), run())
