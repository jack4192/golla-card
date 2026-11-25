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
from engine.benefit_calc import evaluate, month_reward
from engine.ml import fold_models
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, RankRequest, ScheduleItem, User
from engine.loader import ARTIFACTS
from engine.params import Params
from engine.service import PlacementEngine
from engine.slots import ym_of
from engine.state import UserState
from training.build_priors import priors_from_frame

BENEFIT_START = "2025-12"       # 첫 달(2025-11)은 전월 실적이 없어 혜택 없이 실적만 쌓는다
SEED = 20261127


@dataclass(frozen=True)
class ReplayConfig:
    start: str = "2026-01"              # 2025-11~12 은 이력으로만 쓴다
    until: str = "9999-12"              # 이 달 전까지 배치한다
    schedule: bool = False              # 사용자가 하루 일정을 미리 입력했다고 가정한다 (가정값, 2026-11-14)
    schedule_special: float = 0.3       # 평소와 다른 결제(최근 90일 그 업종 결제 1번 이하)를 미리 입력하는 비율
    schedule_normal: float = 0.1        # 그 밖의 현장 결제를 미리 입력하는 비율
    schedule_noise: float = 0.2         # 입력한 금액이 실제와 다른 정도 (±)
    choice: str = "best_shown"          # best_shown: 2장 중 유리한 카드 선택 / first: 항상 1순위
    accept: float = 1.0
    upper_bound: bool = False
    category_model: str = "v2"          # 업종 예측 LightGBM (v1: 시간대 빈도)
    ml: bool = False                    # 남은 소비 예측·전략 선택 모델 (배경 사용자는 자기를 뺀 겹 모델)
    use_promotions: bool = True         # 실제 이벤트·마이샵 목록을 혜택에 넣는다 (v3 는 점수에도)
    # 프로모션 목록 (2026-11-18): db = 팀 DB 의 행사(데이터 promotions.parquet), yaml = 일정 팝업용 31건
    # (data/config/promotions.yml, 2026-11), yaml_monthly = 같은 31건이 2025-11~2026-11 매달 같은 날짜에 반복된다고 가정
    promotion_source: str = "db"
    # 일정 팝업 (설계서 v4.1): 일정이 있는 날, 카드 추천 날(날짜 순번 % 3 == 0)이 아니면 그날 첫 결제 전에
    # 일정 맞춤 프로모션을 추천했다고 보고, 그 일정 시간에는 프로모션 카드를 1순위로 둔다
    popup: bool = False
    # 마이샵 ON (2026-11-18 팀 결정): 마이샵 행사는 ON 을 켜야 받는다. 사용자·행사·달마다 이 비율로 ON 을 켰다고 본다.
    # 습관대로 결제는 이 ON 만 받는다. 이 엔진은 같은 ON 에 더해, 앱이 알려 준 마이샵(일정 팝업 추천 브랜드, 안내 문구의
    # 행사)은 그 달 동안 켰다고 본다. 결제별 최대·사후 최적 상한은 모두 켰다고 본다. SOL페이 이벤트는 ON 이 필요 없다.
    myshop_on: float = 0.3
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
    promotions = []
    promotion_sets: dict = {}
    folds: dict = {}
    ml: dict = {}


def myshop_on(user_id: int, promotion, ym: str, share: float) -> bool:
    """이 사용자가 그 달 이 마이샵 행사를 ON 으로 켰는지. 사용자·행사·달마다 고정된 난수로 정한다."""
    if share >= 1:
        return True
    if share <= 0:
        return False
    key = int(ym[:4]) * 100 + int(ym[5:7])
    return bool(np.random.default_rng([SEED + 3, user_id, promotion.promotion_id, key]).random() < share)


def promo_received(promotions: list, merchant_id: int | None, issuer: str, card_id: int, amount: int, at,
                   allowed) -> int:
    """이 결제에서 실제로 받는 프로모션: 조건이 맞는 행사 중 가장 큰 하나. 마이샵은 allowed(행사) 일 때만 받는다."""
    if merchant_id is None:
        return 0
    best = 0
    for p in promotions:
        value = p.value(merchant_id, issuer, card_id, amount, at)
        if value > best and (p.kind != "myshop" or allowed(p)):
            best = value
    return best


