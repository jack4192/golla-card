"""시간순 재생 평가. 매 결제 시점에 그 이전 기록만 보고 실제 서비스와 같은 엔진으로 배치한다.

    uv run python -m evaluation.replay                    # 위치 동의·미동의 버전 평가
    uv run python -m evaluation.replay --upper-bound      # 결제를 미리 안다고 가정한 상한
    uv run python -m evaluation.replay --choice first     # 2장이어도 항상 1순위 사용
    uv run python -m evaluation.replay --accept 0.7       # 추천 수락률 70%
    uv run python -m evaluation.replay --category-model v2 --start 2026-10   # 10월만, 업종 모델 v2
"""

import argparse
import heapq
import json
import multiprocessing as mp
import os
import time
from dataclasses import asdict, dataclass, replace

import numpy as np
import pandas as pd

os.environ.setdefault("OMP_NUM_THREADS", "1")

from engine import loader
from engine.benefit_calc import evaluate
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, RankRequest, User
from engine.loader import ARTIFACTS
from engine.params import Params
from engine.service import PlacementEngine
from engine.slots import ym_of
from engine.state import UserState
from evaluation.location_sim import simulate
from training.build_priors import priors_from_frame

BENEFIT_START = "2026-08"       # 첫 달은 전월 실적이 없어 혜택 없이 실적만 쌓는다
SEED = 20261127


@dataclass(frozen=True)
class ReplayConfig:
    start: str = "2026-08"
    until: str = "9999-12"              # 이 달 전까지 배치한다
    use_location: bool = True           # 위치 동의자에게 위치를 쓴다
    force_no_location: bool = False     # 동의자도 미동의 버전으로 계산한다
    loc_error_m: float = 30.0           # 위치 오차 (가정값)
    loc_fail: float = 0.3               # 위치 실패율 (가정값)
    choice: str = "best_shown"          # best_shown: 2장 중 유리한 카드 선택 / first: 항상 1순위
    accept: float = 1.0
    upper_bound: bool = False
    category_model: str = "v1"
    keep_rows: bool = False
    params: Params = Params()


class Data:
    """프로세스마다 한 번만 읽는다."""
    catalog = None
    users = None
    cards = None
    payments = None
    priors = None
    model = None


def prepare() -> None:
    frame = loader.read_payments()
    Data.catalog = loader.load_catalog()
    Data.users = loader.load_users()
    Data.cards = loader.load_user_cards()
    Data.payments = loader.payments_from_frame(frame)
    Data.priors = {}
    for ym in sorted(frame.paid_at.dt.strftime("%Y-%m").unique()):
        start = pd.Timestamp(f"{ym}-01", tz="Asia/Seoul")
        Data.priors[ym] = priors_from_frame(frame[frame.paid_at < start], Params(), ym)  # 월초 기준, 미래 금지


def _snapshot(state: UserState) -> dict:
    return {uc: (st.prev_perf, st.perf, st.discount) for uc, st in state.ledger.items()}


