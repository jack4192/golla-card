"""2단계: 어디서 얼마를 결제할지를 확률로 표현한다.

GPS 는 쓰지 않는다 (2026-11-14 멘토링 결정: 가맹점이 겹치면 오안내, 계산 복잡, 배터리).
1) 하루 일정: 지금이 사용자가 입력한 일정(시작 30분 전 ~ 끝 30분 후)이면 그 업종·금액으로 확정한다.
2) 일정이 없으면 소비 패턴: 반복 구간이면 1위 업종 하나, 아니면 시간대별 업종 확률 (업종 예측 모델).
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

import numpy as np

from engine.catalog import Catalog
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, RankRequest
from engine.params import Params
from engine.priors import Priors
from engine.slots import Slot, slot_of
from engine.state import UserState

MODE_KNOWN = "known"                         # 평가 전용
MODE_SCHEDULE = "schedule"                   # 사용자가 입력한 하루 일정
MODE_REPEAT = "repeat"                       # 반복 구간 (평소 이 시간대엔 거의 한 업종)
MODE_TIME = "time"                           # 시간대 업종 확률


@dataclass
class Scenario:
    category: str
    prob: float
    amounts: tuple[int, ...]
    merchants: dict[int, float] = field(default_factory=dict)   # 시나리오 안의 가맹점별 확률
    brands: dict[str | None, float] = field(default_factory=lambda: {None: 1.0})   # 브랜드 코드별 확률 (None 은 브랜드 혜택 없음)
    # 프로모션 계산용 브랜드 확률. 내 카드 혜택과 무관한 브랜드도 묶지 않는다 (행사는 그런 브랜드에도 걸린다). None 이면 brands
    promo_brands: dict[str | None, float] | None = None


@dataclass
class ScenarioSet:
    scenarios: list[Scenario]
    mode: str
    slot: Slot
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
    """예상 결제 금액 = 사용자의 해당 가맹점(없으면 업종) 금액 중앙값. 이력이 적으면 전체 사용자 중앙값을 쓴다."""
    history = state.history
    values = history.merchant_amounts.get(merchant_id, []) if merchant_id is not None else []
    if len(values) < params.amount_min_history:
        values = history.amounts.get(category, [])
    if len(values) < params.amount_min_history:
        return (priors.amount_median(category),)
    return (int(np.median(values)),)


def brand_mix(state: UserState, category: str, priors: Priors, params: Params,
              merchants: dict[int, float] | None = None) -> dict[str | None, float]:
    """브랜드 한정 혜택 계산용 브랜드 확률. 가맹점 후보가 있으면 후보의 브랜드, 없으면 그 업종에서 내가 간 브랜드 비중
    (이력이 prior_strength 건보다 적으면 전체 사용자 비중을 섞는다). 내 카드 혜택과 무관한 브랜드는 None 으로 묶는다."""
    relevant = state.relevant_brands
    mix: dict[str | None, float] = {}

    def add(brand: str | None, weight: float) -> None:
        key = brand if brand in relevant else None
        mix[key] = mix.get(key, 0.0) + weight

    if merchants:
        for merchant_id, p in merchants.items():
            add(state.catalog.brand_of(merchant_id), p)
    else:
        own = state.history.brand_counts.get(category, {})
        total = sum(own.values())
        for brand, n in own.items():
            add(brand, n)
        lacking = max(params.prior_strength - total, 0)
        if lacking:
            for brand, share in priors.brand_share(category).items():
                add(brand, lacking * share)
    size = sum(mix.values())
    return {b: w / size for b, w in mix.items()} if size else {None: 1.0}


def promo_brand_mix(state: UserState, category: str, priors: Priors, params: Params) -> dict[str | None, float]:
    """프로모션 계산용 브랜드 확률 (설계서 v4.2). brand_mix 와 같지만 내 카드 혜택과 무관한 브랜드도 그대로 둔다.
    P(브랜드|업종) = (내 그 브랜드 건수 + 모자란 몫 × 전체 사용자 비중) ÷ (내 업종 건수 + 모자란 몫),
    모자란 몫 = max(prior_strength − 내 업종 건수, 0)."""
    own = state.history.brand_counts.get(category, {})
    mix: dict[str | None, float] = {}
    for brand, n in own.items():
        mix[brand] = mix.get(brand, 0.0) + n
    lacking = max(params.prior_strength - sum(own.values()), 0)
    if lacking:
        for brand, share in priors.brand_share(category).items():
            mix[brand] = mix.get(brand, 0.0) + lacking * share
    size = sum(mix.values())
    return {b: w / size for b, w in mix.items()} if size else {None: 1.0}


def _scenario(state, category, prob, amounts, priors, params) -> Scenario:
    return Scenario(category, prob, amounts, brands=brand_mix(state, category, priors, params),
                    promo_brands=promo_brand_mix(state, category, priors, params))


def _time_scenarios(state, probs, priors, params) -> list[Scenario]:
    kept = {c: p for c, p in probs.items() if p >= params.min_category_prob}
    size = sum(kept.values())
    return [_scenario(state, c, p / size, amount_scenarios(state, c, priors, params), priors, params)
            for c, p in sorted(kept.items(), key=lambda x: -x[1])]


def active_schedule(state: UserState, at: datetime, schedules, params: Params) -> list:
    """지금 적용되는 일정: 시작 lead 분 전 ~ 끝 tail 분 후이고, 그 사이 같은 업종 현장 결제가 아직 없는 것."""
    from datetime import timedelta
    lead, tail = timedelta(minutes=params.schedule_lead_min), timedelta(minutes=params.schedule_tail_min)
    active = []
    for item in schedules or ():
        opens, closes = item.start - lead, item.end + tail
        if not opens <= at <= closes:
            continue
        done = any(p.is_placement and p.category == item.category and opens <= p.paid_at < at
                   for p in state.cur_rows)
        if not done:
            active.append(item)
    return active


def build(state: UserState, req: RankRequest, catalog: Catalog, priors: Priors, params: Params,
          model: CategoryModel | None = None, known: KnownPayment | None = None, schedules=()) -> ScenarioSet:
    at = req.at
    slot = slot_of(at, params)
    if known is not None:
        brands = {state.catalog.brand_of(known.merchant_id): 1.0} if known.merchant_id is not None else {None: 1.0}
        merchants = {known.merchant_id: 1.0} if known.merchant_id is not None else {}
        return ScenarioSet([Scenario(known.category, 1.0, (known.amount,), merchants, brands)], MODE_KNOWN, slot)

    items = active_schedule(state, at, schedules, params)
    if items:
        share = 1.0 / len(items)
        return ScenarioSet([_scenario(state, i.category, share, (i.amount,), priors, params) for i in items],
                           MODE_SCHEDULE, slot)

    probs = time_category_probs(state, at, priors, params, model)
    repeat = repeat_category(state, at, probs, params)
    if repeat is not None:
        return ScenarioSet([_scenario(state, repeat, 1.0, amount_scenarios(state, repeat, priors, params), priors, params)],
                           MODE_REPEAT, slot, repeat_category=repeat)
    return ScenarioSet(_time_scenarios(state, probs, priors, params), MODE_TIME, slot)
