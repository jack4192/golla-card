"""2단계: 어디서 얼마를 결제할지를 확률로 표현한다.

위치 동의 버전은 가맹점까지, 미동의 버전은 업종까지 예측한다. 나머지 단계는 두 버전이 같다.
"""

import math
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from engine.catalog import Catalog
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, Merchant, RankRequest
from engine.params import Params
from engine.priors import Priors
from engine.slots import Slot, slot_of
from engine.state import UserState

MODE_KNOWN = "known"                         # 평가 전용
MODE_CONFIRMED = "confirmed"                 # 후보 1곳이거나 칩을 눌러 가맹점 확정
MODE_CANDIDATES = "candidates"               # 가맹점 후보 여러 곳
MODE_CANDIDATES_REPEAT = "candidates_repeat" # 후보 여러 곳 + 반복 구간
MODE_REPEAT = "repeat"                       # 위치 후보 없음 + 반복 구간
MODE_TIME = "time"                           # 시간대 업종 확률만


@dataclass
class Scenario:
    category: str
    prob: float
    amounts: tuple[int, ...]
    merchants: dict[int, float] = field(default_factory=dict)   # 시나리오 안의 가맹점별 확률


@dataclass
class ScenarioSet:
    scenarios: list[Scenario]
    mode: str
    slot: Slot
    chips: list[dict] = field(default_factory=list)
    repeat_category: str | None = None

    @property
    def top_category(self) -> str | None:
        return max(self.scenarios, key=lambda s: s.prob).category if self.scenarios else None


def time_category_probs(state: UserState, at: datetime, priors: Priors, params: Params,
                        model: CategoryModel | None = None) -> dict[str, float]:
    """업종 확률 v1(개인 빈도 + 전체 분포 보정) 또는 v2(LightGBM)."""
    if model is not None:
        return model.predict(state, at)
    slot = slot_of(at, params)
    counts = Counter(state.history.slot_counts.get(slot, {}))
    total = sum(counts.values())
    lacking = max(params.prior_strength - total, 0)
    if lacking:
        prior = priors.for_slot(slot)
        prior_total = sum(prior.values())
        if prior_total:
            for category, n in prior.items():
                counts[category] += lacking * n / prior_total
    size = sum(counts.values())
    return {c: n / size for c, n in counts.items()} if size else {}


def repeat_category(state: UserState, at: datetime, probs: dict[str, float], params: Params) -> str | None:
    """반복 구간이면 1위 업종을 돌려준다: 구간 결제 8건 이상, 1위 업종 확률 50% 이상."""
    if not probs:
        return None
    slot = slot_of(at, params)
    if sum(state.history.slot_counts.get(slot, {}).values()) < params.repeat_min_count:
        return None
    top = max(probs, key=probs.get)
    return top if probs[top] >= params.repeat_min_share else None


def amount_scenarios(state: UserState, category: str, priors: Priors, params: Params,
                     merchant_id: int | None = None) -> tuple[int, ...]:
    """사용자의 25%, 50%, 75% 분위수. 이력이 적으면 전체 사용자의 분포를 쓴다."""
    history = state.history
    values = history.merchant_amounts.get(merchant_id, []) if merchant_id is not None else []
    if len(values) < params.amount_min_history:
        values = history.amounts.get(category, [])
    if len(values) < params.amount_min_history:
        return priors.amount_quantiles(category)
    return tuple(int(x) for x in np.percentile(values, [25, 50, 75]))


def merchant_score(state: UserState, merchant: Merchant, dist: float, at: datetime,
                   probs: dict[str, float], params: Params) -> float:
    visits = state.history.visits.get(merchant.merchant_id, [])
    slot = slot_of(at, params)
    recent = sum(1 for t, _ in visits if (at - t).days <= params.visit_window_days)
    cycle = 1.0
    if len(visits) >= 2:
        interval = (visits[-1][0] - visits[0][0]).total_seconds() / 86400 / (len(visits) - 1)
        if interval > 0:
            cycle = 1 + min((at - visits[-1][0]).total_seconds() / 86400 / interval, 2)
    same_slot = sum(1 for _, s in visits if s == slot)
    return (math.exp(-dist / params.distance_scale_m) * (recent + 1) * cycle
            * (same_slot + 1) / (len(visits) + 6) * (probs.get(merchant.category, 0.0) + 0.05))


