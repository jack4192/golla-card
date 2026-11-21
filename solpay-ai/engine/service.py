"""배치 엔진 진입점 (설계서 v4.1).
하루 일정으로 상황 파악 → 사용자 규칙 → 일정 프로모션 카드 → 방식·기본 카드 → 점수 → 교체 → 문구."""

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
            return RankResult(ranked, 1, RULE, outcome.forced_rule.rule_id, version, "forced", first)

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
                                             for s in scenarios.scenarios])
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
        # 월간 리포트 (사용자, 날짜) → 응답. 리포트는 저장하지 않고 하루 단위 메모리 캐시만 둔다 (OpenAI 비용 절약).
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
        """팀 DB 행사 + 일정 팝업용 행사(promotions.yml). 두 목록의 번호가 겹칠 수 있어 합치기만 하고,
        한 결제는 행사 하나(가장 큰 것)만 받으므로 같은 행사가 두 번 들어 있어도 두 번 세지 않는다."""
        return list(context.promotions) + list(self.popup_promotions)

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

    def rank(self, req: RankRequest) -> tuple[int, RankResult]:
        context = self.store.context(req.user_id, req.at)
        state = self.build_state(context, req.at)
        result = self.engine.rank_state(state, req, context.rules, context.weights, self._all_promotions(context),
                                        context.last_base, schedules=context.schedules,
                                        promo_offers=self.popups.get((req.user_id, req.at.date())))
        recommendation_id = self.store.log_recommendation({
            "user_id": req.user_id, "at": req.at,
            "version": result.version, "scenario_mode": result.scenario_mode, "base_card": result.base_card,
            "scenarios": result.scenarios, "scores": result.card_scores,
            "ranking": [c.user_card_id for c in result.cards], "display_count": result.display_count,
            "reason_code": result.reason_code,
            # 챗봇 '추천 이유 설명'용 (Postgres 저장소는 위 칸만 저장한다)
            "messages": {c.user_card_id: c.message for c in result.cards if c.message},
            "swapped": result.swapped, "rule_applied": result.rule_applied,
        })
        return recommendation_id, result

    # ---------- 하루 일정 ----------
    def put_schedule(self, user_id: int, day, items: list[dict], now) -> list[ScheduleItem]:
        """하루 일정을 통째로 바꾼다. 최소 수집: 시작·끝 시각, 업종, 예상 금액만 받는다."""
        if day < now.date():
            raise ValueError("지난 날의 일정은 넣을 수 없습니다")
        names = self.engine.catalog.category_names
        parsed = []
        for i, raw in enumerate(items):
            if raw["category"] not in names or raw["category"] == "ALL":
                raise ValueError(f"알 수 없는 업종: {raw['category']}")
            start = datetime.combine(day, raw["start"], tzinfo=now.tzinfo)
            end = datetime.combine(day, raw["end"], tzinfo=now.tzinfo)
            if end <= start:
                raise ValueError("끝 시각은 시작 시각보다 늦어야 합니다")
            parsed.append(ScheduleItem(i + 1, user_id, start, end, raw["category"], int(raw["amount"])))
        self.store.put_schedule(user_id, day, parsed)
        self.forget_day(user_id, day)
        return parsed

    def forget_day(self, user_id: int, day) -> None:
        """일정이 바뀌면 그날 팝업의 프로모션 카드와 추천 페이지 결과를 버린다 (다음 호출에서 다시 계산)."""
        self.popups.pop((user_id, day), None)
        self.pages.pop((user_id, day), None)

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
            self.store.log_card_recommendation({"user_id": user_id, "at": at, "card_id": page.card.card_id,
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
            self.store.log_card_recommendation({"user_id": user_id, "at": at, "card_id": rec.card_id,
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
        self.store.log_card_recommendation({"user_id": user_id, "at": at, "card_id": rec.card_id,
                                            "trigger": rec.trigger, "gain": rec.gain})
        return {"recommend": True, "card_id": rec.card_id, "card_name": rec.card_name, "gain": rec.gain,
                "trigger": rec.trigger, "reason": rec.reason, "first_month_note": rec.first_month_note}

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
        숫자는 엔진이 정하고 writer(ReportCopyWriter)는 문장만 쓴다 (None 이면 정해진 문구).
        저장하지 않고, 같은 날 다시 부르면 메모리에 둔 결과를 준다 (cached)."""
        from engine.chat.report_copy import facts_of, template_copy
        from engine.report import card_rows, month_starts, strategy_now, totals_of
        key = (user_id, at.date())
        if key in self.reports:
            return {**self.reports[key], "cached": True}
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
                  "effect_note": None if effect else "지난달 결제화면 결제가 없어 비교하지 않았어요"}
        facts = facts_of(report)
        if writer is not None:
            copy, source, log = writer.write(facts)
        else:
            copy, source, log = template_copy(facts), "template", {"reason": "no_writer"}
        result = {**report, "summary": copy, "copy_source": source, "copy_log": log}
        self.reports[key] = result
        return {**result, "cached": False}

    def _last_month_effect(self, user_id: int, context, prev_start, this_start) -> dict | None:
        """지난달 SOL페이 효과 (engine.report.replay_month): 지난달 결제화면 결제를 그때 엔진의 1순위 카드로 냈다면.
        시작 상태는 지난달 1일 전 결제로 그때마다 새로 만든다 (월간 맞춤 방식도 지난달 기준, 늦게 들어온 결제 포함).
        규칙은 지금 규칙, 일정·일정 팝업은 쓰지 않는다. 프로모션은 조건이 맞으면 받았다고 본다 (실제·추천 같은 조건).
        행사는 저장소 전체 목록에서 결제 시각에 진행 중인 것만 쓴다 (context 의 행사는 at 기준이라 지난달에 끝난 행사가 빠진다)."""
        from engine.report import replay_month
        before = replace(context, payments=[p for p in context.payments if p.paid_at < prev_start])
        payments = sorted((p for p in context.payments if prev_start <= p.paid_at < this_start),
                          key=lambda p: (p.paid_at, p.payment_id))
        promotions = list(getattr(self.store, "promotions", context.promotions)) + list(self.popup_promotions)
        card_of = {c.user_card_id: (c.issuer, c.card_id) for c in context.cards}
        last_base = None

        def choose(view, p):
            nonlocal last_base
            result = self.engine.rank_state(view, RankRequest(user_id, p.paid_at), context.rules, context.weights,
                                            [x for x in promotions if x.active(p.paid_at)], last_base)
            last_base = result.base_card
            return result.cards[0].user_card_id, result.reason_code

        def promo(user_card_id, p):
            if p.merchant_id is None:
                return 0
            issuer, card_id = card_of[user_card_id]
            return max((x.value(p.merchant_id, issuer, card_id, p.amount, p.paid_at)
                        for x in promotions if x.active(p.paid_at)), default=0)

        return replay_month(lambda: self.build_state(before, prev_start), payments, choose, promo,
                            self.engine.catalog, ym_of(prev_start))

