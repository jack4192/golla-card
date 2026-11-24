"""v2 데이터(배경 1000명 + 데모 5명) 검증 (2026-11-22 설계서 docs/superpowers/specs/2026-11-22-data-v2-1000-design.md).

먼저 생성한 뒤 실행:  SOLPAY_DATA_VERSION=v2 uv run python -m generate.main && uv run pytest tests/test_generated_v2.py
v1 테스트와 같은 프로세스에서 돌도록 out_v2 와 load_config(..., "v2") 만 읽는다.
"""

import numpy as np
import pandas as pd
import pytest

import generate.card_db
import generate.merchants
import generate.users
from generate.common import DATA_DIR, load_config

P2 = DATA_DIR / "out_v2" / "parquet"
FULL_MONTHS = ["2025-11", "2025-12"] + [f"2026-{m:02d}" for m in range(1, 11)]


@pytest.fixture(scope="module")
def t2():
    if not (P2 / "payments.parquet").exists():
        pytest.skip("v2 생성 결과가 없습니다. 먼저 SOLPAY_DATA_VERSION=v2 uv run python -m generate.main")
    return {f.stem: pd.read_parquet(f) for f in P2.glob("*.parquet")}


@pytest.fixture()
def v2cfg(monkeypatch):
    """생성기 모듈이 v2 설정을 읽게 한다 (단위 테스트용)."""
    for mod in (generate.users, generate.card_db, generate.merchants):
        monkeypatch.setattr(mod, "load_config", lambda name: load_config(name, "v2"))


def _pays(t2) -> pd.DataFrame:
    """배경 사용자 결제 + 직업·나이대·가맹점 종류·동네·한국 시각."""
    u = t2["users"][["user_id", "user_type", "persona_code", "age_band"]]
    m = t2["merchants"][["merchant_id", "kind", "zone_code"]]
    p = t2["payments"].merge(u, on="user_id").merge(m, on="merchant_id", how="left")
    p["ts"] = p.paid_at.dt.tz_convert("Asia/Seoul")
    return p


def _monthly(t2) -> pd.Series:
    """사용자별 온전한 12개월 평균 월 지출."""
    p = t2["payments"]
    ym = p.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")
    full = p[ym.isin(FULL_MONTHS)]
    return full.groupby("user_id").amount.sum() / len(FULL_MONTHS)


def _share(p: pd.DataFrame, kind: str) -> pd.Series:
    """직업·나이대별로 일반 결제 중 그 종류의 비율."""
    r = p[p.channel != "auto_debit"]
    return r.assign(hit=r.kind == kind).groupby(["persona_code", "age_band"]).hit.mean()


def test_인원_1005명과_26칸(t2):
    u = t2["users"]
    bg = u[u.user_type == "background"]
    assert len(u) == 1005 and len(bg) == 1000
    cells = bg.groupby(["persona_code", "age_band"]).size()
    want = {(c["archetype"], c["age_band"]): c["n"] for c in load_config("population", "v2")["cells"]}
    assert cells.to_dict() == want
    assert cells.min() >= 30 and len(cells) == 26


def test_데모_카드(t2):
    uc = t2["user_cards"].sort_values(["user_id", "display_order"])
    got = uc[uc.user_id <= 5].groupby("user_id").card_code.apply(list).to_dict()
    assert got[1] == ["SH_DISCOUNT_PLAN_PLUS", "KB_ALL", "SH_MODU", "SH_SOL_TRAVEL_CHECK"]
    assert got[2] == ["SH_CHEOUM_CHECK", "SH_MODU", "KB_NORI2_CHECK"]
    assert got[3] == ["SH_SOLMATE_SOL_PLAN_CHECK", "NH_ALLWONDERFUL_DC", "BC_THE_OIL", "HANA_HERO_CHECK", "SH_SIMPLE_PLAN"]
    assert got[4] == ["SH_DISCOUNT_PLAN", "SH_MODU", "HANA_HERO_CHECK", "KB_CHECKCHECK"]
    assert got[5] == ["SH_MODU", "HANA_MOVING_ONLINE", "NH_ZGM_SAVE_CHECK", "BC_THE_OIL", "SH_SOLLINK_POINT_PLAN_CHECK"]
    k = uc[uc.user_id.isin([1, 2, 4, 5])]
    assert (k[k.is_kpass_registered].card_code == "SH_MODU").all() and k.is_kpass_registered.sum() == 4
    assert (k[k.is_transit_default].card_code == "SH_MODU").all() and k.is_transit_default.sum() == 4
    assert t2["users"].set_index("user_id").loc[3, "persona_code"] == "HOMEMAKER"


