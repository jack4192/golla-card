"""사후 최적 상한: 배치 알고리즘과 무관하게, 결제 내역을 전부 안다고 할 때 받을 수 있는 최대 혜택에 가까운 값.

결제(시각·가맹점·업종·금액)는 그대로 두고 현장 결제의 카드만 다시 고른다. 온라인·자동이체·대표 교통카드 결제와
첫 달(7월, 혜택 계산 전)은 실제 카드 그대로다. 혜택 = 카드 혜택 + 프로모션, 집계 기간은 재생 평가와 같다.

찾는 방법 (정확한 최적은 조합이 너무 많아 아래 탐색으로 근사한다)
1) 결제마다, 그 시점의 한도·횟수를 반영해 가장 많이 주는 카드를 고른다 (사후 결제별 최선).
2) '이번 달 이 카드의 이 구간까지 실적을 채운다'는 목표를 달·카드·구간마다 하나씩 넣어 본다.
   목표 카드는 손해가 가장 작은 결제부터 옮겨 받아 구간을 채운다. 기간 전체 혜택이 늘면 그 목표를 남긴다.
   더 늘지 않을 때까지 반복한다 (최대 4바퀴).
3) 습관대로 결제한 결과보다 낮으면 습관 결과를 상한으로 쓴다 (습관도 가능한 선택 중 하나이므로).

    uv run python -m evaluation.oracle
"""

import json
import multiprocessing as mp
import os
from collections import defaultdict

from engine.benefit_calc import CardMonth, apply as apply_benefit, evaluate
from engine.loader import ARTIFACTS
from engine.slots import ym_of
from evaluation.replay import BENEFIT_START, Data, prepare

MAX_ROUNDS = 4
COUNT_FROM = "2026-01"          # 재현 평가와 같은 집계 시작 달 (2025-11~12 은 이력)


