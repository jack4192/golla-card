"""가상 데이터 생성 진입점.

실행: uv run python -m generate.main
결과: data/out/parquet/*.parquet (전체), data/out/csv/*.csv (마스터 + 데모 사용자 5명)
지금은 소비 데이터만 만든다. 혜택·실적은 실제 카드 상품을 매칭할 때 계산한다.
"""

import time

import numpy as np

from .benefit import load_cards
from .common import CACHE_DIR, OUT_DIR, load_config
from .masters import build_masters
from .merchants import build_merchants
from .payments import Simulator, simulate
from .users import build_users, users_frames

# DB에는 넣지 않는 생성기 전용 컬럼 (가상 사용자가 카드를 고른 이유)
TRUTH_COLS = ["choice_reason"]


def main() -> None:
    t0 = time.time()
    settings = load_config("settings")
    dists = load_config("distributions")
    rng = np.random.default_rng(settings["seed"])

    cards = load_cards(load_config("cards"))
    tables = build_masters(cards)
    merchants = build_merchants(rng)
    tables["merchants"] = merchants
    print(f"가맹점 {len(merchants)}곳 ({'카카오' if (CACHE_DIR / 'kakao_places.csv').exists() else '가상 좌표'})")

    users = build_users(rng, cards, dists, settings["n_background_users"])
    tables.update(users_frames(rng, users, settings["start_date"]))

    sim = Simulator(settings, dists, load_config("programs"), load_config("categories")["categories"],
                    load_config("places"), merchants)
    pay = simulate(sim, users)
    pay.insert(0, "payment_id", range(1, len(pay) + 1))
    tables["payments"] = pay

    write(tables)
    print(f"결제 {len(pay):,}건 · 사용자 {len(users)}명 · {time.time() - t0:.1f}초")


def write(tables: dict) -> None:
    pq, csv = OUT_DIR / "parquet", OUT_DIR / "csv"
    pq.mkdir(parents=True, exist_ok=True)
    csv.mkdir(parents=True, exist_ok=True)
    demo_ids = set(tables["users"].query("user_type == 'demo'").user_id)
    demo_cards = set(tables["user_cards"].query("user_id in @demo_ids").user_card_id)
    for name, df in tables.items():
        df.to_parquet(pq / f"{name}.parquet", index=False)
        if "user_id" in df.columns:
            df = df[df.user_id.isin(demo_ids)]
        elif "user_card_id" in df.columns:
            df = df[df.user_card_id.isin(demo_cards)]
        if name == "payments":
            df = df.drop(columns=TRUTH_COLS)
        df.to_csv(csv / f"{name}.csv", index=False)


if __name__ == "__main__":
    main()