def test_배경_카드_수(t2):
    u = t2["users"].set_index("user_id")
    n = t2["user_cards"].groupby("user_id").size()
    bg = u[u.user_type == "background"].assign(n=n)
    student = bg[bg.persona_code == "STUDENT"].n
    young = bg[(bg.age_band == "20s") & (bg.persona_code != "STUDENT")].n
    rest = bg[bg.age_band != "20s"].n
    assert student.between(2, 3).all() and young.between(2, 4).all() and rest.between(2, 5).all()
    assert (rest == 5).sum() > 0
    assert 3.1 <= bg.n.mean() <= 3.5


def test_카드_규칙(t2):
    uc = t2["user_cards"].merge(t2["card_catalog"][["card_id", "card_type"]], on="card_id")
    uc = uc.merge(t2["users"][["user_id", "user_type", "persona_code"]], on="user_id")
    g = uc.groupby("user_id")
    assert (g.issuer_code.apply(lambda s: (s == "SHINHAN").any())).all()
    assert (g.card_type.apply(lambda s: (s == "check").sum()) >= 1).all()
    bg = uc[uc.user_type == "background"]
    other = bg.groupby("user_id").issuer_code.apply(lambda s: (s != "SHINHAN").any())
    assert abs(other.mean() - 0.6) <= 0.01
    for group in load_config("card_db_map", "v2")["exclusive_groups"]:
        assert (bg[bg.card_code.isin(group)].groupby("user_id").size() <= 1).all()
    assert set(bg[bg.card_code == "KB_BIZ_PRIME"].persona_code) == {"SELFEMP"}
    assert set(bg[bg.card_code == "SH_CHEOUM_CHECK"].persona_code) <= {"STUDENT"}
    assert set(bg[bg.card_code.isin(["SH_KUKMIN_CREDIT", "SH_KUKMIN_CHECK"])].persona_code) <= {"FAMILY"}
    assert "SH_NARASARANG_CHECK" not in set(bg.card_code)


def test_나이대_효과(t2):
    p = _pays(t2)
    p = p[p.user_type == "background"]
    med, dlv = _share(p, "MEDICAL"), _share(p, "DELIVERY")
    assert med["OFFICE", "50s"] > med["OFFICE", "30s"] > med["OFFICE", "20s"]
    assert dlv["OFFICE", "20s"] > dlv["OFFICE", "50s"]
    assert med["HOMEMAKER", "60s"] > med["HOMEMAKER", "40s"]
    amt = p[p.channel == "offline_qr"].groupby(["persona_code", "age_band"]).amount.median()
    assert amt["OFFICE", "50s"] > amt["OFFICE", "20s"]


def test_학원비_비율(t2):
    u = t2["users"]
    p = t2["payments"]
    payers = set(p[(p.category_code == "EDUCATION") & (p.channel == "auto_debit")].user_id)
    share = u[u.user_type == "background"].assign(edu=u.user_id.isin(payers)).groupby(["persona_code", "age_band"]).edu.mean()
    assert 0.3 <= share["FAMILY", "30s"] <= 0.7
    assert share["FAMILY", "40s"] >= 0.75
    assert share["HOMEMAKER", "60s"] == 0


def test_차량_나이(t2):
    u = t2["users"]
    car = u[u.user_type == "background"].assign(car=u.special_groups.str.contains("car"))
    s = car.groupby(["persona_code", "age_band"]).car.mean()
    assert s["OFFICE", "20s"] < s["OFFICE", "30s"]


