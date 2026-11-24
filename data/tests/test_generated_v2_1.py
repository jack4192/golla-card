"""v2.1 데이터(v2 + 개인 루틴) 검증 (2026-11-23 사용자 결정: 배경 50%·루틴 1~2개·±30분·60~90%, 결제 수 유지, 데모 그대로).

먼저 생성한 뒤 실행:  SOLPAY_DATA_VERSION=v2.1 uv run python -m generate.main && uv run pytest tests/test_generated_v2_1.py
out_v2.1 / out_v2 와 load_config(..., "v2.1") 만 읽는다.
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from generate.common import DATA_DIR, load_config

P21 = DATA_DIR / "out_v2.1" / "parquet"
P2 = DATA_DIR / "out_v2" / "parquet"
COLS = ["user_id", "user_card_id", "merchant_id", "category_code", "amount", "paid_at", "card_select_mode",
        "choice_reason"]


def _read(path, names):
    if not (path / "payments.parquet").exists():
        pytest.skip(f"생성 결과가 없습니다: {path}")
    return {n: pd.read_parquet(path / f"{n}.parquet") for n in names}


@pytest.fixture(scope="module")
def t21():
    return _read(P21, ["users", "payments", "merchants", "user_routines", "routine_events"])


@pytest.fixture(scope="module")
def t2():
    return _read(P2, ["users", "payments"])


@pytest.fixture(scope="module")
def cfg():
    return load_config("distributions", "v2.1")


def test_루틴은_배경_절반에게_1_2개_데모는_없다(t21, cfg):
    u, r = t21["users"], t21["user_routines"]
    bg = u[u.user_type == "background"]
    assert not r.user_id.isin(u[u.user_type == "demo"].user_id).any()
    assert 0.45 <= r.user_id.nunique() / len(bg) <= 0.55
    assert r.groupby("user_id").size().between(1, 2).all()
    assert r.keep_prob.between(0.6, 0.9).all()
    job = u.set_index("user_id").persona_code
    rule = cfg["routines"]["by_archetype"]
    assert all(t in rule[job[uid]] for uid, t in zip(r.user_id, r.template))


def _events(t21) -> pd.DataFrame:
    ev = t21["routine_events"].merge(t21["user_routines"], on=["user_id", "routine_no"])
    pay = t21["payments"][["user_id", "paid_at", "merchant_id"]].merge(
        t21["merchants"][["merchant_id", "kind"]], on="merchant_id", how="left")
    return ev.merge(pay, on=["user_id", "paid_at"], how="left", suffixes=("", "_paid"))


def test_루틴_결제는_결제_내역에_있고_정해진_업종_정해진_시각_30분_안이다(t21):
    ev = _events(t21)
    assert ev.merchant_id.notna().all()
    assert (ev.kind_paid == ev.kind).all()
    fixed = ev[ev.minute >= 0]
    ts = fixed.paid_at.dt.tz_convert("Asia/Seoul")
    gap = (ts.dt.hour * 60 + ts.dt.minute + ts.dt.second / 60 - fixed.minute).abs()
    assert (gap <= 30.01).all()


def _applicable_days(days: str, start: date, end: date, holidays: set) -> int:
    n, d = 0, start
    while d <= end:
        weekend = d.weekday() >= 5 or d in holidays
        n += (days == "weekend") == weekend
        d += timedelta(days=1)
    return n


def test_루틴_실현율은_지키는_확률과_같다(t21, cfg):
    s = load_config("settings", "v2.1")
    holidays = set(cfg["holidays"])
    start, end = s["start_date"], pd.Timestamp(s["as_of"]).tz_convert("Asia/Seoul").date() - timedelta(days=1)
    r = t21["user_routines"].copy()
    got = t21["routine_events"].groupby(["user_id", "routine_no"]).size()
    r["got"] = [got.get((u, n), 0) for u, n in zip(r.user_id, r.routine_no)]
    r["days"] = [_applicable_days(d, start, end, holidays) for d in r.days_type]
    rate = r.got / r.days
    assert abs(rate.mean() - r.keep_prob.mean()) < 0.03
    assert (rate - r.keep_prob).abs().quantile(0.95) < 0.08


def test_평일_루틴은_한_달_10회_이상_강한_습관이_된다(t21):
    ev = _events(t21)
    wk = ev[ev.days_type == "weekday"]
    monthly = wk.groupby(["user_id", "routine_no", wk.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")]).size()
    assert monthly.median() >= 10


def test_루틴_없는_사용자의_결제는_v2와_똑같다(t21, t2):
    has = set(t21["user_routines"].user_id)
    key = ["user_id", "paid_at"]
    a = t21["payments"][~t21["payments"].user_id.isin(has)][COLS].sort_values(key).reset_index(drop=True)
    b = t2["payments"][~t2["payments"].user_id.isin(has)][COLS].sort_values(key).reset_index(drop=True)
    pd.testing.assert_frame_equal(a, b)


def test_결제_수와_월_지출은_v2와_비슷하다(t21, t2):
    assert len(t21["payments"]) / len(t2["payments"]) - 1 < 0.03

    def monthly(t):
        bg = t["users"][t["users"].user_type == "background"].user_id
        p = t["payments"][t["payments"].user_id.isin(bg)]
        ym = p.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")
        p = p[(ym >= "2026-01") & (ym <= "2026-10")]
        return p.groupby(["user_id", ym[p.index]]).amount.sum().groupby("user_id").mean()

    assert abs(monthly(t21).median() / monthly(t2).median() - 1) < 0.05