def monthly_copies(promotions: list, months: list[str]) -> list:
    """평가용: 행사가 매달 같은 날짜 범위로 반복된다고 보고 달마다 복사한다. 시작일이 같고, 끝은 원래 끝 날짜
    (달을 넘기거나 30일 이후로 끝나면 그달 말일)."""
    import calendar
    from datetime import datetime
    out, next_id = [], 1_000_000
    for p in promotions:
        s, e = p.starts_at, p.ends_at
        for ym in months:
            year, month = int(ym[:4]), int(ym[5:7])
            last = calendar.monthrange(year, month)[1]
            end_day = last if (e.month != s.month or e.day >= 30) else min(e.day, last)
            next_id += 1
            out.append(replace(p, promotion_id=next_id,
                               starts_at=datetime(year, month, min(s.day, last), tzinfo=s.tzinfo),
                               ends_at=datetime(year, month, end_day, 23, 59, 59, tzinfo=e.tzinfo)))
    return out


def promotions_for(source: str) -> list:
    if source == "db":
        return Data.promotions
    if source not in Data.promotion_sets:
        popup = loader.load_popup_promotions(Data.catalog)
        months = sorted({ym for rows in Data.payments.values() for ym in {ym_of(p.paid_at) for p in rows}})
        Data.promotion_sets["yaml"] = popup
        Data.promotion_sets["yaml_monthly"] = monthly_copies(popup, months)
    return Data.promotion_sets[source]


def prepare() -> None:
    frame = loader.read_payments()
    Data.catalog = loader.load_catalog()
    Data.users = loader.load_users()
    Data.cards = loader.load_user_cards()
    Data.payments = loader.payments_from_frame(frame)
    Data.promotions = loader.load_promotions(Data.catalog)
    Data.folds, Data.ml = fold_models(ARTIFACTS)
    Data.priors = {}
    for ym in sorted(frame.paid_at.dt.strftime("%Y-%m").unique()):
        start = pd.Timestamp(f"{ym}-01", tz="Asia/Seoul")
        Data.priors[ym] = priors_from_frame(frame[frame.paid_at < start], Params(), ym)  # 월초 기준, 미래 금지


def _popup_offers(view: UserState, items, promotions, at, params: Params) -> dict | None:
    """일정 팝업 (설계서 v4.1). 카드 추천 날(날짜 순번 % 3 == 0, 3일에 한 번)이면 프로모션을 추천하지 않는다."""
    from engine.popup import offers_by_item, promotion_offers
    if at.date().toordinal() % params.recommend_interval_days == 0:
        return None
    view.roll_to(ym_of(at))
    offers = promotion_offers(view, list(items), promotions, at, params)[:params.popup_promotions]
    return offers_by_item(offers) if offers else None


def _snapshot(state: UserState) -> dict:
    """카드별 (전월 실적, 당월 실적, 받은 혜택). 받은 혜택에는 전월 실적만 보고 주는 월 리워드를 더한다 (생성기와 같게)."""
    active = state.benefit_start is None or (state.ym or "") >= state.benefit_start
    return {uc: (st.prev_perf, st.perf,
                 st.discount + (month_reward(state.catalog.cards[state.card_ids[uc]], st.prev_perf) if active else 0))
            for uc, st in state.ledger.items()}