def test_교대_근무_주마다_다름(t2):
    p = _pays(t2)
    p = p[(p.user_type == "background") & (p.channel != "auto_debit")]
    p = p.assign(late=p.ts.dt.hour.isin([22, 23, 0, 1, 2, 3, 4, 5]),
                 week=p.ts.dt.date.map(lambda d: d.toordinal() // 7))
    sd = p.groupby(["persona_code", "user_id", "week"]).late.mean().groupby(["persona_code", "user_id"]).std()
    by = sd.groupby("persona_code").median()
    assert by["SHIFT"] > 2 * by["OFFICE"]


def test_외근_동네(t2):
    p = _pays(t2)
    day = p[(p.channel == "offline_qr") & (p.ts.dt.day_of_week < 5) & p.ts.dt.hour.between(11, 16)]
    zones = day.groupby(["persona_code", "user_id"]).zone_code.nunique().groupby("persona_code").median()
    # 사무직도 회사 동네에 그 종류 가맹점이 없거나 무작위 종류를 고르면 다른 동네로 가서 3~5곳이 나온다
    assert zones["FIELD"] >= 2 * zones["OFFICE"]


def test_자영업_가게는_집_동네(t2):
    s = t2["users"].query("persona_code == 'SELFEMP'")
    assert (s.work_zone == s.home_zone).all()


def test_cells_합이_다르면_멈춤(v2cfg, monkeypatch):
    pop = load_config("population", "v2")
    pop["cells"][0] = {**pop["cells"][0], "n": pop["cells"][0]["n"] - 1}
    monkeypatch.setattr(generate.users, "load_config",
                        lambda name: pop if name == "population" else load_config(name, "v2"))
    with pytest.raises(ValueError, match="999"):
        generate.users.build_users(np.random.default_rng(1), generate.card_db.load_cards(),
                                   load_config("distributions", "v2"), 1000)


def test_학원비_없는_사용자도_결제_생성(v2cfg):
    from generate.payments import Simulator

    settings, dists = load_config("settings", "v2"), load_config("distributions", "v2")
    rng = np.random.default_rng(settings["seed"])
    cards = generate.card_db.load_cards()
    merchants, mz = generate.merchants.build_merchants(rng)
    users = generate.users.build_users(rng, cards, dists, settings["n_background_users"])
    u = next(x for x in users if x.archetype == "FAMILY" and x.user_type == "background" and "EDU" not in x.fixed_day)
    sim = Simulator(settings, dists, load_config("programs", "v2"), load_config("categories", "v2")["categories"],
                    load_config("places", "v2"), merchants, mz)
    rows = sim.run_user(u)
    assert rows and not any(r["category_code"] == "EDUCATION" and r["channel"] == "auto_debit" for r in rows)


def test_월_지출_분포는_v1과_비슷(t2):
    """v1 배경 사용자(온전한 12개월 평균): 하위 10% 59만, 중앙 130만, 상위 10% 304만, 상위 1% 588만, 700만 이상 0.6%.
    v2 는 대학생이 적어(20% → 6%) 하위 10% 는 조금 높아도 된다."""
    bg = t2["users"].query("user_type == 'background'").user_id
    m = _monthly(t2).loc[bg]
    q = m.quantile([0.1, 0.5, 0.9, 0.99])
    assert 500_000 <= q[0.1] <= 800_000
    assert 1_170_000 <= q[0.5] <= 1_430_000
    assert 2_600_000 <= q[0.9] <= 3_500_000
    assert q[0.99] <= 7_000_000
    assert (m >= 7_000_000).mean() <= 0.01


def test_데모_월_지출은_v1과_같다(t2):
    """데모 5명의 소비 패턴은 v1 그대로 (v1 온전한 12개월 평균 월 지출)."""
    m = _monthly(t2)
    for uid, want in {1: 2_287_000, 2: 756_000, 3: 2_457_000, 4: 1_275_000, 5: 1_460_000}.items():
        assert abs(m[uid] / want - 1) <= 0.05, (uid, m[uid])
