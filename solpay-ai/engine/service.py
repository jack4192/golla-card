"""배치 엔진 진입점. 사용자 규칙 → 시나리오 → 점수 → 교체·2장 → 문구."""

from dataclasses import dataclass

from engine.catalog import Catalog
from engine.category_model import CategoryModel
from engine.domain import KnownPayment, Promotion, RankRequest, RankResult, RankedCard, UserWeights
from engine.messages import RULE, card_message, with_object_particle
from engine.params import Params
from engine.priors import Priors
from engine.ranker import decide
from engine.rules import Rule, resolve
from engine.scenarios import build
from engine.slots import ym_of
from engine.state import UserState


@dataclass
class PlacementEngine:
    catalog: Catalog
    priors: Priors
    params: Params = Params()
    category_model: CategoryModel | None = None

    def rank_state(self, state: UserState, req: RankRequest, rules: list[Rule] | tuple = (),
                   weights: UserWeights | None = None, promotions: list[Promotion] | tuple = (),
                   last_base: int | None = None, known: KnownPayment | None = None) -> RankResult:
        state.roll_to(ym_of(req.at))
        params = self._params_for(weights)
        outcome = resolve(list(rules), state.cards, req.at, params)
        params = outcome.params
        eligible = [c for c in state.cards if not c.excluded and c.user_card_id not in outcome.excluded]
        eligible = eligible or list(state.cards)
        version = "consent" if state.user.location_enabled else "no_consent"
        promotions = list(promotions)

        scenarios = build(state, req, self.catalog, self.priors, params, self.category_model, known)
        if outcome.forced:
            targets = [c for c in outcome.forced if not c.excluded] or outcome.forced
            decision = decide(state, targets, scenarios, req.at, params, promotions)
            first = decision.order[0]
            label = self.catalog.card_label(self._card_id(state, first))
            text = f"설정하신 대로 {with_object_particle(label)} 먼저 보여 드려요"
            ranked = [RankedCard(first, 1, round(decision.scores[first].total), text)]
            others = [c.user_card_id for c in eligible if c.user_card_id != first]
            ranked += [RankedCard(uc, i + 2, 0, "") for i, uc in enumerate(others)]
            return RankResult(ranked, 1, [], RULE, outcome.forced_rule.rule_id, version, "forced", first)

        decision = decide(state, eligible, scenarios, req.at, params, promotions)
        base_changed = last_base is not None and last_base != decision.base
        shown = [decision.first] + ([decision.second] if decision.second is not None else [])
        messages = {uc: card_message(state, self.catalog, decision, scenarios, uc, req.at, params, base_changed)
                    for uc in shown}
        ranked = [RankedCard(uc, i + 1, round(decision.scores[uc].total),
                             messages[uc].text if uc in messages else "")
                  for i, uc in enumerate(decision.order)]
        return RankResult(
            cards=ranked, display_count=len(shown), merchant_chips=scenarios.chips,
            reason_code=messages[decision.first].code, rule_applied=None, version=version,
            scenario_mode=scenarios.mode, base_card=decision.base, swapped=decision.swapped,
            swap_reason=decision.swap_reason, repeat_applied=decision.repeat_applied,
            top_category=scenarios.top_category,
            scenarios=[{"category": s.category, "prob": round(s.prob, 3), "amounts": list(s.amounts)}
                       for s in scenarios.scenarios],
            card_scores={uc: {"immediate": round(s.immediate, 1), "performance": round(s.performance, 1),
                              "promotion": round(s.promotion, 1), "total": round(s.total, 1)}
                         for uc, s in decision.scores.items()},
        )

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

    def build_state(self, context) -> UserState:
        state = UserState(context.user, context.cards, self.engine.catalog, self.engine.params,
                          benefit_start=context.benefit_start)
        for payment in context.payments:
            state.apply(payment)
        return state

    def card_status(self, user_id: int, at) -> list[dict]:
        """카드별 전월 실적, 당월 실적, 다음 구간까지 남은 금액, 이번 달 받은 혜택."""
        state = self.build_state(self.store.context(user_id, at))
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

    def evaluate_payment(self, user_id: int, at, category: str, amount: int, used_card: int | None = None) -> dict:
        """이 결제를 카드마다 했을 때 받는 혜택. 결제 전 상태로 계산한다."""
        from engine.benefit_calc import evaluate
        state = self.build_state(self.store.context(user_id, at))
        state.roll_to(ym_of(at))
        values = {}
        for uc in state.cards:
            got, _ = evaluate(self.engine.catalog.cards[uc.card_id], category, amount, state.ledger[uc.user_card_id], at)
            values[uc.user_card_id] = got
        best = max(state.cards, key=lambda c: (values[c.user_card_id], -c.display_order)).user_card_id
        return {"cards": [{"user_card_id": k, "benefit": v} for k, v in values.items()],
                "best_card": best, "best_benefit": values[best],
                "used_card": used_card, "used_benefit": values.get(used_card) if used_card is not None else None}

    def rank(self, req: RankRequest) -> tuple[int, RankResult]:
        context = self.store.context(req.user_id, req.at)
        state = self.build_state(context)
        result = self.engine.rank_state(state, req, context.rules, context.weights, context.promotions,
                                        context.last_base)
        located = context.user.location_enabled      # 미동의 사용자의 위치는 저장하지 않는다
        recommendation_id = self.store.log_recommendation({
            "user_id": req.user_id, "at": req.at,
            "lat": req.lat if located else None, "lng": req.lng if located else None,
            "version": result.version, "scenario_mode": result.scenario_mode, "base_card": result.base_card,
            "chips": result.merchant_chips, "scenarios": result.scenarios, "scores": result.card_scores,
            "ranking": [c.user_card_id for c in result.cards], "display_count": result.display_count,
            "reason_code": result.reason_code,
        })
        return recommendation_id, result
