"""1년 가상 데이터를 최종 DB 형식(카드서비스_DB)으로 내보낸다 (2026-11-16 결정).

실행: uv run python -m generate.export_db [원본 DB 폴더] [결과 폴더]
기본: ../카드서비스_DB → ../카드서비스_DB_1년

- 카드·혜택·업종·가맹점·단말기 표는 원본 그대로 쓴다. 가맹점과 단말기에는 '동네 기타'(OTHER) 1곳만 더한다.
- 프로모션 표는 원본 5건을 지우고 SOL 페이 혜택 정보 29건을 넣는다 (2026-11-18 결정, generate.promotions).
  전체 기간(2025-11-01~원래 종료일)에 있는 행사로 보고, kind(event/myshop)·min_amount 두 칸을 더한다.
- 사용자: 데모 1~5 → test1~5(생년월일·직장명은 페르소나에 맞춤), 배경 360명 → user_id 6~365.
  원본의 test6(카드 없는 신규 사용자)은 넣지 않는다 (2026-11-16 결정).
  배경 사용자의 비밀번호 해시는 로그인할 수 없는 값이다.
- 결제: 우리 1년치 결제 전부. 혜택은 결제마다 가장 큰 혜택 1개(한도·횟수 반영), 첫 달 전월 실적은 그달 사용액과 같다고 본다.
  프로모션은 SOL페이로 낸 현장 결제(결제화면을 연 결제)에 신한카드·기간·가맹점·최소 결제액이 맞으면 가장 큰 행사 하나를
  적용한다(건당 최대 금액까지). 마이샵은 사용자·행사·달마다 30% 만 ON 을 켰다고 본다 (엔진 평가의 습관 가정과 같다).
- SOL페이 현장 결제(결제화면을 연 현장 QR 결제)는 승인번호, 사용된 결제코드, 승인된 POS 거래를 만든다.
- 원본의 더미 결제·결제코드·POS 거래는 넣지 않는다.
- 추가 표: zones, user_profiles, user_card_details, payment_details, card_month_status.
"""

import hashlib
import hmac
import shutil
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

from .benefit import CardMonth, apply, evaluate, pay_method
from .card_db import load_cards
from .common import DATA_DIR, OUT_DIR, load_config
from .promotions import best_promotion, db_frame, final_promotions, index_by_merchant

HMAC_SECRET = b"demo-hmac-secret-change-me"   # 원본 테스트 가이드의 테스트용 비밀키
NO_LOGIN = "!login-disabled"                  # bcrypt 형식이 아니라 어떤 비밀번호로도 맞지 않는다
TODAY = date(2026, 11, 16)
SEED = 20261116

# 원본 그대로 복사하는 표
COPY = ["categories", "merchant_aliases", "cards", "card_perks", "card_tiers", "benefit_groups",
        "benefit_group_tiers", "benefits", "benefit_targets", "benefit_tiers"]

# 데모 계정 프로필을 페르소나에 맞춘 값 (이름·이메일·비밀번호·동의 상태는 원본 그대로)
DEMO_PROFILE = {
    3: {"birth_date": "1973-11-23", "workplace_name": None},
    4: {"birth_date": "2000-01-30", "workplace_name": "가산디지털단지 직장인"},
    5: {"birth_date": "1991-05-05", "workplace_name": "재택근무"},
}
AGE = {"20s": (20, 29), "30s": (30, 39), "40s": (40, 49), "50s": (50, 59)}
SURNAMES = list("김이박최정강조윤장임한오서신권황안송류홍")
GIVEN = ["민준", "서연", "지호", "하은", "도윤", "수아", "예준", "지유", "시우", "서윤", "주원", "하린", "지훈", "채원",
         "현우", "지민", "건우", "다은", "우진", "수빈", "선우", "예린", "민재", "소율", "윤호", "가은", "정우", "나연",
         "승현", "유진", "태윤", "서현", "재민", "은서", "동현", "혜원", "성민", "지아", "준혁", "미정"]


def copy_original(src: Path, dst: Path, names: list[str]) -> None:
    """원본 그대로 쓰는 표는 파일을 그대로 복사한다. pandas 로 읽었다 쓰면 빈칸이 있는 정수 칸이 0.0 처럼 소수로 바뀌어
    PostgreSQL INTEGER 칸에 적재되지 않는다 (2026-11-18)."""
    dst.mkdir(parents=True, exist_ok=True)
    for name in names:
        shutil.copyfile(src / f"{name}.csv", dst / f"{name}.csv")


