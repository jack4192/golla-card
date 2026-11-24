"""생성된 소비 데이터 검증.

먼저 생성한 뒤 실행:  uv run python -m generate.main && uv run pytest
"""

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from generate.benefit import CardMonth, cap_for, evaluate, month_reward
from generate.card_db import load_cards, read as read_db
from generate.common import OUT_DIR, load_config
from generate.merchants import build_merchants
from generate.payments import Simulator, simulate
from generate.users import BACKGROUND_ID_START, build_users

P = OUT_DIR / "parquet"
FULL_MONTHS = ["202511", "202512"] + [f"2026{m:02d}" for m in range(1, 11)]   # 기간 안의 온전한 달 (12개월)


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


def test_기간(t):
    paid = t["payments"].paid_at.dt.tz_convert("Asia/Seoul")
    assert paid.min().date().isoformat() == "2025-11-01"
    assert paid.max().date().isoformat() == "2026-11-05"
    assert (t["users"].created_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m-%d") == "2025-11-01").all()


def test_금액(t):
    pay = t["payments"]
    assert (pay.amount > 0).all()
    non_transit = pay[pay.category_code != "TRANSIT"]
    subscriptions = ["DIGITAL_SUBSCRIPTION", "MEMBERSHIP"]          # 구독료는 실제 월 금액 그대로 (7,890원 등)
    assert (non_transit[~non_transit.category_code.isin(subscriptions)].amount % 100 == 0).all()


def test_마이데이터_반영_시각(t):
    pay = t["payments"]
    own = pay[pay.source == "own"]
    assert (own.synced_at == own.paid_at).all()
    assert (pay.synced_at >= pay.paid_at).all()
    assert (pay[pay.issuer_code == "SHINHAN"].source == "own").all()
    assert (pay[pay.issuer_code != "SHINHAN"].source == "mydata").all()


def test_자동이체_업종(t):
    auto = t["payments"][t["payments"].card_select_mode == "auto_debit"]
    assert set(auto.category_code) <= {"TELECOM", "DIGITAL_SUBSCRIPTION", "MEMBERSHIP", "EDUCATION", "UTILITY"}


def test_공과금(t):
    pay = t["payments"]
    bills = pay[pay.category_code == "UTILITY"].merge(t["merchants"][["merchant_id", "place_name"]], on="merchant_id")
    bills = bills.merge(t["users"][["user_id", "persona_code"]], on="user_id")
    assert (bills.card_select_mode == "auto_debit").all()
    assert set(bills[bills.place_name == "아파트 관리비"].persona_code) == {"FAMILY", "HOME50"}

    month = bills.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")
    assert bills.groupby(["user_id", "place_name", month]).size().max() == 1   # 항목마다 한 달에 한 번

    gas = bills[bills.place_name == "도시가스"].amount.groupby(month).mean()
    assert gas["2026-01"] > gas["2025-11"] > gas["2026-08"]                     # 한겨울 > 초겨울 > 여름

    # 고지서 카드로 나간다
    bill_cards = t["user_cards"].query("is_bill_card").set_index("user_id").user_card_id
    assert (bills.user_card_id == bills.user_id.map(bill_cards)).all()


def test_카드_구성(t):
    """최종 카드 DB 40장 (2026-11-15)."""
    c = t["card_catalog"]
    assert c.groupby("issuer_code").size().to_dict() == {"BC": 5, "HANA": 6, "KB": 6, "LOTTE": 4, "NH": 5, "SHINHAN": 14}
    assert c.card_type.value_counts().to_dict() == {"credit": 23, "check": 17}
    assert c.card_code.is_unique and c.card_name.is_unique
    assert c[c.tags.str.contains("kpass")].card_code.tolist() == ["SH_MODU"]
    used = set(t["payments"].card_id)
    unassigned = set(c[c.card_code.isin(["SH_NARASARANG_CHECK", "KB_BIZ_PRIME"])].card_id)   # 발급 자격이 맞는 유형 없음
    assert used <= set(c.card_id) - unassigned and len(used) >= 35


def _cards() -> dict:
    return {c.code: c for c in load_cards()}


def test_모든_카드에_계산할_혜택이_있음():
    for card in _cards().values():
        assert card.benefits, card.code
        assert all(b.brands for b in card.benefits if b.brands is not None)


def test_시간_조건_혜택():
    plan = _cards()["SH_DISCOUNT_PLAN"]                 # Time Plan: 07~15시 지정 커피 브랜드 10%(건당 1천 원, 하루 1회)
    st = CardMonth(prev_perf=400_000)
    assert evaluate(plan, "CAFE", 10_000, st, datetime(2026, 9, 2, 9), "스타벅스")[0] == 1_000
    assert evaluate(plan, "CAFE", 10_000, st, datetime(2026, 9, 2, 16), "스타벅스")[0] == 0
    assert evaluate(plan, "CAFE", 10_000, st, datetime(2026, 9, 2, 9), "매머드커피")[0] == 0     # 대상 브랜드 아님
    assert evaluate(plan, "CAFE", 10_000, CardMonth(prev_perf=300_000), datetime(2026, 9, 2, 9), "스타벅스")[0] == 0   # 전월 40만 미만

    eco = _cards()["SH_ECO_PLAN"]                       # 월요일 버스·지하철 1천 원
    monday, tuesday = datetime(2026, 8, 31, 8), datetime(2026, 9, 1, 8)
    st = CardMonth(prev_perf=300_000)
    assert evaluate(eco, "TRANSIT", 1_550, st, monday)[0] == 1_000
    assert evaluate(eco, "TRANSIT", 1_550, st, tuesday)[0] < 1_000


def test_구간별_혜택_값과_한도():
    """같은 혜택도 전월 실적 구간마다 다른 행이고, 한 달에는 그 구간 행 하나만 쓴다."""
    plan = _cards()["SH_DISCOUNT_PLAN"]
    rows = [b for b in plan.benefits if b.source_id == 1]
    assert [b.min_prev for b in rows] == [400_000, 800_000, 1_200_000]
    assert [b.max_prev for b in rows] == [800_000, 1_200_000, None]
    assert plan.total_caps[0] == (0, 0)                  # 실적 미달이면 통합 한도 0원


def test_간편결제_조건():
    modu = _cards()["SH_MODU"]                          # 간편결제 5% (SOL페이 등)
    st = CardMonth(prev_perf=300_000)
    at = datetime(2026, 9, 2, 12)
    assert evaluate(modu, "RESTAURANT", 25_000, st, at, None, "SOLPAY")[0] == 1_250             # 2만 원 이상, 5%
    assert evaluate(modu, "RESTAURANT", 25_000, st, at, None, None)[0] == 0
    link = _cards()["SH_SOLLINK_POINT_PLAN_CHECK"]      # 주말 배달앱 1천 P (간편결제 제외)
    st = CardMonth(prev_perf=200_000)
    saturday = datetime(2026, 9, 5, 19)
    assert evaluate(link, "DELIVERY", 25_000, st, saturday, "배달의민족", None)[0] >= 1_000
    assert evaluate(link, "DELIVERY", 25_000, st, saturday, "배달의민족", "SOLPAY")[0] < 1_000


def test_마트_건당_금액(t):
    amount = t["payments"].groupby("category_code").amount.mean()
    assert amount["MART"] >= 40_000                    # 대형마트 (슈퍼는 SUPERMARKET 으로 따로)


def test_혜택_테이블(t):
    b, tiers = t["card_benefits"], t["card_cap_tiers"]
    assert b.benefit_id.is_unique
    # 2026-11-24 신한카드 4장(41~44)은 원본 CSV 에만 더했다. 생성 데이터는 40장일 때 만들어 그 4장이 없다
    # (데이터를 다시 만들면 made 거르기를 빼고 원본 전체와 비교한다).
    made = set(t["card_catalog"].card_id)
    assert {c.card_id for c in _cards().values()} - made == {41, 42, 43, 44}
    assert len(b) == sum(len(c.benefits) for c in _cards().values() if c.card_id in made)
    assert set(b.card_id) == set(t["card_catalog"].card_id)
    assert set(tiers.card_id) <= set(t["card_catalog"].card_id)
    assert set(b.category_code) - {"ALL"} <= set(t["merchant_categories"].category_code)
    assert b[["rate", "amount", "per_liter"]].notna().sum(axis=1).eq(1).all()      # 혜택 값은 하나만
    source = t["card_benefits_source"]
    assert len(source) == read_db("benefits").card_id.isin(made).sum()
    assert set(b.source_benefit_id) == set(source[source.excluded_reason == ""].benefit_id)
    assert set(source.excluded_reason) == {"", "해외"}
    assert t["card_rewards"].empty


def test_월별_실적(t):
    s, pay, uc = t["card_month_status"], t["payments"], t["user_cards"]
    assert not s.duplicated(["user_card_id", "year_month"]).any()
    assert len(s) == len(uc) * s.year_month.nunique()
    assert s.year_month.min() == "2025-11" and s.year_month.max() == "2026-11"

    month = pay.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")
    perf = pay.groupby(["user_card_id", month]).amount.sum()
    got = s[s.perf > 0].set_index(["user_card_id", "year_month"]).perf
    assert got.sort_index().equals(perf.sort_index().rename("perf").rename_axis(got.index.names))

    first = s[s.year_month == "2025-11"]
    assert (first.prev_perf == 0).all() and (first.benefit_amount == 0).all()
    assert s[s.year_month == "2025-12"].benefit_amount.sum() > 0

    wide = s.pivot(index="user_card_id", columns="year_month", values="perf")
    assert (s[s.year_month == "2026-09"].set_index("user_card_id").prev_perf.sort_index()
            == wide["2026-08"].sort_index()).all()


def test_혜택은_한도를_넘지_않음(t):
    """카드 월 통합 한도가 있는 카드는 달마다 받은 혜택이 그 한도를 넘지 않는다."""
    from generate.benefit import total_cap
    s = t["card_month_status"].merge(t["card_catalog"][["card_id", "card_code"]], on="card_id")
    cards = _cards()
    checked = 0
    for r in s[s.benefit_amount > 0].itertuples():
        cap = total_cap(cards[r.card_code], r.prev_perf)
        if cap is not None:
            assert r.benefit_amount <= cap, r
            checked += 1
    assert checked > 100


def test_보유_카드_규칙(t):
    uc = t["user_cards"].merge(t["card_catalog"][["card_id", "card_type"]], on="card_id")
    g = uc.groupby("user_id")
    bg = uc[uc.user_id >= 1000].groupby("user_id")
    assert bg.size().between(2, 4).all()
    assert bg.issuer_code.apply(lambda s: "SHINHAN" in set(s)).all()      # 시연 사용자는 최종 DB test1~5 카드 그대로
    assert bg.issuer_code.apply(lambda s: bool(set(s) - {"SHINHAN"})).mean() == pytest.approx(0.6, abs=0.07)
    for group in load_config("card_db_map")["exclusive_groups"]:             # 한 카드의 모드·팩은 하나만
        assert (uc[uc.card_code.isin(group)].groupby("user_id").size() <= 1).all()
    assert bg.card_type.apply(lambda s: "check" in set(s)).all()
    personas = t["users"].set_index("user_id").persona_code
    for code, allowed in load_config("card_db_map")["eligibility"].items():
        holders = uc[(uc.card_code == code) & (uc.user_id >= 1000)].user_id
        assert set(personas[holders]) <= set(allowed), code
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
    for extra, base in places.get("kind_fold", {}).items():                  # 더 받은 브랜드는 원래 종류로 합쳐진다
        reach[base] = max(reach.get(base, 0), reach.get(extra, 0))
    m = t["merchant_zones"].merge(t["merchants"], on="merchant_id", suffixes=("", "_m"))
    for _, r in m.iterrows():
        z = zones[r.zone_code]
        dy = (r.lat - z["lat"]) * 111_320
        dx = (r.lng - z["lng"]) * 111_320 * np.cos(np.radians(z["lat"]))
        limit = max(reach.get(r.kind, 0), z["radius_m"] * 1.3) * 1.05
        assert np.hypot(dx, dy) <= limit, (r.place_name, r.zone_code)


def test_가맹점_중복_없음(t):
    m = t["merchants"]
    assert m.merchant_id.is_unique
    k = m[m.kakao_id.notna()].kakao_id
    assert k.is_unique


def test_배경_사용자_유형_비율(t):
    n = load_config("settings")["n_background_users"]
    bg = t["users"].query("user_type == 'background' and user_id < @BACKGROUND_ID_START + @n")
    assert len(bg) == n
    share = bg.persona_code.value_counts(normalize=True)
    for archetype, expected in load_config("population")["archetype_share"].items():
        assert share[archetype] == pytest.approx(expected, abs=1 / len(bg))


def test_50대_추가_인원(t):
    """2026-11-14 결정: 기존 300명 뒤에 50대 60명 (출근 없는 50대 30, 50대 직장인 30)."""
    n = load_config("settings")["n_background_users"]
    extra = t["users"].query("user_type == 'background' and user_id >= @BACKGROUND_ID_START + @n")
    assert len(extra) == 60 and set(extra.age_band) == {"50s"}
    assert extra.persona_code.value_counts().to_dict() == {"HOME50": 30, "OFFICE": 30}
    assert extra[extra.persona_code == "HOME50"].work_zone.isna().all()
    assert extra[extra.persona_code == "OFFICE"].work_zone.notna().all()


def test_카드_발급일은_데이터_시작_전(t):
    start = pd.Timestamp(load_config("settings")["start_date"])
    assert (pd.to_datetime(t["user_cards"].issued_at) < start).all()


def test_차량_보유는_페르소나별(t):
    car = t["users"].assign(car=t["users"].special_groups.str.contains("car")).query("user_type == 'background'")
    share = car.groupby("persona_code").car.mean()
    assert share["STUDENT"] < 0.25 and share["FAMILY"] > 0.6
    ev = t["users"].special_groups.str.contains("ev")
    assert (~ev | t["users"].special_groups.str.contains("car")).all()       # 전기차 충전은 차량 보유자만


def test_혜택은_있는데_결제가_없던_업종(t):
    cats = set(t["payments"].category_code)
    assert {"EV_CHARGING", "INTERCITY_TRANSIT", "MOBILE_PAY", "CULTURE_TICKET", "ONLINE_GROCERY"} <= cats


def test_소비_배율_상한(t):
    pay = t["payments"][t["payments"].paid_at < pd.Timestamp("2026-11-01", tz="Asia/Seoul")]
    monthly = pay.groupby("user_id").amount.sum() / 12
    assert monthly.max() < 12_000_000


def test_학원비는_사용자마다_한_금액_자동이체(t):
    edu = t["payments"][t["payments"].category_code == "EDUCATION"]
    assert (edu.channel == "auto_debit").all() and (edu.card_select_mode == "auto_debit").all()
    assert (edu.groupby("user_id").amount.nunique() == 1).all()
    assert edu.amount.between(150_000, 450_000).all() and edu.amount.nunique() > 5


def test_음식점_시간대는_계단이_아니다(t):
    pay = t["payments"]
    rest = pay[(pay.category_code == "RESTAURANT") & (pay.card_select_mode == "manual")]
    hour = rest.paid_at.dt.tz_convert("Asia/Seoul").dt.hour.value_counts(normalize=True)
    assert hour.get(14, 0) > 0.02                      # 점심 끝자락이 이어진다
    assert hour[12] > hour[11] and hour[12] > hour[13]  # 점심 한가운데가 가장 많다


def test_심야_결제(t):
    pay = t["payments"].merge(t["users"][["user_id", "persona_code"]], on="user_id")
    hour = pay.paid_at.dt.tz_convert("Asia/Seoul").dt.hour
    manual = pay[pay.card_select_mode == "manual"]
    dawn = pay[(hour < 6) & (pay.card_select_mode == "manual")]
    assert 0.01 <= len(dawn) / len(manual) <= 0.05
    assert set(dawn.category_code) <= {"ONLINE_SHOPPING", "HOME_SHOPPING", "CONVENIENCE", "TAXI", "DELIVERY", "TRANSIT"}  # 새벽에 가능한 업종만
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
    online = mine[mine.category_code.isin(["ONLINE_SHOPPING", "HOME_SHOPPING"])]
    assert 0.3 <= online.place_name.isin(home_shopping).mean() <= 0.5
    home50 = t["users"].query("persona_code == 'HOME50'").user_id
    assert not pay[~pay.user_id.isin(home50)].place_name.isin(home_shopping).any()   # 홈쇼핑은 출근 없는 50대만

    month = mine.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y%m")
    edu = month[mine.category_code == "EDUCATION"]
    assert edu.is_unique and set(FULL_MONTHS) <= set(edu)                     # 학원비는 매달 한 번 (납부일은 사용자마다 1~15일)
    rides = mine[(mine.category_code == "TRANSIT") & month.isin(FULL_MONTHS)]
    assert len(rides) / len(FULL_MONTHS) >= 15                               # K-패스 월 15회는 채운다


def test_사용자별_지출_격차(t):
    """배경 사용자의 월 지출은 평균이 중앙값보다 크고 위아래로 넓게 퍼진다 (제공 데이터는 24만/107만/352만)."""
    pay = t["payments"]
    month = pay.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y%m")
    full = pay[month.isin(FULL_MONTHS)]
    spend = full.groupby("user_id").amount.sum() / len(FULL_MONTHS)
    bg = spend[spend.index >= 1000]
    assert bg.quantile(0.9) / bg.quantile(0.1) >= 4.5     # 배율 상한 2배(2026-11-14 결정)로 위쪽 꼬리가 줄어 5 → 4.5
    assert 1.2 <= bg.mean() / bg.median() <= 1.8          # 약국 고액 결제를 뺀 뒤(2026-11-16) 1.36 → 1.26
    assert 800_000 <= bg.median() <= 1_400_000


def _build(n_background: int):
    s = load_config("settings")
    d = load_config("distributions")
    rng = np.random.default_rng(s["seed"])
    cards = load_cards()
    merchants, merchant_zones = build_merchants(rng)
    users = build_users(rng, cards, d, n_background)
    sim = Simulator(s, d, load_config("programs"), load_config("categories")["categories"],
                    load_config("places"), merchants, merchant_zones)
    return s, d, users, sim


def test_충동_대형_결제는_배경_사용자만():
    s, d, users, sim = _build(100)
    n_days = (pd.Timestamp(s["as_of"]).date() - s["start_date"]).days
    days = [s["start_date"] + timedelta(days=i) for i in range(n_days)]

    def impulses(u) -> int:
        rng = np.random.default_rng([1, u.user_id])
        return sum(e[1] == "impulse" for day in days for e in sim._day_events(rng, u, day))

    assert sum(impulses(u) for u in users if u.user_type == "demo") == 0
    bg = [u for u in users if u.user_type == "background"]
    per_month = sum(impulses(u) for u in bg) / len(bg) / (n_days / 30.4)
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
        cards = load_cards()
        merchants, merchant_zones = build_merchants(rng)
        users = build_users(rng, cards, d, 3)
        sim = Simulator(s, d, load_config("programs"), load_config("categories")["categories"],
                        load_config("places"), merchants, merchant_zones)
        return simulate(sim, users)

    pd.testing.assert_frame_equal(run(), run())


def test_프로모션_테이블(t):
    """SOL 페이 혜택 정보 29건, 전체 기간, 모두 신한카드 대상 (2026-11-18 결정)."""
    p = t["promotions"]
    assert p.promotion_id.tolist() == list(range(1, 30))
    assert ((p.amount.notna()) ^ (p.rate.notna())).all(), "정액과 비율 중 하나만"
    assert (p.starts_at == pd.Timestamp("2025-11-01", tz="Asia/Seoul")).all() and (p.ends_at > p.starts_at).all()
    assert set(p.issuer_code) == {"SHINHAN"} and set(p.kind) == {"event", "myshop"} and not p.needs_check.any()
    assert {"메가MGC커피", "CU", "올리브영"} <= set(p.match_brand) & set(t["merchants"].brand_code.dropna())


def test_특수_고액_결제(t):
    """동물병원·골프·자동차 정비는 정해 둔 사용자만, 가정한 빈도와 금액으로 결제한다."""
    pay, users = t["payments"], t["users"].set_index("user_id")
    special = load_config("distributions")["special"]
    groups = {"PET": "pet", "GOLF": "golf", "OTHER": "car", "EV_CHARGING": "ev"}
    for category, group in groups.items():
        rows = pay[pay.category_code == category]
        assert len(rows) > 0, category
        owners = users.loc[rows.user_id.unique(), "special_groups"]
        assert owners.str.contains(group).all(), category                      # 그 묶음 사용자만
    vet = pay[pay.category_code == "PET"]
    per_month = len(vet) / users.special_groups.str.contains("pet").sum() / 12.2
    assert per_month == pytest.approx(special["VET"]["per_month"], abs=0.1)
    assert vet.amount.between(*special["VET"]["big"]["range"]).mean() == pytest.approx(0.1, abs=0.05)
    golf = pay[(pay.category_code == "GOLF") & (pay.amount >= 100_000)]      # 필드 (연습장은 2.5만 원 안팎)
    assert golf.paid_at.dt.tz_convert("Asia/Seoul").dt.dayofweek.ge(5).mean() > 0.8   # 필드는 주말


def test_해외_혜택은_빼고_국내_대상만_남긴다():
    for card in _cards().values():
        for b in card.benefits:
            assert b.targets is None or not {c for c, _ in b.targets} & {"OVERSEAS", "OVERSEAS_TRANSIT"}

# ---------- 2026-11-18: 모든 사용자가 신한카드를 갖는다 (test2·test3 에 신한카드 1장씩 추가) ----------

def test_모든_사용자가_신한카드를_가진다(t):
    uc = t["user_cards"]
    assert uc.groupby("user_id").issuer_code.apply(lambda s: (s == "SHINHAN").any()).all()


def test_데모_추가_카드는_맨_뒤_번호와_4번째_순서(t):
    """기존 카드 번호를 밀지 않도록 추가 카드는 배경 사용자 카드 다음 번호를 쓴다."""
    uc = t["user_cards"]
    added = uc[uc.user_card_id >= 1063]
    assert added.sort_values("user_card_id")[["user_card_id", "user_id", "card_code", "display_order"]].values.tolist() == [
        [1063, 2, "SH_SOL_TRAVEL_CHECK", 4], [1064, 3, "SH_SIMPLE_PLAN", 4]]
    demo = uc[uc.user_id <= 5].groupby("user_id").size().to_dict()
    assert demo == {1: 3, 2: 4, 3: 4, 4: 3, 5: 3}
    assert set(uc[uc.user_card_id <= 15].user_id) == {1, 2, 3, 4, 5}     # 원본 테스트 계정 카드 15장은 그대로 1~15번


def test_추가_카드도_결제에_쓰인다(t):
    pay = t["payments"]
    assert (pay.user_card_id == 1063).sum() > 0 and (pay.user_card_id == 1064).sum() > 0


def test_브랜드_별칭은_표기마다_하나이고_별칭_규칙을_따른다():
    """같은 표기가 두 브랜드로 들어가면 실행마다 순서가 달라져 가맹점 브랜드가 바뀌었다 (2026-11-18 발견)."""
    from generate.card_db import alias_table
    pairs = alias_table()
    aliases = [a for a, _ in pairs]
    assert len(aliases) == len(set(aliases))
    resolved = dict(pairs)
    assert (resolved["ssg닷컴"], resolved["yes24"], resolved["컬리"]) == ("SSG.COM", "YES24", "컬리")   # 지금까지 데이터와 같은 값