def replay_user(user_id: int, cfg: ReplayConfig) -> dict:
    user = Data.users[user_id]
    cards = Data.cards[user_id]
    catalog, params = Data.catalog, cfg.params
    model = Data.model if cfg.category_model == "v2" else None
    models = None
    if cfg.ml:
        fold = Data.folds.get(user_id)
        models = Data.ml["full" if fold is None else f"fold{fold}"]
    engine = PlacementEngine(catalog, Data.priors[min(Data.priors)], params, model, models)
    truth = UserState(user, cards, catalog, params, BENEFIT_START)
    habit = UserState(user, cards, catalog, params, BENEFIT_START)
    view = UserState(user, cards, catalog, params, BENEFIT_START)
    schedule_rng = np.random.default_rng([SEED + 2, user_id])
    day_schedules = _schedules(user_id, cfg, schedule_rng) if cfg.schedule else {}
    accept_rng = np.random.default_rng([SEED + 1, user_id])

    initial_selected = False
    pending: list = []
    months: dict[str, dict] = {}
    current = None
    last_base = None
    base_changes = 0
    latencies, rows = [], []
    total = dict(benefit=0, habit=0, spend=0, events=0, swaps=0, swaps_perf=0, two=0, repeat=0, hit=0,
                 modes={}, by_month={}, adaptive={}, best=0, place_benefit=0, place_habit=0, promo=0, promo_habit=0, promo_swaps=0,
                 special_benefit=0, special_habit=0, special_best=0, special_events=0,
                 schedule_benefit=0, schedule_habit=0, schedule_best=0, schedule_events=0)
    promotions = promotions_for(cfg.promotion_source) if cfg.use_promotions else []
    # v4 는 방식 비교(최초·월간 맞춤·손해 방지)에 프로모션을 넘기지 않는다 (v4.2 도 5단계 점수에만 넣는다). 받은 혜택에는 센다
    strategy_promos = promotions if params.engine == "v3" else []
    card_rows = {c.user_card_id: c for c in cards}
    popup_days: dict = {}                    # 날짜 → 일정 팝업에서 추천한 프로모션 (offers_by_item)

    told: set = set()                        # 앱이 알려 줘서 ON 을 켠 마이샵 (행사 번호, 달)
    on_cache: dict = {}

    def is_on(promotion, ym: str) -> bool:
        key = (promotion.promotion_id, ym)
        if key not in on_cache:
            on_cache[key] = myshop_on(user_id, promotion, ym, cfg.myshop_on)
        return on_cache[key]

    def tell(when, brands=(), label=None) -> None:
        """앱이 마이샵을 알려 주면 사용자가 그 달 ON 을 켠다 (일정 팝업의 추천 브랜드, 안내 문구의 행사 이름)."""
        ym = ym_of(when)
        for x in promotions:
            if x.kind == "myshop" and x.active(when) and (x.brand in brands or x.label() == label):
                told.add((x.promotion_id, ym))

    def promo_value(user_card_id: int, payment, world: str) -> int:
        """이 카드로 이 결제를 했을 때 실제로 받는 프로모션. 기간·가맹점·카드사 조건을 모두 본다.
        world: habit = 스스로 켠 마이샵만, engine = 스스로 켰거나 앱이 알려 준 마이샵, all = 모든 마이샵."""
        row = card_rows[user_card_id]
        ym = ym_of(payment.paid_at)
        if world == "all":
            allowed = lambda x: True
        elif world == "habit":
            allowed = lambda x: is_on(x, ym)
        else:
            allowed = lambda x: is_on(x, ym) or (x.promotion_id, ym) in told
        return promo_received(promotions, payment.merchant_id, row.issuer, row.card_id, payment.amount,
                              payment.paid_at, allowed)

    for seq, p in enumerate(Data.payments.get(user_id, [])):
        while pending and pending[0][0] <= p.paid_at:
            view.apply(heapq.heappop(pending)[2])
        ym = ym_of(p.paid_at)
        if ym != current:
            if current is not None:
                months[current] = {"algo": _snapshot(truth), "habit": _snapshot(habit)}
            current = ym
            if initial_selected and cfg.start <= ym < cfg.until and params.loss_guard_months > 0:
                from engine.strategy import loss_guard
                known_history = [h for h in Data.payments.get(user_id, []) if h.visible_at <= p.paid_at]
                view.loss_guard = loss_guard(user, cards, catalog, params, known_history, p.paid_at,
                                             view.fixed_strategy or "main_top", strategy_promos)["active"]
                total["guard_months"] = total.get("guard_months", 0) + int(view.loss_guard)
            if initial_selected and cfg.start <= ym < cfg.until and params.adaptive_months > 0:
                from engine.strategy import monthly_pick      # 운영 서비스와 같은 월간 맞춤 방식
                known_history = [h for h in Data.payments.get(user_id, []) if h.visible_at <= p.paid_at]
                view.month_strategy = monthly_pick(user, cards, catalog, params, known_history, p.paid_at,
                                                   view.fixed_strategy, strategy_promos)["strategy"]
                view.plan = None
                total["adaptive"][view.month_strategy] = total["adaptive"].get(view.month_strategy, 0) + 1
        habit_got = habit.apply(p)
        chosen, result = p.user_card_id, None
        if p.is_placement and cfg.start <= ym < cfg.until:
            if not initial_selected:
                from engine.strategy import select_initial
                known_history = [h for h in Data.payments.get(user_id, [])
                                 if h.paid_at < p.paid_at and h.visible_at <= p.paid_at]
                result_initial = select_initial(user, cards, catalog, params, known_history, p.paid_at,
                                                strategy_promos)
                view.fixed_strategy = result_initial["strategy"]
                initial_selected = True
            engine.priors = Data.priors[ym]
            known = KnownPayment(p.category, p.amount, p.merchant_id) if cfg.upper_bound else None
            started = time.perf_counter()
            active = [x for x in promotions if x.active(p.paid_at)]
            items = day_schedules.get(p.paid_at.date(), ())
            offers = None
            if cfg.popup and items:
                day = p.paid_at.date()
                if day not in popup_days:            # 그날 첫 결제 전에 팝업을 띄웠다고 본다
                    popup_days[day] = _popup_offers(view, items, promotions, p.paid_at, params)
                    if popup_days[day]:
                        tell(p.paid_at, brands={b for rows_ in popup_days[day].values() for _, _, b in rows_})
                offers = popup_days[day]
            result = engine.rank_state(view, RankRequest(user_id, p.paid_at), promotions=active, last_base=last_base,
                                       known=known, schedules=items, promo_offers=offers)
            latencies.append(time.perf_counter() - started)
            if last_base is not None and last_base != result.base_card:
                base_changes += 1
            last_base = result.base_card

            truth.roll_to(ym)
            shown = [c.user_card_id for c in result.cards[:result.display_count]]
            gains = {c.user_card_id: evaluate(catalog.cards[c.card_id], p.category, p.amount,
                                              truth.ledger[c.user_card_id], p.paid_at,
                                              catalog.brand_of(p.merchant_id), p.pay)[0]
                     + promo_value(c.user_card_id, p, "all")
                     for c in view.cards}
            chosen = shown[0]
            if result.reason_code == "PROMOTION" and result.card_scores:      # 안내 문구에 행사 이름이 나왔다
                tell(p.paid_at, label=result.card_scores[chosen]["promotion_label"])
            if cfg.choice == "best_shown":
                chosen = max(shown, key=lambda uc: (gains[uc], -shown.index(uc)))
            if cfg.accept < 1 and accept_rng.random() > cfg.accept:
                chosen = p.user_card_id
        actual = replace(p, user_card_id=chosen)
        got = truth.apply(actual)
        promo_got = promo_value(chosen, p, "engine") if p.is_placement else 0
        promo_habit = promo_value(p.user_card_id, p, "habit") if p.is_placement else 0
        got += promo_got
        habit_got += promo_habit
        if p.is_placement:
            view.apply(actual)
        else:
            heapq.heappush(pending, (p.visible_at, seq, actual))

        if ym >= cfg.start and ym < cfg.until:
            total["benefit"] += got
            total["habit"] += habit_got
            total["spend"] += p.amount
            month_row = total["by_month"].setdefault(ym, [0, 0, 0])   # 월별 (알고리즘 혜택, 습관 혜택, 결제액)
            month_row[0] += got
            month_row[1] += habit_got
            month_row[2] += p.amount
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
            total["promo"] += promo_got
            total["promo_habit"] += promo_habit
            total["promo_swaps"] += result.swapped and result.reason_code == "PROMOTION"
            total["modes"][result.scenario_mode] = total["modes"].get(result.scenario_mode, 0) + 1
            if p.category in params.special_categories:          # 동물병원·골프·정비 등 평소와 다른 고액 결제
                total["special_events"] += 1
                total["special_benefit"] += got
                total["special_habit"] += habit_got
                total["special_best"] += max(gains.values())
            if result.scenario_mode == "schedule":
                total["schedule_events"] += 1
                total["schedule_benefit"] += got
                total["schedule_habit"] += habit_got
                total["schedule_best"] += max(gains.values())
            if cfg.keep_rows:
                rows.append({"payment": p, "result": result, "chosen": chosen, "got": got, "habit_got": habit_got,
                             "best": max(gains.values())})
    months[current] = {"algo": _snapshot(truth), "habit": _snapshot(habit)}

    perf = dict(ok=0, total=0, habit_ok=0, habit_total=0)
    card_ids = truth.card_ids
    for ym, snap in months.items():
        if ym < max(cfg.start, "2026-01") or ym >= min(cfg.until, "2026-11"):    # 온전한 달만
            continue
        for key, ok, count in (("algo", "ok", "total"), ("habit", "habit_ok", "habit_total")):
            for uc, (prev_perf, month_perf, _) in snap[key].items():
                first = catalog.first_tier(card_ids[uc])
                if month_perf > 0 and first:
                    perf[count] += 1
                    perf[ok] += prev_perf >= first
    return {"user_id": user_id, **total, **perf, "base_changes": base_changes,
            "latency": latencies, "months": months, "rows": rows}