def _time_scenarios(state, probs, priors, params) -> list[Scenario]:
    kept = {c: p for c, p in probs.items() if p >= params.min_category_prob}
    size = sum(kept.values())
    return [Scenario(c, p / size, amount_scenarios(state, c, priors, params))
            for c, p in sorted(kept.items(), key=lambda x: -x[1])]


def _single(state, category, priors, params, merchant_id=None) -> list[Scenario]:
    merchants = {merchant_id: 1.0} if merchant_id is not None else {}
    return [Scenario(category, 1.0, amount_scenarios(state, category, priors, params, merchant_id), merchants)]


def _candidates(state, found, at, probs, priors, params) -> tuple[list[Scenario], list[dict]]:
    scores = [(m, merchant_score(state, m, d, at, probs, params)) for m, d in found]
    size = sum(s for _, s in scores) or 1.0
    by_category: dict[str, dict[int, float]] = {}
    chips = []
    for merchant, score in sorted(scores, key=lambda x: -x[1]):
        prob = score / size
        by_category.setdefault(merchant.category, {})[merchant.merchant_id] = prob
        chips.append({"merchant_id": merchant.merchant_id, "probability": round(prob, 3)})
    scenarios = []
    for category, merchants in by_category.items():
        total = sum(merchants.values())
        merchant_id = next(iter(merchants)) if len(merchants) == 1 else None
        scenarios.append(Scenario(category, total, amount_scenarios(state, category, priors, params, merchant_id),
                                  {m: p / total for m, p in merchants.items()}))
    return sorted(scenarios, key=lambda s: -s.prob), chips[:params.max_chips]


def build(state: UserState, req: RankRequest, catalog: Catalog, priors: Priors, params: Params,
          model: CategoryModel | None = None, known: KnownPayment | None = None) -> ScenarioSet:
    at = req.at
    slot = slot_of(at, params)
    if known is not None:
        merchants = {known.merchant_id: 1.0} if known.merchant_id is not None else {}
        return ScenarioSet([Scenario(known.category, 1.0, (known.amount,), merchants)], MODE_KNOWN, slot)

    use_location = state.user.location_enabled      # 미동의 사용자는 좌표가 들어와도 쓰지 않는다
    if use_location and req.selected_merchant_id in catalog.merchants:
        merchant = catalog.merchants[req.selected_merchant_id]
        return ScenarioSet(_single(state, merchant.category, priors, params, merchant.merchant_id),
                           MODE_CONFIRMED, slot)

    probs = time_category_probs(state, at, priors, params, model)
    repeat = repeat_category(state, at, probs, params)

    found = []
    if use_location and req.lat is not None and req.lng is not None:
        found = catalog.nearby(req.lat, req.lng, params.radius_m)
    if len(found) == 1 and (req.accuracy_m or 0) <= params.confirm_accuracy_m:
        merchant = found[0][0]
        return ScenarioSet(_single(state, merchant.category, priors, params, merchant.merchant_id),
                           MODE_CONFIRMED, slot)
    if found:
        scenarios, chips = _candidates(state, found, at, probs, priors, params)
        if repeat is not None and any(s.category == repeat for s in scenarios):
            chosen = next(s for s in scenarios if s.category == repeat)
            return ScenarioSet([Scenario(repeat, 1.0, chosen.amounts, chosen.merchants)],
                               MODE_CANDIDATES_REPEAT, slot, chips, repeat)
        return ScenarioSet(scenarios, MODE_CANDIDATES, slot, chips)

    if repeat is not None:
        return ScenarioSet(_single(state, repeat, priors, params), MODE_REPEAT, slot, repeat_category=repeat)
    return ScenarioSet(_time_scenarios(state, probs, priors, params), MODE_TIME, slot)