def replay_user(user_id: int, cfg: ReplayConfig) -> dict:
    user = Data.users[user_id]
    if cfg.force_no_location:
        user = User(user.user_id, False, False)
    cards = Data.cards[user_id]
    catalog, params = Data.catalog, cfg.params
    model = Data.model if cfg.category_model == "v2" else None
    engine = PlacementEngine(catalog, Data.priors["2026-07"], params, model)
    truth = UserState(user, cards, catalog, params, BENEFIT_START)
    habit = UserState(user, cards, catalog, params, BENEFIT_START)
    view = UserState(user, cards, catalog, params, BENEFIT_START)
    location_rng = np.random.default_rng([SEED, user_id])
    accept_rng = np.random.default_rng([SEED + 1, user_id])

    pending: list = []
    months: dict[str, dict] = {}
    current = None
    last_base = None
    base_changes = 0
    latencies, rows = [], []
    total = dict(benefit=0, habit=0, spend=0, events=0, swaps=0, swaps_perf=0, two=0, repeat=0, hit=0,
                 modes={}, best=0, place_benefit=0, place_habit=0)

    for seq, p in enumerate(Data.payments.get(user_id, [])):
        while pending and pending[0][0] <= p.paid_at:
            view.apply(heapq.heappop(pending)[2])
        ym = ym_of(p.paid_at)
        if ym != current:
            if current is not None:
                months[current] = {"algo": _snapshot(truth), "habit": _snapshot(habit)}
            current = ym
        habit_got = habit.apply(p)
        chosen, result = p.user_card_id, None
        if p.is_placement and cfg.start <= ym < cfg.until:
            engine.priors = Data.priors[ym]
            lat = lng = accuracy = None
            if cfg.use_location and user.location_enabled:
                point = simulate(catalog, p.merchant_id, location_rng, cfg.loc_error_m, cfg.loc_fail)
                if point:
                    lat, lng, accuracy = point
            known = KnownPayment(p.category, p.amount, p.merchant_id) if cfg.upper_bound else None
            started = time.perf_counter()
            result = engine.rank_state(view, RankRequest(user_id, p.paid_at, lat, lng, accuracy),
                                       last_base=last_base, known=known)
            latencies.append(time.perf_counter() - started)
            if last_base is not None and last_base != result.base_card:
                base_changes += 1
            last_base = result.base_card

            truth.roll_to(ym)
            shown = [c.user_card_id for c in result.cards[:result.display_count]]
            gains = {c.user_card_id: evaluate(catalog.cards[c.card_id], p.category, p.amount,
                                              truth.ledger[c.user_card_id], p.paid_at)[0]
                     for c in view.cards}
            chosen = shown[0]
            if cfg.choice == "best_shown":
                chosen = max(shown, key=lambda uc: (gains[uc], -shown.index(uc)))
            if cfg.accept < 1 and accept_rng.random() > cfg.accept:
                chosen = p.user_card_id
        actual = replace(p, user_card_id=chosen)
        got = truth.apply(actual)
        if p.is_placement:
            view.apply(actual)
        else:
            heapq.heappush(pending, (p.visible_at, seq, actual))

        if ym >= cfg.start and ym < cfg.until:
            total["benefit"] += got
            total["habit"] += habit_got
            total["spend"] += p.amount
        if result is not None:
            total["events"] += 1
            total["swaps"] += result.swapped
            total["swaps_perf"] += result.swap_reason == "performance"
            total["two"] += result.display_count > 1
            total["repeat"] += result.repeat_applied
            total["hit"] += result.top_category == p.category
            total["best"] += max(gains.values())
            total["place_benefit"] += got
            total["place_habit"] += habit_got
            total["modes"][result.scenario_mode] = total["modes"].get(result.scenario_mode, 0) + 1
            if cfg.keep_rows:
                rows.append({"payment": p, "result": result, "chosen": chosen, "got": got, "habit_got": habit_got,
                             "best": max(gains.values())})
    months[current] = {"algo": _snapshot(truth), "habit": _snapshot(habit)}

    perf = dict(ok=0, total=0, habit_ok=0, habit_total=0)
    card_ids = truth.card_ids
    for ym, snap in months.items():
        if ym < "2026-08" or ym > "2026-10":
            continue
        for key, ok, count in (("algo", "ok", "total"), ("habit", "habit_ok", "habit_total")):
            for uc, (prev_perf, month_perf, _) in snap[key].items():
                first = catalog.first_tier(card_ids[uc])
                if month_perf > 0 and first:
                    perf[count] += 1
                    perf[ok] += prev_perf >= first
    return {"user_id": user_id, "location": user.location_enabled, **total, **perf, "base_changes": base_changes,
            "latency": latencies, "months": months, "rows": rows}


def _job(args):
    return replay_user(*args)


