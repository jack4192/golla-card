"""배치 엔진 진입점 (설계서 v4.1).
하루 일정으로 상황 파악 → 사용자 규칙 → 일정 프로모션 카드 → 방식·기본 카드 → 점수 → 교체 → 문구."""

import logging
from dataclasses import dataclass, replace
from datetime import datetime

from engine.catalog import Catalog
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, Promotion, RankRequest, RankResult, RankedCard, UserWeights, ScheduleItem
from engine.ml import Models
from engine.messages import PROMOTION_CARD, RULE, card_message, previous_base_filled, with_object_particle
from engine.params import BASE_ORDER_FIRST_TIER, Params
from engine.priors import Priors
from engine.ranker import decide
from engine.report import STRATEGY_DESC, STRATEGY_LABEL
from engine.rules import Rule, resolve
from engine.scenarios import MODE_SCHEDULE, active_schedule, build
from engine.slots import ym_of
from engine.state import UserState


log = logging.getLogger("solpay.service")


@dataclass
class PlacementEngine:
    catalog: Catalog
    priors: Priors
    params: Params = Params()
    category_model: CategoryModel | None = None
    models: Models | None = None                # 남은 소비 예측, 전략 선택 (engine.ml)

    def __post_init__(self):
        self.strategy_cache: dict = {}          # 본인 시뮬레이션은 사용자·달마다 한 번만

    def rank_state(self, state: UserState, req: RankRequest, rules: list[Rule] | tuple = (),
                   weights: UserWeights | None = None, promotions: list[Promotion] | tuple = (),
                   last_base: int | None = None, known: KnownPayment | None = None,
                   schedules: list[ScheduleItem] | tuple = (),
                   promo_offers: dict[int, list[tuple[int, int, str]]] | None = None) -> RankResult:
        """promo_offers: 일정 팝업에서 추천한 프로모션 (engine.popup.offers_by_item). 그 일정 시간이면 3~6단계 대신
        받을 금액이 가장 큰 신한카드를 1순위로 둔다. 고정 규칙이 더 우선이고, 제외된 카드는 건너뛴다."""
        if not state.cards:                 # 등록한 카드가 없으면 빈 순서 (2026-11-22 사용자 결정: 200 + 빈 목록, 기록 없음)
            from engine.messages import NO_CARD
            return RankResult([], 0, NO_CARD, None, "pattern", "none", None)
        if self.models is not None:
            state.models = self.models
        if state.strategy_cache is None:
            state.strategy_cache = self.strategy_cache
        state.roll_to(ym_of(req.at))
        params = self._params_for(weights)
        outcome = resolve(list(rules), state.cards, req.at, params)
        params = outcome.params
        eligible = [c for c in state.cards if not c.excluded and c.user_card_id not in outcome.excluded]
        eligible = eligible or list(state.cards)
        promotions = list(promotions)

        scenarios = build(state, req, self.catalog, self.priors, params, self.category_model, known, schedules)
        version = "schedule" if scenarios.mode == MODE_SCHEDULE else "pattern"
        if outcome.forced:
            targets = [c for c in outcome.forced if not c.excluded] or outcome.forced
            decision = decide(state, targets, scenarios, req.at, params, promotions, schedules)
            first = decision.order[0]
            label = self.catalog.card_label(self._card_id(state, first))
            text = f"설정하신 대로 {with_object_particle(label)} 먼저 보여 드려요"
            ranked = [RankedCard(first, 1, round(decision.scores[first].total), text)]
            others = [c.user_card_id for c in eligible if c.user_card_id != first]
            ranked += [RankedCard(uc, i + 2, 0, "") for i, uc in enumerate(others)]
            return RankResult(ranked, 1, RULE, outcome.forced_rule.rule_id, version, "forced", first,
                              base_source="forced")

        if promo_offers and params.engine != "v3":
            promo = self._promotion_card(state, req, eligible, scenarios, params, schedules, promo_offers, last_base)
            if promo is not None:
                return promo

        decision = decide(state, eligible, scenarios, req.at, params, promotions, schedules, outcome.no_fill or set())
        # '앞 카드 실적을 채워 …' 는 직전 기본 카드가 이번 달 구간을 실제로 채웠을 때만 (달이 바뀐 첫 화면·고정 규칙 뒤에는 내지 않는다)
        base_changed = (last_base is not None and last_base != decision.base
                        and previous_base_filled(state, self.catalog, last_base, params))
        shown = [decision.first] + ([decision.second] if decision.second is not None else [])
        messages = {uc: card_message(state, self.catalog, decision, scenarios, uc, req.at, params, base_changed)
                    for uc in shown}
        ranked = [RankedCard(uc, i + 1, round(decision.scores[uc].total),
                             messages[uc].text if uc in messages else "")
                  for i, uc in enumerate(decision.order)]
        return RankResult(
            cards=ranked, display_count=len(shown),
            reason_code=messages[decision.first].code, rule_applied=None, version=version,
            scenario_mode=scenarios.mode, base_card=decision.base, swapped=decision.swapped,
            swap_reason=decision.swap_reason, repeat_applied=decision.repeat_applied,
            top_category=scenarios.top_category,
            scenarios=[{"category": s.category, "prob": round(s.prob, 3), "amounts": list(s.amounts)}
                       for s in scenarios.scenarios],
            card_scores={uc: {"immediate": round(s.immediate, 1), "performance": round(s.performance, 1),
                              "promotion": round(s.promotion, 1), "promotion_label": s.promotion_label,
                              "total": round(s.total, 1)}
                         for uc, s in decision.scores.items()},
            hold=decision.hold, base_source=decision.base_source,
        )

    def _promotion_card(self, state, req, eligible, scenarios, params, schedules, promo_offers,
                        last_base: int | None = None) -> RankResult | None:
        """지금 적용되는 일정(시작 30분 전 ~ 끝 30분 후, 같은 업종 결제가 아직 없음)에 추천한 프로모션이 있으면
        그 신한카드를 1순위로 1장 보여 준다. 실적을 채우는 기본 카드는 바뀌지 않으므로 base_card 는 직전 값을 둔다
        (다음 결제에서 '기본 카드가 바뀌었다'는 안내가 잘못 나가지 않게)."""
        allowed = {c.user_card_id for c in eligible}
        for item in active_schedule(state, req.at, schedules, params):
            for uc, total, brand in promo_offers.get(item.item_id, []):
                if uc not in allowed:
                    continue
                label = self.catalog.card_label(self._card_id(state, uc))
                name = self.catalog.category_name(item.category)
                text = (f"{item.start:%H:%M} {name} 일정: {brand} 행사와 {label} 혜택으로 "
                        f"약 {int(round(total, -1)):,}원을 받을 수 있어요")
                ranked = [RankedCard(uc, 1, int(total), text)]
                ranked += [RankedCard(c.user_card_id, i + 2, 0, "")
                           for i, c in enumerate(c for c in eligible if c.user_card_id != uc)]
                return RankResult(ranked, 1, PROMOTION_CARD, None, "schedule", "promotion_card",
                                  last_base if last_base is not None else uc,
                                  top_category=item.category,
                                  scenarios=[{"category": s.category, "prob": round(s.prob, 3), "amounts": list(s.amounts)}
                                             for s in scenarios.scenarios],
                                  base_source="promotion")
        return None

    def _params_for(self, weights: UserWeights | None) -> Params:
        if weights is None:
            return self.params
        changes = {k: v for k, v in (("w1", weights.w1), ("w2", weights.w2),
                                     ("switch_threshold", weights.switch_threshold),
                                     ("base_order", weights.base_order)) if v is not None}
        return self.params.with_(**changes) if changes else self.params

    @staticmethod
    def _card_id(state: UserState, user_card_id: int) -> int:
        return state.card_ids[user_card_id]