def main(src: Path, dst: Path) -> None:
    rng = np.random.default_rng(SEED)
    pq = OUT_DIR / "parquet"
    users = pd.read_parquet(pq / "users.parquet")
    ucards = pd.read_parquet(pq / "user_cards.parquet")
    pays = pd.read_parquet(pq / "payments.parquet")
    merch = pd.read_parquet(pq / "merchants.parquet")
    db = {name: pd.read_csv(src / f"{name}.csv", encoding="utf-8-sig") for name in
          COPY + ["users", "user_cards", "merchants", "terminals"]}

    copy_original(src, dst, COPY)

    merchants, terminals = _merchants(db, rng)
    user_map = _user_map(users)
    out_users, profiles = _users(db["users"], users, user_map, rng)
    out_ucards, ucard_details = _user_cards(db["user_cards"], ucards, user_map)
    payments, details, month = _payments(pays, merch, ucards, db, merchants)
    merchants, terminals, near = _branches(payments, details, merchants, terminals, rng)
    codes, pos = _codes(payments, details, merchants, terminals, near, rng)
    zones = pd.DataFrame(load_config("zones")["zones"])[["code", "name", "lat", "lng"]].rename(
        columns={"code": "zone_code", "name": "zone_name", "lat": "latitude", "lng": "longitude"})

    frames = {"promotions": db_frame(merch), "users": out_users, "merchants": merchants, "terminals": terminals,
              "user_cards": out_ucards,
              "payments": payments, "payment_codes": codes, "pos_transactions": pos, "zones": zones,
              "user_profiles": profiles, "user_card_details": ucard_details, "payment_details": details,
              "card_month_status": month}
    for name, df in frames.items():
        df.to_csv(dst / f"{name}.csv", index=False)
    for name in ("schema.sql", "load_all.sql", "테이블_명세서.csv", "테스트_가이드.md"):
        if not (dst / name).exists():
            shutil.copy(src / name, dst / name)
    print(f"저장: {dst}")
    for name in COPY + list(frames):
        print(f"  {name:22s} {len(pd.read_csv(dst / f'{name}.csv', usecols=[0])):>9,}행")