class UserProblem:
    def __init__(self, user_id: int):
        self.cards = Data.cards[user_id]
        self.ids = [c.user_card_id for c in self.cards]
        self.card = {c.user_card_id: Data.catalog.cards[c.card_id] for c in self.cards}
        self.row = {c.user_card_id: c for c in self.cards}
        self.months: dict[str, list] = defaultdict(list)
        for p in Data.payments.get(user_id, []):
            self.months[ym_of(p.paid_at)].append(p)
        self.order = sorted(self.months)
        self.active = [m for m in self.order if m >= BENEFIT_START]
        self.brand = {p.payment_id: Data.catalog.brand_of(p.merchant_id) for m in self.order for p in self.months[m]}

    def promo(self, uc: int, p) -> int:
        if p.merchant_id is None or not p.is_placement:
            return 0
        r = self.row[uc]
        return max((x.value(p.merchant_id, r.issuer, r.card_id, p.amount, p.paid_at) for x in Data.promotions), default=0)

    def run_month(self, ym: str, prev: dict[int, int], choose) -> tuple[int, dict[int, int], dict]:
        """한 달을 돌린다. choose(p, ledger) → 현장 결제의 카드. (받은 혜택, 카드별 실적, 결제별 카드)"""
        ledger = {uc: CardMonth(prev_perf=prev.get(uc, 0)) for uc in self.ids}
        counted = ym >= BENEFIT_START
        total, picked = 0, {}
        for p in self.months[ym]:
            uc = choose(p, ledger) if (p.is_placement and counted) else p.user_card_id
            if uc not in ledger:
                uc = self.ids[0]
            got, b = (evaluate(self.card[uc], p.category, p.amount, ledger[uc], p.paid_at, self.brand[p.payment_id], p.pay)
                      if counted else (0, None))
            apply_benefit(ledger[uc], p.amount, got, b, when=p.paid_at)
            if ym >= COUNT_FROM:
                total += got + self.promo(uc, p)
            picked[p.payment_id] = uc
        return total, {uc: st.perf for uc, st in ledger.items()}, picked

    def value(self, p, uc, ledger) -> int:
        return evaluate(self.card[uc], p.category, p.amount, ledger[uc], p.paid_at, self.brand[p.payment_id], p.pay)[0] \
            + self.promo(uc, p)

    def greedy_with_targets(self, ym: str, prev: dict[int, int], targets: dict[int, int]):
        """결제별 최선 → 목표 구간을 못 채운 카드에 손해가 작은 결제부터 옮긴다 → 그 배정으로 다시 계산."""
        losses = {}

        def best(p, ledger):
            values = {uc: self.value(p, uc, ledger) for uc in self.ids}
            top = max(self.ids, key=lambda uc: (values[uc], uc == p.user_card_id))
            losses[p.payment_id] = (values, top)
            return top

        _, perf, picked = self.run_month(ym, prev, best)
        if targets:
            for uc, need in sorted(targets.items(), key=lambda kv: -kv[1]):
                if perf[uc] >= need:
                    continue
                movable = []
                for p in self.months[ym]:
                    if p.payment_id not in losses or picked[p.payment_id] == uc:
                        continue
                    values, top = losses[p.payment_id]
                    src = picked[p.payment_id]
                    if src in targets and perf[src] - p.amount < targets[src]:
                        continue
                    movable.append(((values[top] - values[uc]) / p.amount, p, src))
                for _, p, src in sorted(movable, key=lambda x: x[0]):
                    if perf[uc] >= need:
                        break
                    picked[p.payment_id] = uc
                    perf[uc] += p.amount
                    perf[src] -= p.amount
            return self.run_month(ym, prev, lambda p, ledger: picked[p.payment_id])
        return self.run_month(ym, prev, lambda p, ledger: picked[p.payment_id])

    def chain(self, targets: dict[str, dict[int, int]]) -> int:
        prev, total = {}, 0
        for ym in self.order:
            got, prev, _ = self.greedy_with_targets(ym, prev, targets.get(ym, {})) if ym >= BENEFIT_START \
                else self.run_month(ym, prev, None)
            total += got
        return total

    def habit(self) -> int:
        prev, total = {}, 0
        for ym in self.order:
            got, prev, _ = self.run_month(ym, prev, lambda p, ledger: p.user_card_id)
            total += got
        return total

    def solve(self) -> dict:
        targets: dict[str, dict[int, int]] = {}
        best = self.chain(targets)
        greedy = best
        for _ in range(MAX_ROUNDS):
            improved = False
            for ym in self.active[:-1]:                 # 마지막 달에 채운 구간은 기간 안에서 보상이 없다
                for uc in self.ids:
                    for low in (None, *self.card[uc].perf_tiers()):
                        trial = {m: dict(t) for m, t in targets.items()}
                        month = trial.setdefault(ym, {})
                        if low is None:
                            if uc not in month:
                                continue
                            month.pop(uc)
                        elif month.get(uc) == low:
                            continue
                        else:
                            month[uc] = low
                        value = self.chain(trial)
                        if value > best:
                            best, targets, improved = value, trial, True
            if not improved:
                break
        habit = self.habit()
        return {"greedy": greedy, "search": best, "habit": habit, "upper": max(best, habit),
                "targets": {m: {str(k): v for k, v in t.items()} for m, t in targets.items() if t}}


def _solve(user_id: int) -> tuple[int, dict]:
    return user_id, UserProblem(user_id).solve()


def main() -> None:
    prepare()
    ids = sorted(Data.users)
    with mp.get_context("fork").Pool(min(os.cpu_count() or 4, 8)) as pool:
        out = dict(pool.map(_solve, ids, chunksize=2))
    path = ARTIFACTS / "reports" / "oracle_upper.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    n = lambda k: sum(v[k] for v in out.values())
    print(f"사용자 {len(out)}명  습관 {n('habit'):,}  결제별 최선 {n('greedy'):,}  탐색 {n('search'):,}  상한 {n('upper'):,}")
    print("습관이 탐색보다 높은 사용자:", sum(v["habit"] > v["search"] for v in out.values()))
    for u in range(1, 6):
        print(u, out[u])
    print(f"저장: {path}")


if __name__ == "__main__":
    main()