def run(cfg: ReplayConfig, user_ids: list[int] | None = None, workers: int | None = None) -> list[dict]:
    ctx = mp.get_context("fork")
    if Data.users is None:
        prepare()
    ids = user_ids or sorted(Data.users)
    workers = workers or min(os.cpu_count() or 4, 8)
    with ctx.Pool(workers, initializer=_load_model, initargs=(cfg.category_model,)) as pool:
        return pool.map(_job, [(u, cfg) for u in ids], chunksize=4)


def _load_model(category_model: str) -> None:
    if category_model == "v2":
        Data.model = CategoryModel.load(ARTIFACTS)
        if Data.model is None:
            raise FileNotFoundError("업종 모델이 없습니다. `uv run python -m training.train_category` 를 먼저 실행하세요.")


def summarize(results: list[dict]) -> dict:
    n = lambda key: sum(r[key] for r in results)
    events = max(n("events"), 1)
    latency = np.concatenate([r["latency"] for r in results]) if any(r["latency"] for r in results) else np.array([0.0])
    return {
        "사용자": len(results), "배치 건수": n("events"),
        "혜택률": round(n("benefit") / max(n("spend"), 1) * 100, 3),
        "습관 혜택률": round(n("habit") / max(n("spend"), 1) * 100, 3),
        "교체": round(n("swaps") / events * 100, 1),
        "실적 교체 비중": round(n("swaps_perf") / max(n("swaps"), 1) * 100, 1),
        "2장 표시": round(n("two") / events * 100, 1),
        "반복 구간": round(n("repeat") / events * 100, 1),
        "1위 업종 적중": round(n("hit") / events * 100, 1),
        "결제별 최대 대비": round(n("place_benefit") / max(n("best"), 1) * 100, 1),
        "실적 충족": round(n("ok") / max(n("total"), 1) * 100, 1),
        "습관 실적 충족": round(n("habit_ok") / max(n("habit_total"), 1) * 100, 1),
        "기본 카드 변경/인": round(n("base_changes") / max(len(results), 1), 1),
        "엔진 계산 p95(ms)": round(float(np.percentile(latency, 95)) * 1000, 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", default="2026-08")
    parser.add_argument("--until", default="9999-12")
    parser.add_argument("--choice", choices=["best_shown", "first"], default="best_shown")
    parser.add_argument("--accept", type=float, default=1.0)
    parser.add_argument("--loc-error", type=float, default=30.0)
    parser.add_argument("--loc-fail", type=float, default=0.3)
    parser.add_argument("--upper-bound", action="store_true")
    parser.add_argument("--category-model", choices=["v1", "v2"], default="v1")
    parser.add_argument("--switch", type=int, default=None, help="전환 기준(원)")
    parser.add_argument("--two-loss", type=int, default=None, help="2장 손실 기준(원)")
    parser.add_argument("--base-order", choices=["first_tier", "top_tier"], default=None)
    args = parser.parse_args()
    changes = {k: v for k, v in (("switch_threshold", args.switch), ("two_card_loss", args.two_loss),
                                 ("base_order", args.base_order)) if v is not None}
    cfg = ReplayConfig(start=args.start, until=args.until, choice=args.choice, accept=args.accept,
                       loc_error_m=args.loc_error, loc_fail=args.loc_fail, upper_bound=args.upper_bound,
                       category_model=args.category_model, params=Params().with_(**changes))
    results = run(cfg)
    groups = {"위치 동의 버전": [r for r in results if r["location"]],
              "위치 미동의 버전": [r for r in results if not r["location"]],
              "전체": results}
    table = pd.DataFrame({name: summarize(rows) for name, rows in groups.items() if rows})
    pd.set_option("display.unicode.east_asian_width", True)
    print(table.to_string())
    path = ARTIFACTS / "reports" / "replay_latest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"config": {**asdict(cfg), "params": None}, "result": table.to_dict()},
                               ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\n저장: {path}")


if __name__ == "__main__":
    main()
