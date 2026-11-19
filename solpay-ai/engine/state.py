"""사용자 한 명의 현재 상태. 결제를 시간순으로 넣으면 실적, 한도, 패턴 이력이 쌓인다.

서비스는 요청마다 저장소의 결제로 이 상태를 다시 만들고, 재생 평가는 같은 상태를 결제마다 이어서 쓴다.
같은 코드를 지나므로 평가와 서비스의 계산이 어긋나지 않는다.
"""

from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime

from engine.benefit_calc import CardMonth, apply as apply_benefit, evaluate
from engine.catalog import Catalog
from engine.domain import Payment, User, UserCard
from engine.params import Params
from engine.slots import Slot, slot_of, ym_of


def month_gap(earlier: str, later: str) -> int:
    return (int(later[:4]) - int(earlier[:4])) * 12 + int(later[5:7]) - int(earlier[5:7])


@dataclass
class History:
    """배치 시각 이전 현장 결제의 패턴. 온라인·자동이체·대표 교통카드 결제는 넣지 않는다."""
    slot_counts: dict[Slot, Counter] = field(default_factory=lambda: defaultdict(Counter))
    category_counts: Counter = field(default_factory=Counter)
    amounts: dict[str, list[int]] = field(default_factory=lambda: defaultdict(list))
    merchant_amounts: dict[int, list[int]] = field(default_factory=lambda: defaultdict(list))
    visits: dict[int, list[tuple[datetime, Slot]]] = field(default_factory=lambda: defaultdict(list))
    brand_counts: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))   # 업종 → 브랜드 코드(없으면 None)
    last: Payment | None = None
    today: datetime | None = None
    today_count: int = 0

    def add(self, p: Payment, slot: Slot, brand: str | None = None) -> None:
        self.slot_counts[slot][p.category] += 1
        self.brand_counts[p.category][brand] += 1
        self.category_counts[p.category] += 1
        self.amounts[p.category].append(p.amount)
        if p.merchant_id is not None:
            self.merchant_amounts[p.merchant_id].append(p.amount)
            self.visits[p.merchant_id].append((p.paid_at, slot))
        if self.today is None or self.today.date() != p.paid_at.date():
            self.today, self.today_count = p.paid_at, 0
        self.today_count += 1
        self.last = p


class UserState:
    def __init__(self, user: User, cards: list[UserCard], catalog: Catalog, params: Params,
                 benefit_start: str | None = None):
        self.user = user
        self.cards = sorted(cards, key=lambda c: c.display_order)
        self.card_ids = {c.user_card_id: c.card_id for c in cards}
        self.catalog = catalog
        self.params = params
        self.benefit_start = benefit_start     # 이 달 전에는 혜택을 계산하지 않는다 (데이터 첫 달)
        self.ym: str | None = None
        self.ledger: dict[int, CardMonth] = {}
        self.cur_rows: list[Payment] = []
        self.prev_rows: list[Payment] = []
        self.prev_ym: str | None = None
        self.plan = None                       # perf_value.MonthPlan 캐시
        self.prev_month_start: dict[int, int] = {}   # 지난달이 시작될 때의 전월 실적 (본인 시뮬레이션용)
        self.models = None                     # engine.ml.Models (남은 소비 예측, 전략 선택). 없으면 규칙만 쓴다
        self.fixed_strategy: str | None = None
        self.month_strategy: str | None = None  # 이번 달 맞춤 방식 (strategy.monthly_pick). 없으면 fixed_strategy
        self.loss_guard: bool = False           # 손해 방지: 이번 달은 실적 채우기를 멈춘다 (strategy.loss_guard)
        self.strategy_cache: dict | None = None  # (사용자, 달, 지난달 결제 수) → 고른 전략. 서비스가 요청 사이에 공유한다
        self.history = History()
        # 내 카드 혜택이 걸린 브랜드. 나머지 브랜드는 '브랜드 없음'과 같으므로 기대값 계산에서 하나로 묶는다
        self.relevant_brands = frozenset(code for c in self.cards for b in catalog.cards[c.card_id].benefits
                                         if b.brands for code in b.brands)

    def roll_to(self, ym: str) -> None:
        if self.ym is None:
            self.ym = ym
            self.ledger = {c.user_card_id: CardMonth() for c in self.cards}
            return
        gap = month_gap(self.ym, ym)
        if gap <= 0:
            return
        carried = {uc: (st.perf if gap == 1 else 0) for uc, st in self.ledger.items()}
        self.prev_month_start = {uc: st.prev_perf for uc, st in self.ledger.items()} if gap == 1 else {}
        self.prev_rows = self.cur_rows if gap == 1 else []
        self.prev_ym = self.ym if gap == 1 else None
        self.cur_rows = []
        self.ledger = {uc: CardMonth(prev_perf=perf) for uc, perf in carried.items()}
        self.ym = ym
        self.plan = None

    def apply(self, p: Payment) -> int:
        """결제 하나를 반영하고 그 결제로 받은 혜택을 돌려준다."""
        ym = ym_of(p.paid_at)
        if self.ym is None or ym > self.ym:
            self.roll_to(ym)
        if ym < self.ym:
            return self._apply_late(p, ym)

        st = self.ledger[p.user_card_id]
        got, benefit = 0, None
        brand = self.catalog.brand_of(p.merchant_id)
        if self.benefit_start is None or ym >= self.benefit_start:
            card = self.catalog.cards[self.card_ids[p.user_card_id]]
            got, benefit = evaluate(card, p.category, p.amount, st, p.paid_at, brand, p.pay)
        apply_benefit(st, p.amount, got, benefit, when=p.paid_at)
        self.cur_rows.append(p)
        if p.is_placement:
            self.history.add(p, slot_of(p.paid_at, self.params), brand)
        return got

    def _apply_late(self, p: Payment, ym: str) -> int:
        """달이 바뀐 뒤 도착한 지난달 타사 결제는 전월 실적에만 더한다."""
        if ym == self.prev_ym:
            self.ledger[p.user_card_id].prev_perf += p.amount
            self.prev_rows.append(p)
            self.plan = None
        return 0

    def perf(self, user_card_id: int) -> int:
        return self.ledger[user_card_id].perf