def _merchants(db: dict, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    """원본 가맹점·단말기 + 대표 가맹점이 없는 OTHER 업종용 '동네 기타' 1곳."""
    m, t = db["merchants"].copy(), db["terminals"].copy()
    mid, tid = int(m.merchant_id.max()) + 1, int(t.terminal_id.max()) + 1
    m.loc[len(m)] = {"merchant_id": mid, "merchant_name": "동네 기타", "branch_name": "본점", "category": "OTHER",
                     "latitude": 37.5665, "longitude": 126.978, "in_mall": False}
    key = rng.bytes(16).hex()   # 원문은 저장하지 않는다 (원본 단말기와 같은 방식)
    t.loc[len(t)] = {"terminal_id": tid, "merchant_id": mid, "key_hash": hashlib.sha256(key.encode()).hexdigest()}
    return m, t


def _user_map(users: pd.DataFrame) -> dict[int, int]:
    """우리 user_id → DB user_id. 데모 1~5는 그대로, 배경은 6부터."""
    demo = {int(u): int(u) for u in users[users.user_type == "demo"].user_id}
    bg = sorted(int(u) for u in users[users.user_type == "background"].user_id)
    return demo | {u: 6 + i for i, u in enumerate(bg)}


def _users(db_users: pd.DataFrame, users: pd.DataFrame, user_map: dict, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    zone = {z["code"]: z["name"] for z in load_config("zones")["zones"]}
    rows = []
    for r in db_users[db_users.user_id.isin(range(1, 6))].itertuples(index=False):   # test1~5만 (test6 제외)
        row = r._asdict()
        row.update(DEMO_PROFILE.get(int(r.user_id), {}))
        rows.append(row)
    bg = users[users.user_type == "background"].copy()
    bg["db_id"] = bg.user_id.map(user_map)
    for r in bg.sort_values("db_id").itertuples():
        lo, hi = AGE[r.age_band]
        age = int(rng.integers(lo, hi + 1))
        born = pd.Timestamp(TODAY) - pd.DateOffset(years=age) - pd.Timedelta(days=int(rng.integers(1, 365)))
        if r.persona_code == "STUDENT":
            work = "대학생"
        elif r.persona_code == "REMOTE":
            work = "재택근무"
        elif isinstance(r.work_zone, str):
            work = f"{zone[r.work_zone]} 직장인"
        else:
            work = None
        rows.append({
            "user_id": r.db_id, "name": rng.choice(SURNAMES) + rng.choice(GIVEN), "birth_date": born.date().isoformat(),
            "phone": f"010-1000-{r.db_id:04d}", "email": f"user{r.db_id:04d}@example.com", "password_hash": NO_LOGIN,
            "mydata_agreed": None, "location_agreed": rng.choice([True, None, False], p=[0.6, 0.25, 0.15]),
            "workplace_name": work,
        })
    out = pd.DataFrame(rows)
    # 다른 카드사 카드가 있으면 마이데이터 동의, 신한만 있으면 동의 또는 미응답
    ucards = pd.read_parquet(OUT_DIR / "parquet" / "user_cards.parquet")
    other = {user_map[int(u)] for u in ucards[ucards.issuer_code != "SHINHAN"].user_id}
    bg_ids = set(bg.db_id)
    out.loc[out.user_id.isin(bg_ids), "mydata_agreed"] = [
        True if u in other else (True if rng.random() < 0.7 else None) for u in out.user_id[out.user_id.isin(bg_ids)]]
    for col in ("mydata_agreed", "location_agreed"):
        out[col] = out[col].astype("boolean")

    prof = users.assign(user_id=users.user_id.map(user_map))[
        ["user_id", "user_type", "persona_code", "age_band", "gender", "home_zone", "work_zone", "weekend_zone",
         "kpass_tier", "special_groups", "created_at"]].copy()
    prof["created_at"] = _naive(prof.created_at)
    return out, prof.sort_values("user_id")


def _user_cards(db_uc: pd.DataFrame, ucards: pd.DataFrame, user_map: dict) -> tuple[pd.DataFrame, pd.DataFrame]:
    """데모 카드 15장은 원본 행(끝 4자리·목표 구간)을 그대로, 배경 카드는 목표 구간 미설정."""
    demo = db_uc.set_index("user_card_id")
    rows = []
    for r in ucards.sort_values("user_card_id").itertuples():
        if r.user_card_id in demo.index:
            d = demo.loc[r.user_card_id]
            assert int(d.card_id) == int(r.card_id) and int(d.user_id) == user_map[int(r.user_id)], r
            rows.append({"user_card_id": r.user_card_id, "user_id": int(d.user_id), "card_id": int(d.card_id),
                         "card_last4": f"{int(d.card_last4):04d}", "target_tier_id": d.target_tier_id})
        else:
            rows.append({"user_card_id": r.user_card_id, "user_id": user_map[int(r.user_id)], "card_id": r.card_id,
                         "card_last4": r.masked_number[-4:], "target_tier_id": None})
    out = pd.DataFrame(rows)
    out["target_tier_id"] = out.target_tier_id.astype("Int64")
    det = ucards[["user_card_id", "registered_via", "display_order", "exclude_from_placement", "is_kpass_registered",
                  "is_transit_default", "is_bill_card", "issued_at"]].sort_values("user_card_id")
    return out, det


def _naive(s: pd.Series) -> pd.Series:
    """한국 시간 TIMESTAMP(시간대 없음, 초 단위)."""
    s = pd.to_datetime(s)
    if s.dt.tz is not None:
        s = s.dt.tz_convert("Asia/Seoul").dt.tz_localize(None)
    return s.dt.floor("s")


def _payments(pays, merch, ucards, db, merchants) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    cards = {c.card_id: c for c in load_cards()}
    cat_name = dict(zip(db["categories"].category, db["categories"].category_name))
    local = {c: n for n, c in zip(merchants.merchant_name, merchants.category) if n.startswith("동네 ")}
    brand = dict(zip(merch.merchant_id, merch.brand_code))
    zone = dict(zip(merch.merchant_id, merch.zone_code))

    p = pays.sort_values(["paid_at", "payment_id"], kind="stable").reset_index(drop=True)
    p["brand"] = p.merchant_id.map(brand)
    p["merchant_name"] = [b if isinstance(b, str) else local.get(c, f"동네 {cat_name[c]}")
                          for b, c in zip(p.brand, p.category_code)]
    p["ym"] = p.paid_at.dt.tz_convert("Asia/Seoul").dt.strftime("%Y-%m")
    p["pay"] = [pay_method(ch, mode) for ch, mode in zip(p.channel, p.card_select_mode)]

    # 전월 실적: 첫 달은 그달 사용액과 같다고 본다
    perf = p.groupby(["user_card_id", "ym"]).amount.sum()
    months = sorted(p.ym.unique())
    prev = {}
    for (uc, ym), v in perf.items():
        i = months.index(ym)
        prev[(uc, ym)] = v if i == 0 else int(perf.get((uc, months[i - 1]), 0))

    promo_index = index_by_merchant(final_promotions(), merch)

    ben_id, ben_amt, pro_id, pro_amt = [], [], [], []
    states: dict[tuple, CardMonth] = {}
    paid_local = _naive(p.paid_at)
    for r, when in zip(p.itertuples(), paid_local):
        key = (r.user_card_id, r.ym)
        st = states.get(key)
        if st is None:
            st = states[key] = CardMonth(prev_perf=prev.get(key, 0))
        brand_code = r.brand if isinstance(r.brand, str) else None
        pay = r.pay if isinstance(r.pay, str) else None   # pandas 문자열 열은 None 을 NaN 으로 바꾼다
        got, b = evaluate(cards[r.card_id], r.category_code, r.amount, st, r.paid_at, brand_code, pay)
        apply(st, r.amount, got, b, when=r.paid_at)
        ben_id.append(b.source_id if b is not None and got > 0 else None)
        ben_amt.append(int(got) if b is not None else 0)
        # SOL페이 이벤트·마이샵은 SOL페이로 낸 현장 결제에만 붙는다 (엔진 평가와 같다)
        best_id, best = (best_promotion(promo_index, int(r.user_id), r.merchant_id, r.issuer_code, int(r.amount),
                                        when.date()) if pay == "SOLPAY" else (None, 0))
        pro_id.append(best_id)
        pro_amt.append(best)

    p["payment_id"] = np.arange(1, len(p) + 1)
    out = pd.DataFrame({
        "payment_id": p.payment_id, "user_card_id": p.user_card_id, "merchant_name": p.merchant_name,
        "category": p.category_code, "amount": p.amount, "paid_at": paid_local,
        "benefit_id": pd.array(ben_id, dtype="Int64"), "benefit_amount": ben_amt,
        "promotion_id": pd.array(pro_id, dtype="Int64"), "promotion_amount": pro_amt, "approval_no": None,
    })
    is_code = p.pay.eq("SOLPAY") & p.channel.eq("offline_qr")
    out.loc[is_code, "approval_no"] = [f"A{i:07d}" for i in range(1, int(is_code.sum()) + 1)]
    details = pd.DataFrame({
        "payment_id": p.payment_id, "channel": p.channel, "card_select_mode": p.card_select_mode,
        "source": p.source, "synced_at": _naive(p.synced_at), "zone_code": p.merchant_id.map(zone),
        "source_merchant_id": p.merchant_id,
        "is_placement": p.pay.eq("SOLPAY"), "is_scenario": p.is_scenario,
    })

    tiers = db["card_tiers"].sort_values("min_amount")
    owner = dict(zip(ucards.user_card_id, ucards.card_id))
    for uc in owner:   # 결제가 없는 달도 카드마다 한 행 (생성기 card_month_status 와 같다)
        for i, ym in enumerate(months):
            if (uc, ym) not in states:
                states[(uc, ym)] = CardMonth(prev_perf=0 if i == 0 else int(perf.get((uc, months[i - 1]), 0)))
    tier_list = {c: list(zip(g.min_amount, g.tier_id)) for c, g in tiers.groupby("card_id")}
    promo_sum = out.promotion_amount.groupby([out.user_card_id, p.ym]).sum()
    rows = []
    for (uc, ym), st in sorted(states.items()):
        reached = [tid for lo, tid in tier_list.get(owner[uc], []) if lo <= st.prev_perf]
        rows.append({"user_card_id": uc, "year_month": ym, "prev_perf": st.prev_perf, "perf": st.perf,
                     "tier_id": int(reached[-1]) if reached else None, "benefit_amount": st.discount,
                     "promotion_amount": int(promo_sum.get((uc, ym), 0)), "txn_count": st.txn})
    month = pd.DataFrame(rows)
    month["tier_id"] = month.tier_id.astype("Int64")
    return out, details, month


def _branches(payments, details, merchants, terminals, rng) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """SOL페이 현장 결제가 있는 (브랜드 × 생활권)마다 그 동네 지점과 단말기를 1개씩 더한다 (2026-11-16 결정).

    좌표는 생활권 중심 반경 500m 안의 가상 좌표다 (카카오 좌표를 쓰지 않는다). 원본 가맹점·단말기는 그대로 둔다.
    돌려주는 near 는 (브랜드, 생활권) → 단말기 ID.
    """
    zones = {z["code"]: z for z in load_config("zones")["zones"]}
    category = merchants.drop_duplicates("merchant_name").set_index("merchant_name").category
    taken = set(zip(merchants.merchant_name, merchants.branch_name))
    pc = payments[payments.approval_no.notna()][["payment_id", "merchant_name"]].merge(
        details[["payment_id", "zone_code"]], on="payment_id").dropna(subset=["zone_code"])
    m_rows, t_rows, near = [], [], {}
    mid, tid = int(merchants.merchant_id.max()), int(terminals.terminal_id.max())
    for name, zc in sorted(set(zip(pc.merchant_name, pc.zone_code))):
        z = zones[zc]
        branch = f"{z['name']}점" if (name, f"{z['name']}점") not in taken else f"{z['name']}중앙점"
        r, a = 0.5 * np.sqrt(rng.random()), rng.uniform(0, 2 * np.pi)   # km, 원 안에 고르게
        mid, tid = mid + 1, tid + 1
        m_rows.append({"merchant_id": mid, "merchant_name": name, "branch_name": branch, "category": category[name],
                       "latitude": round(z["lat"] + r * np.cos(a) / 111.0, 6),
                       "longitude": round(z["lng"] + r * np.sin(a) / 88.2, 6), "in_mall": False})
        key = rng.bytes(16).hex()   # 원문은 저장하지 않는다
        t_rows.append({"terminal_id": tid, "merchant_id": mid, "key_hash": hashlib.sha256(key.encode()).hexdigest()})
        near[(name, zc)] = tid
    return (pd.concat([merchants, pd.DataFrame(m_rows)], ignore_index=True),
            pd.concat([terminals, pd.DataFrame(t_rows)], ignore_index=True), near)


def _codes(payments, details, merchants, terminals, near, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    """SOL페이 현장 결제마다 사용된 결제코드 1개와 승인된 POS 거래 1개.

    단말기는 결제한 생활권의 같은 브랜드 지점(near). 생활권이 없는 결제만 원본 가맹점 중 같은 이름에서 고른다.
    """
    term_of = terminals.groupby("merchant_id").terminal_id.first()
    by_name: dict[str, list[int]] = {}
    for mid, name in zip(merchants.merchant_id, merchants.merchant_name):
        if mid in term_of.index:
            by_name.setdefault(name, []).append(int(term_of[mid]))
    pc = payments[payments.approval_no.notna()].reset_index(drop=True)
    n = len(pc)
    digits = rng.integers(0, 10, size=(n, 18))
    codes = ["".join(map(str, row)) for row in digits]
    hashes = [hmac.new(HMAC_SECRET, c.encode(), hashlib.sha256).hexdigest() for c in codes]
    assert len(set(hashes)) == n
    issued = pc.paid_at - pd.to_timedelta(rng.integers(3, 41, size=n), unit="s")
    zone_of = dict(zip(details.payment_id, details.zone_code))
    terms = [near.get((name, zone_of[pid])) or by_name[name][int(rng.integers(len(by_name[name])))]
             for pid, name in zip(pc.payment_id, pc.merchant_name)]
    codes_df = pd.DataFrame({"code_id": np.arange(1, n + 1), "user_card_id": pc.user_card_id, "code_hash": hashes,
                             "expires_at": issued + pd.Timedelta(seconds=60), "status": "USED",
                             "payment_id": pc.payment_id})
    pos = pd.DataFrame({"txn_id": np.arange(1, n + 1), "terminal_id": terms, "code_hash": hashes,
                        "amount": pc.amount, "requested_at": pc.paid_at, "payment_id": pc.payment_id,
                        "decline_reason": None})
    return codes_df, pos


if __name__ == "__main__":
    root = DATA_DIR.parent
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "카드서비스_DB"
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "카드서비스_DB_1년"
    main(src, dst)