def _schedules(user_id: int, cfg: ReplayConfig, rng) -> dict:
    """그날 아침 사용자가 일정을 입력했다고 가정하고, 날마다 일정 목록을 미리 만든다.
    평소와 다른 결제는 schedule_special, 나머지 현장 결제는 schedule_normal 비율로 입력한다.
    시간은 결제 시각을 품는 30분 단위 1~3시간, 금액은 실제 ±schedule_noise."""
    from collections import defaultdict
    from datetime import timedelta
    seen: dict[str, list] = defaultdict(list)
    out: dict = defaultdict(list)
    for p in Data.payments.get(user_id, []):
        if p.is_placement:
            recent = [t for t in seen[p.category] if p.paid_at - t <= timedelta(days=90)]
            unusual = len(recent) <= 1
            if ym_of(p.paid_at) >= cfg.start and rng.random() < (cfg.schedule_special if unusual else cfg.schedule_normal):
                lead = timedelta(minutes=float(rng.uniform(0, 60)))
                start = (p.paid_at - lead).replace(second=0, microsecond=0)
                start = start - timedelta(minutes=start.minute % 30)
                hours = int(rng.integers(1, 4))
                end = max(start + timedelta(hours=hours), p.paid_at + timedelta(minutes=1))
                amount = max(100, int(round(p.amount * rng.uniform(1 - cfg.schedule_noise, 1 + cfg.schedule_noise), -2)))
                day = out[p.paid_at.date()]
                day.append(ScheduleItem(len(day) + 1, user_id, start, end, p.category, amount))
            seen[p.category].append(p.paid_at)
    return out


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
        "프로모션 혜택(원)": n("promo"),
        "습관 프로모션 혜택(원)": n("promo_habit"),
        "프로모션 교체": n("promo_swaps"),
        "실적 충족": round(n("ok") / max(n("total"), 1) * 100, 1),
        "습관 실적 충족": round(n("habit_ok") / max(n("habit_total"), 1) * 100, 1),
        "기본 카드 변경/인": round(n("base_changes") / max(len(results), 1), 1),
        "엔진 계산 p95(ms)": round(float(np.percentile(latency, 95)) * 1000, 2),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", default="2026-01")
    parser.add_argument("--until", default="9999-12")
    parser.add_argument("--choice", choices=["best_shown", "first"], default="best_shown")
    parser.add_argument("--accept", type=float, default=1.0)
    parser.add_argument("--schedule", action="store_true", help="하루 일정을 미리 입력했다고 가정 (평소와 다른 결제 30%%, 일반 10%%)")
    parser.add_argument("--schedule-special", type=float, default=0.3)
    parser.add_argument("--schedule-normal", type=float, default=0.1)
    parser.add_argument("--upper-bound", action="store_true")
    parser.add_argument("--category-model", choices=["v1", "v2"], default="v2")
    parser.add_argument("--switch", type=int, default=None, help="전환 기준(원)")
    parser.add_argument("--two-loss", type=int, default=None, help="2장 손실 기준(원)")
    parser.add_argument("--base-order", choices=["first_tier", "main_top", "value", "auto", "top_tier"], default=None)
    parser.add_argument("--ml", action="store_true", help="남은 소비 예측·전략 선택 모델을 쓴다")
    parser.add_argument("--no-promotions", action="store_true", help="이벤트·마이샵을 빼고 평가")
    parser.add_argument("--no-value-check", action="store_true", help="채울 가치가 없는 구간도 순서대로 채움 (이전 규칙)")
    parser.add_argument("--base-fallback", choices=["first", "best_rate"], default=None)
    parser.add_argument("--engine", choices=["v4", "v3"], default=None, help="v3: 이전 결정 (점수에 실적 가치·프로모션, 150원, 두 장)")
    parser.add_argument("--promotion-source", choices=["db", "yaml", "yaml_monthly"], default="db",
                        help="db: 팀 DB 행사 / yaml: 일정 팝업용 31건(2026-11) / yaml_monthly: 31건이 매달 반복된다고 가정")
    parser.add_argument("--popup", action="store_true", help="일정 팝업의 프로모션 추천과 프로모션 카드 (--schedule 과 함께)")
    parser.add_argument("--myshop-on", type=float, default=0.3, help="마이샵 행사를 스스로 ON 으로 켠 비율 (1 이면 모두)")
    args = parser.parse_args()
    changes = {k: v for k, v in (("switch_threshold", args.switch), ("two_card_loss", args.two_loss),
                                 ("base_order", args.base_order), ("base_fallback", args.base_fallback),
                                 ("base_value_check", False if args.no_value_check else None),
                                 ("engine", args.engine)) if v is not None}
    cfg = ReplayConfig(start=args.start, until=args.until, choice=args.choice, accept=args.accept,
                       schedule=args.schedule, schedule_special=args.schedule_special,
                       schedule_normal=args.schedule_normal, upper_bound=args.upper_bound,
                       category_model=args.category_model, use_promotions=not args.no_promotions, ml=args.ml,
                       promotion_source=args.promotion_source, popup=args.popup, myshop_on=args.myshop_on,
                       params=Params().with_(**changes))
    results = run(cfg)
    groups = {"전체": results}
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