class PlacementService:
    """API 와 저장소 사이. 요청마다 결제로 상태를 다시 만들어 배치한다."""

    def __init__(self, store, engine: PlacementEngine):
        self.store = store
        self.engine = engine
        # 일정 팝업에서 추천한 프로모션: (사용자, 날짜) → engine.popup.offers_by_item.
        # 일정처럼 하루만 쓰는 값이라 서버 메모리에 둔다 (재시작하면 사라짐. 운영 저장은 다음 단계).
        self.popups: dict = {}
        # 맞춤 추천 페이지 결과 (사용자, 날짜) → 응답. 같은 날 다시 열면 그대로 준다 (재시작하면 다시 계산).
        self.pages: dict = {}
        # 일정 '직접 입력' 분류 결과 (정리한 글 → 사용자와 무관한 분류). 같은 글자는 OpenAI 를 다시 부르지 않는다
        self.place_cache: dict = {}
        # 월간 리포트의 OpenAI 답: 사용자 → (보낸 사실, 문구, 기록). 숫자는 부를 때마다 다시 계산하고, OpenAI 답만
        # 보낸 사실이 같을 때 다시 쓴다 (2026-11-22 사용자 결정. 사용자마다 마지막 답 하나, 정해진 문구는 두지 않는다).
        self.reports: dict = {}
        self._popup_promotions: list[Promotion] | None = None

    @property
    def popup_promotions(self) -> list[Promotion]:
        """일정 팝업용 프로모션 (data/config/promotions.yml). 처음 쓸 때 읽는다."""
        if self._popup_promotions is None:
            from engine import loader
            self._popup_promotions = loader.load_popup_promotions(self.engine.catalog)
        return self._popup_promotions

    @popup_promotions.setter
    def popup_promotions(self, value: list[Promotion]) -> None:
        self._popup_promotions = list(value)

    def _all_promotions(self, context) -> list[Promotion]:
        """팀 DB 행사 + 일정 팝업용 행사(promotions.yml). 한 결제는 행사 하나(가장 큰 것)만 받으므로 같은 행사가 두 번
        들어 있어도 두 번 세지 않는다. yml 에서 '확인 필요'(응모·신규 조건 등)인 번호는 팀 DB 사본도 뺀다
        (page.merge_promotions. 예전에는 사본이 배치 점수·안내 문구·결제 평가에 그대로 들어갔다)."""
        from engine.page import merge_promotions
        return merge_promotions(list(context.promotions), self.popup_promotions)

    def _strategy_promotions(self):
        """v4 는 방식 비교(최초·월간 맞춤·손해 방지)에 프로모션을 넘기지 않는다 (v4.2 도 점수에만 넣는다)."""
        return getattr(self.store, "promotions", ()) if self.engine.params.engine == "v3" else ()

    def build_state(self, context, at=None) -> UserState:
        state = UserState(context.user, context.cards, self.engine.catalog, self.engine.params,
                          benefit_start=context.benefit_start)
        for payment in context.payments:
            state.apply(payment)
        # PostgreSQL uses the existing user_weights.base_order; the local demo
        # optionally supplies a persistent strategy store.
        stored = getattr(self.store, "strategy_store", None)
        confirmed = False
        if stored is not None:
            selection = stored.get(context.user.user_id)
            state.fixed_strategy = selection["strategy"] if selection else None
            confirmed = bool(selection) and selection.get("source") == "confirmed"
        elif context.weights and context.weights.base_order:
            state.fixed_strategy = context.weights.base_order
            confirmed = True                    # PostgreSQL user_weights.base_order 는 사용자가 정한 값
        if not confirmed:
            state.month_strategy = self._monthly(context, state.fixed_strategy, at)["strategy"]
        state.loss_guard = self._loss_guard(context, state)
        return state

    def _monthly(self, context, fixed_strategy: str | None, at=None) -> dict:
        """월간 맞춤 방식은 사용자·달마다 한 번 계산해 둔다 (지난달까지의 결제만 쓰므로 달 안에서는 같다).
        사용자가 챗봇으로 방식을 확정했으면 호출하지 않는다. 운영에서는 월초 배치로 미리 계산해 두는 것을 권한다."""
        from engine.strategy import monthly_pick
        payments = context.payments
        if self.engine.params.adaptive_months <= 0 or not payments:
            return {"strategy": fixed_strategy, "status": "off", "scores": {}}
        at = at or max(p.paid_at for p in payments)
        key = (context.user.user_id, ym_of(at), fixed_strategy, len(context.cards))
        cache = self.__dict__.setdefault("_monthly_cache", {})
        if key not in cache:
            cache[key] = monthly_pick(context.user, context.cards, self.engine.catalog, self.engine.params, payments,
                                      at, fixed_strategy, self._strategy_promotions())
        return cache[key]

    def monthly_strategy(self, user_id: int, at, context=None) -> dict:
        """이번 달 맞춤 방식과 후보별 비교 점수 (월초 배치·챗봇 설명용). 이미 읽은 context 가 있으면 다시 읽지 않는다."""
        context = context or self.store.context(user_id, at)
        stored = getattr(self.store, "strategy_store", None)
        selection = stored.get(user_id) if stored is not None else None
        fixed = selection["strategy"] if selection else (context.weights.base_order if context.weights else None)
        if (selection and selection.get("source") == "confirmed") or (selection is None and fixed):
            return {"strategy": fixed, "status": "user_confirmed", "scores": {}}
        return self._monthly(context, fixed, at)

    def strategy_info(self, user_id: int, at, context=None) -> dict:
        """지금 쓰는 배치 방식과 고른 이유 (챗봇 설명·월간 리포트 공용).
        chosen_by: rule(사용자 규칙) · user_confirmed · monthly(월간 맞춤) · insufficient_history · default."""
        context = context or self.store.context(user_id, at)
        outcome = resolve(list(context.rules), context.cards, at, self.engine.params)
        scores, months = {}, None
        if outcome.order_rule is not None:
            current, chosen_by, chosen_by_label = outcome.order_rule.base_order, "rule", "사용자 설정 (규칙)"
        else:
            info = self.monthly_strategy(user_id, at, context)
            current = info.get("strategy") or BASE_ORDER_FIRST_TIER
            chosen_by, chosen_by_label = {
                "user_confirmed": ("user_confirmed", "사용자 확정"),
                "ready": ("monthly", "월간 맞춤 (지난 결제로 방식 비교)"),
                "insufficient_history": ("insufficient_history", "결제 이력이 짧아 기본 방식")}.get(
                info.get("status"), ("default", "기본 방식"))
            scores, months = info.get("scores") or {}, info.get("months")
        compare = sorted(({"method": k, "label": STRATEGY_LABEL.get(k, k), "benefit": int(round(v))}
                          for k, v in scores.items()), key=lambda x: -x["benefit"])
        return {"current": current, "label": STRATEGY_LABEL.get(current), "description": STRATEGY_DESC.get(current),
                "chosen_by": chosen_by, "chosen_by_label": chosen_by_label,
                "compare_months": months if scores else None, "compare": compare}

    def _loss_guard(self, context, state) -> bool:
        """손해 방지 판단은 사용자·달마다 한 번 계산해 둔다 (지난달까지의 결제만 쓰므로 달 안에서는 같다)."""
        from engine.strategy import loss_guard
        payments = context.payments
        if self.engine.params.loss_guard_months <= 0 or not payments:
            return False
        at = max(p.paid_at for p in payments)
        key = (context.user.user_id, ym_of(at), state.fixed_strategy)
        cache = self.__dict__.setdefault("_guard_cache", {})
        if key not in cache:
            month_start = at.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            cache[key] = loss_guard(context.user, context.cards, self.engine.catalog, self.engine.params, payments,
                                    month_start, state.fixed_strategy or "main_top",
                                    self._strategy_promotions())["active"]
        return cache[key]

    def initialize_strategy(self, user_id, at):
        from engine.strategy import select_initial
        repo = getattr(self.store, "strategy_store", None)
        if repo is None:
            raise NotImplementedError("시연용 전략 저장소가 설정되지 않았습니다")
        context = self.store.context(user_id, at)
        current = repo.get(user_id)
        if current:
            return {"selection": current, "already_initialized": True}
        candidate = select_initial(context.user, context.cards, self.engine.catalog,
                                   self.engine.params, context.payments, at,
                                   self._strategy_promotions())
        selection = repo.initialize(user_id, candidate["strategy"], candidate)
        return {"selection": selection, "candidate": candidate, "already_initialized": False}

    def card_status(self, user_id: int, at) -> list[dict]:
        """카드별 전월 실적, 당월 실적, 다음 구간까지 남은 금액, 이번 달 받은 혜택."""
        state = self.build_state(self.store.context(user_id, at), at)
        state.roll_to(ym_of(at))
        catalog = self.engine.catalog
        out = []
        for uc in state.cards:
            st = state.ledger[uc.user_card_id]
            tiers = list(catalog.tiers[uc.card_id])
            target = next((t for t in tiers if t > st.perf), None)
            reached = max((t for t in tiers if t <= st.prev_perf), default=None)
            out.append({
                "user_card_id": uc.user_card_id, "card_id": uc.card_id, "name": catalog.card_label(uc.card_id),
                "issuer": uc.issuer, "display_order": uc.display_order, "excluded": uc.excluded,
                "prev_perf": st.prev_perf, "perf": st.perf, "tiers": tiers,
                "eligible_tier": reached, "next_tier": target, "remaining": target - st.perf if target else 0,
                "benefit_this_month": st.discount, "synced_note": uc.issuer != "SHINHAN",
            })
        return out

    def evaluate_payment(self, user_id: int, at, category: str, amount: int, used_card: int | None = None,
                         merchant_id: int | None = None) -> dict:
        """이 결제를 카드마다 했을 때 받는 카드 혜택과 프로모션. 결제 전 상태로 계산한다."""
        from engine.benefit_calc import SOLPAY, evaluate
        context = self.store.context(user_id, at)
        state = self.build_state(context, at)
        state.roll_to(ym_of(at))
        if not state.cards:                 # 등록한 카드가 없으면 비교할 것이 없다
            return {"cards": [], "best_card": None, "best_benefit": 0, "used_card": used_card, "used_benefit": None,
                    "used_promotion": None}
        values, promos, labels = {}, {}, {}
        for uc in state.cards:
            got, _ = evaluate(self.engine.catalog.cards[uc.card_id], category, amount, state.ledger[uc.user_card_id], at,
                              self.engine.catalog.brand_of(merchant_id), SOLPAY)
            promo = 0
            if merchant_id is not None:
                for p in self._all_promotions(context):
                    v = p.value(merchant_id, uc.issuer, uc.card_id, amount, at)
                    if v > promo:
                        promo, labels[uc.user_card_id] = v, p.label()
            values[uc.user_card_id], promos[uc.user_card_id] = got + promo, promo
        best = max(state.cards, key=lambda c: (values[c.user_card_id], -c.display_order)).user_card_id
        return {"cards": [{"user_card_id": k, "benefit": v, "promotion": promos[k], "promotion_label": labels.get(k)}
                          for k, v in values.items()],
                "best_card": best, "best_benefit": values[best],
                "used_card": used_card, "used_benefit": values.get(used_card) if used_card is not None else None,
                "used_promotion": promos.get(used_card) if used_card is not None else None}

    def preview(self, user_id: int, at, known: KnownPayment | None = None, context=None) -> RankResult:
        """추천 기록을 남기지 않는 배치 (챗봇 설명·가정 계산용). known 이 있으면 업종 예측 없이 그 결제로 계산한다.
        이미 읽은 context 가 있으면 다시 읽지 않는다."""
        context = context or self.store.context(user_id, at)
        state = self.build_state(context, at)
        return self.engine.rank_state(state, RankRequest(user_id, at), context.rules, context.weights,
                                      self._all_promotions(context), context.last_base, known=known,
                                      schedules=context.schedules, promo_offers=self.popups.get((user_id, at.date())))

    def recommendation_log(self, user_id: int, recommendation_id: int) -> dict | None:
        """이 사용자의 추천 기록 (메모리 저장소는 목록, DB 저장소는 app.recommendation_logs)."""
        lookup = getattr(self.store, "recommendation", None)
        return lookup(user_id, recommendation_id) if lookup is not None else None

    def rank(self, req: RankRequest) -> tuple[int | None, RankResult]:
        """(추천 기록 번호, 배치 결과). 등록한 카드가 없으면 기록을 남기지 않고 번호는 None 이다."""
        context = self.store.context(req.user_id, req.at)
        state = self.build_state(context, req.at)
        result = self.engine.rank_state(state, req, context.rules, context.weights, self._all_promotions(context),
                                        context.last_base, schedules=context.schedules,
                                        promo_offers=self.popups.get((req.user_id, req.at.date())))
        if not result.cards:
            return None, result
        return self._log_rank(req, result), result

    def _log_rank(self, req: RankRequest, result: RankResult) -> int | None:
        """추천 기록을 남기고 번호를 준다. 저장에 실패해도(읽기 전용 계정, DB 장애) 배치는 돌려주도록 None 을 준다
        (2026-11-22 사용자 결정: 추천은 계속 주기. 그 추천은 챗봇의 '이 추천 이유 설명'에 쓸 수 없다)."""
        record = {
            "user_id": req.user_id, "at": req.at,
            "version": result.version, "scenario_mode": result.scenario_mode, "base_card": result.base_card,
            "scenarios": result.scenarios, "scores": result.card_scores,
            "ranking": [c.user_card_id for c in result.cards], "display_count": result.display_count,
            "reason_code": result.reason_code,
            # 챗봇 '추천 이유 설명'용 (Postgres 저장소는 위 칸만 저장한다)
            "messages": {c.user_card_id: c.message for c in result.cards if c.message},
            "swapped": result.swapped, "rule_applied": result.rule_applied,
        }
        try:
            return self.store.log_recommendation(record)
        except Exception:
            log.warning("추천 기록을 남기지 못했습니다 (user_id=%s). 배치는 그대로 돌려줍니다", req.user_id, exc_info=True)
            return None

    def _log_card(self, record: dict) -> None:
        """신규 카드 추천 기록. 저장에 실패해도 추천 화면은 보여 준다 (다음 추천 간격 계산에만 빠진다)."""
        try:
            self.store.log_card_recommendation(record)
        except Exception:
            log.warning("카드 추천 기록을 남기지 못했습니다 (user_id=%s)", record.get("user_id"), exc_info=True)

    # ---------- 하루 일정 ----------
    def put_schedule(self, user_id: int, day, items: list[dict], now) -> list[ScheduleItem]:
        """하루 일정을 통째로 바꾼다. 최소 수집: 시작·끝 시각, 업종, 예상 금액만 받는다."""
        if day < now.date():
            raise ValueError("지난 날의 일정은 넣을 수 없습니다")
        names = self.engine.catalog.category_names
        brands = {m.brand_code for m in self.engine.catalog.merchants.values() if m.brand_code}
        parsed = []
        for i, raw in enumerate(items):
            if raw["category"] not in names or raw["category"] == "ALL":
                raise ValueError(f"알 수 없는 업종: {raw['category']}")
            brand = raw.get("brand") or None
            if brand is not None and brand not in brands:
                raise ValueError(f"알 수 없는 가맹점 브랜드: {brand}")
            start = datetime.combine(day, raw["start"], tzinfo=now.tzinfo)
            end = datetime.combine(day, raw["end"], tzinfo=now.tzinfo)
            if end <= start:
                raise ValueError("끝 시각은 시작 시각보다 늦어야 합니다")
            parsed.append(ScheduleItem(i + 1, user_id, start, end, raw["category"], int(raw["amount"]), brand))
        self.store.put_schedule(user_id, day, parsed)
        self.forget_day(user_id, day)
        return parsed

    def forget_day(self, user_id: int, day) -> None:
        """일정이 바뀌면 그날 팝업의 프로모션 카드와 추천 페이지 결과를 버린다 (다음 호출에서 다시 계산)."""
        self.popups.pop((user_id, day), None)
        self.pages.pop((user_id, day), None)

    def forget_reports(self, user_id: int) -> None:
        """그 사용자의 월간 리포트 OpenAI 답을 버린다. 숫자는 늘 다시 계산하므로 없어도 틀린 숫자는 나오지 않는다."""
        self.reports.pop(user_id, None)

    # ---------- 맞춤 추천 페이지 (설계서 2026-11-19-recommendation-page-design.md) ----------
    def recommendation_page(self, user_id: int, at, writer=None) -> dict:
        """카드사 추천·가맹점 추천 탭. 엔진이 고르고 writer(PageCopyWriter)가 문구를 쓴다 (None 이면 정해진 문구).
        같은 날 다시 부르면 저장해 둔 결과를 준다. 카드를 보여 주면 추천 기록을 남긴다 (같은 날 같은 카드는 한 번)."""
        from engine.chat.page_copy import attach_copy, facts_of, template_copy
        from engine.page import build_page, merge_promotions
        from engine.popup import offers_by_item
        key = (user_id, at.date())
        if key in self.pages:
            return {**self.pages[key], "cached": True}
        context = self.store.context(user_id, at)
        state = self.build_state(context, at)
        state.roll_to(ym_of(at))
        params = self.engine.params
        rules = list(context.rules)
        excluded = lambda when: set(resolve(rules, state.cards, when, params).excluded)   # 일정 시각의 제외 규칙
        history = self.store.recommendation_history(user_id)
        promotions = merge_promotions(list(context.promotions), self.popup_promotions)
        page = build_page(state, context.payments, context.schedules, history, promotions, at, params, excluded)
        out = page.to_dict(self.engine.catalog, params)
        facts = facts_of(out)
        if not page.tabs:                                 # 보여 줄 게 없으면 문구도 받지 않는다 (페이지를 건너뜀)
            copy, source, log = {"card": None, "merchant": None}, "none", {}
        elif writer is not None:
            copy, source, log = writer.write(facts)
        else:
            copy, source, log = template_copy(facts), "template", {"reason": "no_writer"}
        if page.card is not None and not any(
                h["card_id"] == page.card.card_id and h["at"].astimezone(at.tzinfo).date() == at.date() for h in history):
            self._log_card({"user_id": user_id, "at": at, "card_id": page.card.card_id,
                                                "trigger": page.trigger, "gain": page.card.gain})
        real = [o for o in page.offers if o.item_id > 0]         # 평소 소비 항목의 행사는 결제 화면에 쓰지 않는다
        if real:
            self.popups[key] = offers_by_item(real)
        else:
            self.popups.pop(key, None)
        result = {**attach_copy(out, copy), "day": at.date().isoformat(), "copy_source": source, "copy_log": log}
        self.pages[key] = result
        return {**result, "cached": False}

    # ---------- 하루 일정 팝업 (설계서 v4.1) ----------
    def schedule_popup(self, user_id: int, at) -> dict:
        """일정을 저장한 뒤 띄울 팝업. 3일마다 카드 추천, 그 외의 날은 일정에 맞는 프로모션 추천.
        프로모션을 추천하면 그날 일정 시간에 쓸 프로모션 카드를 기억해 둔다."""
        from engine.popup import offers_by_item, schedule_popup
        context = self.store.context(user_id, at)
        state = self.build_state(context, at)
        state.roll_to(ym_of(at))
        params = self.engine.params
        rules = list(context.rules)
        excluded = lambda when: set(resolve(rules, state.cards, when, params).excluded)   # 일정 시각의 제외 규칙
        popup = schedule_popup(state, context.payments, context.schedules, self.store.recommendation_history(user_id),
                               self.popup_promotions, at, params, excluded)
        key = (user_id, at.date())
        if popup["kind"] == "card":
            rec = popup["recommendation"]
            self.popups.pop(key, None)
            self._log_card({"user_id": user_id, "at": at, "card_id": rec.card_id,
                                                "trigger": rec.trigger, "gain": rec.gain})
            return {"kind": "card", "card_id": rec.card_id, "card_name": rec.card_name, "gain": rec.gain,
                    "trigger": rec.trigger, "reason": rec.reason, "first_month_note": rec.first_month_note}
        if popup["offers"]:
            self.popups[key] = offers_by_item(popup["offers"])
        else:
            self.popups.pop(key, None)
        names = self.engine.catalog.category_name
        return {"kind": popup["kind"],
                "offers": [{**o.to_dict(params), "category_name": names(o.category)} for o in popup["offers"]]}

    # ---------- 신규 카드 추천 ----------
    def recommend_card(self, user_id: int, at) -> dict:
        from engine.recommend import recommend
        context = self.store.context(user_id, at)
        state = self.build_state(context, at)
        state.roll_to(ym_of(at))
        rec = recommend(state, context.payments, context.schedules, self.store.recommendation_history(user_id),
                        at, self.engine.params)
        if rec is None:
            return {"recommend": False}
        self._log_card({"user_id": user_id, "at": at, "card_id": rec.card_id,
                                            "trigger": rec.trigger, "gain": rec.gain})
        return {"recommend": True, "card_id": rec.card_id, "card_name": rec.card_name, "gain": rec.gain,
                "trigger": rec.trigger, "reason": rec.reason, "first_month_note": rec.first_month_note}

    # ---------- 일정 '직접 입력' 업종·가맹점 분류 (2026-11-23 설계서) ----------
    def classify_place(self, text: str, user_id: int | None = None, at=None, llm=None) -> dict:
        """짧은 말 → 업종·브랜드. 규칙 검색이 딱 맞으면 search, 못 찾으면 llm(PlaceLLM) 이 목록 안에서 고른다.
        확신이 낮으면 후보만, 실패하면 none. 원문은 어디에도 남기지 않는다 (정리한 글만 캐시 키로 쓴다)."""
        import time as _time
        from zoneinfo import ZoneInfo
        from engine.place import amount_hint, clean_text
        started = _time.monotonic()
        catalog = self.engine.catalog
        if user_id is not None:
            self.store.user(user_id)                  # 없는 사용자는 UnknownUser
        at = at or datetime.now(ZoneInfo("Asia/Seoul"))
        q = clean_text(text)
        base = self.place_cache.get(q)
        if base is None:
            base, cacheable = self._classify_new(q, llm)
            if cacheable:
                self.place_cache[q] = base
        out = {**base, "category_name": catalog.category_name(base["category"]) if base["category"] else None,
               "candidates": [dict(c) for c in base["candidates"]]}
        hint = None
        if base["category"]:
            if user_id is not None:
                payments = self.store.context(user_id, at).payments
                hint = amount_hint(payments, catalog, base["category"], base["brand"], at, self.engine.priors)
            else:
                hint = int(round(self.engine.priors.amount_median(base["category"]), -2))
        out["amount_hint"] = hint
        out["ms"] = int((_time.monotonic() - started) * 1000)
        return out

    def _classify_new(self, q: str, llm) -> tuple[dict, bool]:
        """(사용자와 무관한 분류, 캐시해도 되는지). OpenAI 가 실패한 결과는 캐시하지 않는다 (다음에 다시 시도)."""
        from engine.place import _candidate, match_place
        catalog = self.engine.catalog
        empty = {"category": None, "brand": None, "brand_name": None}
        m = match_place(q, catalog)
        if m.exact or m.category:
            return {"category": m.category, "brand": m.brand, "brand_name": m.brand_name, "source": "search",
                    "candidates": m.candidates}, True
        if not q or llm is None:
            return {**empty, "source": "none", "candidates": m.candidates}, False
        categories = {c: n for c, n in catalog.category_names.items() if c != "ALL"}
        brands = {mm.brand_code: mm.brand or mm.brand_code for mm in catalog.merchants.values() if mm.brand_code}
        answer = llm.classify(q, categories, brands)
        if answer is None:
            return {**empty, "source": "none", "candidates": m.candidates}, False
        if answer["category"] == "UNKNOWN":
            return {**empty, "source": "none", "candidates": m.candidates}, True
        brand = answer["brand"]
        if answer["confidence"] == "low":
            return {**empty, "source": "llm",
                    "candidates": [_candidate(catalog, answer["category"], brand, brands.get(brand))]}, True
        return {"category": answer["category"], "brand": brand, "brand_name": brands.get(brand), "source": "llm",
                "candidates": []}, True

    def missed_benefit(self, user_id: int, at, days: int = 365) -> list[dict]:
        """연말정산 안내: 지난 days 일 동안 각 신한카드가 있었다면 더 받았을 금액 (상위 3장)."""
        from datetime import timedelta
        from engine.recommend import missed_benefit
        context = self.store.context(user_id, at)
        state = self.build_state(context, at)
        rows = [p for p in context.payments if at - timedelta(days=days) <= p.paid_at < at]
        return [m for m in missed_benefit(state, rows, self.engine.params.switch_threshold) if m["gain"] > 0][:3]

    # ---------- 월간 리포트 (설계서 2026-11-22-monthly-report-design.md) ----------
    def monthly_report(self, user_id: int, at, writer=None) -> dict:
        """이번 달(at 까지, 진행 중)·지난달(확정) 카드별 숫자, 배치 전략과 근거, 지난달 SOL페이 효과, 요약 문장.
        숫자는 엔진이 정한다. 카드 숫자 요점(summary.points)도 엔진이 후보 문장으로 쓰고 (report_copy.candidates_of),
        writer(ReportCopyWriter)는 제목을 쓰고 보여 줄 후보 1~2개를 고른다 (None 이면 정해진 문구. 고른 번호는 copy_log.picks).
        SOL페이 효과 문장·이유(summary.effect, report_copy.effect_lines)와 배치 전략 문장(summary.strategy, strategy_lines)은
        엔진이 쓴다 (2026-11-22 사용자 결정).
        숫자·효과·전략은 부를 때마다 다시 계산한다 (운영에서는 Spring 이 결제를 DB 에 넣으므로 캐시를 지울 계기가 없다).
        OpenAI 답만, 보낸 사실과 프롬프트가 지난번과 같으면 다시 쓴다 (cached=true). 정해진 문구로 떨어진 답은 두지 않아
        다음에 다시 시도한다."""
        import json
        from engine.chat.report_copy import effect_lines, facts_of, strategy_lines, template_copy
        from engine.report import card_rows, month_starts, strategy_now, totals_of
        context = self.store.context(user_id, at)
        prev_start, this_start = month_starts(at)
        month, prev_month = ym_of(this_start), ym_of(prev_start)
        now = self.build_state(context, at)
        now.roll_to(month)
        # 지난달은 지금 보이는 결제 중 이번 달 1일 전 결제만으로 다시 만든다 (늦게 들어온 타사 결제 포함)
        prev = self.build_state(replace(context, payments=[p for p in context.payments if p.paid_at < this_start]), at)
        prev.roll_to(prev_month)
        cards = card_rows(now, prev, self.engine.catalog)
        strategy = {**self.strategy_info(user_id, at, context),
                    **strategy_now(self.preview(user_id, at, context=context), cards)}
        effect = self._last_month_effect(user_id, context, prev_start, this_start)
        report = {"user_id": user_id, "at": at.isoformat(), "month": month, "prev_month": prev_month,
                  "totals": totals_of(cards), "cards": cards, "strategy": strategy, "solpay_effect": effect,
                  "effect_note": None if effect else "지난달 결제화면 결제가 없어 비교하지 않았어요",
                  # 이번 달 전에 결제가 하나라도 있었나 (없으면 요약 제목이 '첫 리포트예요', report_copy.fixed_headline)
                  "has_history": any(p.paid_at < this_start for p in context.payments)}
        facts = facts_of(report)
        sent = json.dumps([getattr(writer, "prompt_version", None), facts], ensure_ascii=False, sort_keys=True)
        kept = self.reports.get(user_id) if writer is not None else None
        reused = kept is not None and kept[0] == sent
        if reused:
            copy, source, log = kept[1], "llm", kept[2]
        elif writer is not None:
            copy, source, log = writer.write(facts)
            if copy.get("picks"):
                log = {**log, "picks": copy["picks"]}         # OpenAI 가 고른 후보 번호 (facts.candidates 의 id)
            if source == "llm":
                self.reports[user_id] = (sent, copy, log)
        else:
            copy, source, log = template_copy(facts), "template", {"reason": "no_writer"}
        summary = {"headline": copy["headline"], "effect": effect_lines(report), "strategy": strategy_lines(report),
                   "points": copy["points"]}
        return {**report, "summary": summary, "copy_source": source, "copy_log": log, "cached": reused}

    def _last_month_effect(self, user_id: int, context, prev_start, this_start) -> dict | None:
        """지난달 SOL페이 효과 (engine.report.replay_month): 지난달 결제화면 결제를 그때 엔진의 1순위 카드로 냈다면.
        시작 상태는 지난달 1일 전 결제로 그때마다 새로 만든다 (월간 맞춤 방식도 지난달 기준, 늦게 들어온 결제 포함).
        일정·일정 팝업은 쓰지 않는다. 2026-11-22 사용자 결정:
        - 규칙은 그 결제 때 이미 있던 규칙만 쓴다 (rules.rules_at. 오늘 만든 규칙이 지난달 효과를 바꾸지 않게).
        - 프로모션: 실제 쪽은 기록값, 추천 쪽은 이벤트와 그달 켜 둔 것이 확인된 마이샵만 (report.promotion_of).
        행사는 저장소 전체 목록에서 결제 시각에 진행 중인 것만 쓴다 (context 의 행사는 at 기준이라 지난달에 끝난 행사가 빠진다)."""
        from engine.report import promotion_of, replay_month
        from engine.rules import rules_at
        before = replace(context, payments=[p for p in context.payments if p.paid_at < prev_start])
        payments = sorted((p for p in context.payments if prev_start <= p.paid_at < this_start),
                          key=lambda p: (p.paid_at, p.payment_id))
        from engine.page import merge_promotions
        promotions = merge_promotions(list(getattr(self.store, "promotions", context.promotions)), self.popup_promotions)
        card_of = {c.user_card_id: (c.issuer, c.card_id) for c in context.cards}
        last_base = None

        def choose(view, p):
            nonlocal last_base
            result = self.engine.rank_state(view, RankRequest(user_id, p.paid_at), rules_at(context.rules, p.paid_at),
                                            context.weights, [x for x in promotions if x.active(p.paid_at)], last_base)
            last_base = result.base_card
            return result.cards[0].user_card_id, result.reason_code

        return replay_month(lambda: self.build_state(before, prev_start), payments, choose,
                            promotion_of(payments, promotions, card_of), self.engine.catalog, ym_of(prev_start))
