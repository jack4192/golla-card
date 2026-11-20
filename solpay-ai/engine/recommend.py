"""신규 카드 추천 (2026-11-14 결정).

매일 하지 않고, 아래 계기가 있을 때만 '아직 없는 신한카드' 한 장을 추천한다. 계기는 위에서부터 먼저 본다.
1) 일정  : 오늘 일정에 특수 업종(동물병원·골프·정비 등)이나 10만 원 이상 결제가 있고,
           그 결제 한 번에서 가진 카드보다 3,000원 이상 더 주는 카드가 있을 때 (연회비 월 환산액을 뺀 값)
2) 방문  : 최근 하루 안에 특수 업종에서 결제했고, 그 업종 혜택이 있는 카드가 지난 30일 기준 월 3,000원 이상 이득일 때
3) 반복  : 최근 4일 중 3일 이상 같은 업종에서 결제했고(예: 편의점), 그 업종 혜택이 있는 카드가 월 3,000원 이상 이득일 때
4) 정기  : 마지막 추천 뒤 3일이 지났고, 어떤 카드든 월 3,000원 이상 이득일 때
1)~3)은 3일 간격을 기다리지 않지만 하루에 한 번까지만, 같은 카드는 30일 안에 다시 추천하지 않는다.

'월 이득' = 지난 30일 결제를, 그 카드를 더 가졌다면 결제마다 가장 좋은 카드로 냈을 때의 혜택 − 지금 카드로 그렇게 냈을 때의
혜택 − 연회비 ÷ 12. 새 카드의 전월 실적은 그 30일 동안 그 카드로 갔을 결제액으로 본다 (발급 첫 달은 실적 조건 때문에
혜택이 적을 수 있어 따로 안내한다). KB 등 타사 카드와 발급 자격이 정해진 카드는 추천하지 않는다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from engine.benefit_calc import SOLPAY, Card, CardMonth, apply as apply_benefit, evaluate
from engine.domain import Payment, ScheduleItem
from engine.params import Params

HOME_ISSUER = "SHINHAN"
# 발급 자격이 정해진 카드 (임신·출산·보육 바우처, 군 장병, 학생, 개인사업자). 자격을 확인할 수 없어 추천하지 않는다
RESTRICTED = ("SH_KUKMIN_CREDIT", "SH_KUKMIN_CHECK", "SH_NARASARANG_CHECK", "SH_CHEOUM_CHECK", "KB_BIZ_PRIME")
BIG_AMOUNT = 100_000


@dataclass
class Recommendation:
    card_id: int
    card_name: str
    gain: int                   # 추천 근거 금액 (원)
    trigger: str                # schedule / special_visit / repeat / regular
    reason: str
    first_month_note: str | None = None


def candidates(state) -> list[Card]:
    owned = {c.card_id for c in state.cards}
    return [c for c in state.catalog.cards.values()
            if c.issuer == HOME_ISSUER and c.card_id not in owned and c.code not in RESTRICTED]


def _simulate(state, rows: list[Payment], extra: Card | None, prev: dict[int, int], period, count_from,
              threshold: int, slack: dict | None = None, replace: dict[int, Card] | None = None) -> tuple[int, dict]:
    """결제를 그대로 두고 현장 결제의 카드만 다시 고른다. 기본은 가진 카드 중 가장 많이 주는 카드,
    새 카드(extra)는 그보다 threshold 원 이상 더 주고, 그 결제를 빼도 원래 카드가 넘던 실적 구간을 지킬 수 있을 때만
    쓴다 (slack: (기간, 카드) → 구간을 지키고 남는 실적). period(결제) 가 바뀌면 장부를 넘긴다.
    replace: 가진 카드 → 그 자리에 대신 쓴 카드 (그 카드로 내던 결제를 모두 대신 쓴 카드로 낸다).
    (count_from 이후 혜택 합, (기간, 카드) → 그 기간 실적)"""
    catalog = state.catalog
    owned = {c.user_card_id: catalog.cards[c.card_id] for c in state.cards}
    owned.update(replace or {})
    cards = dict(owned)
    if extra is not None:
        cards[-1] = extra
    slack = dict(slack or {})
    ledgers = {uc: CardMonth(prev_perf=prev.get(uc, 0)) for uc in cards}
    perfs: dict = {}
    current, total = None, 0

    def close(key):
        for uc, st in ledgers.items():
            perfs[(key, uc)] = st.perf

    for p in sorted(rows, key=lambda r: r.paid_at):
        key = period(p)
        if current is not None and key != current:
            close(current)
            ledgers = {uc: st.roll() for uc, st in ledgers.items()}
        current = key
        brand = catalog.brand_of(p.merchant_id)
        uc = p.user_card_id if p.user_card_id in owned else next(iter(owned))
        if p.is_placement:
            value = {c: evaluate(cards[c], p.category, p.amount, ledgers[c], p.paid_at, brand, p.pay)[0] for c in cards}
            uc = max(owned, key=lambda c: (value[c], c == p.user_card_id))
            room = slack.get((key, uc), float("inf"))
            if extra is not None and value[-1] - value[uc] >= threshold and room >= p.amount:
                slack[(key, uc)] = room - p.amount
                uc = -1
        got, b = evaluate(cards[uc], p.category, p.amount, ledgers[uc], p.paid_at, brand, p.pay)
        apply_benefit(ledgers[uc], p.amount, got, b, when=p.paid_at)
        if key >= count_from:
            total += got
    if current is not None:
        close(current)
    return total, perfs


def _slack(state, perfs: dict) -> dict:
    """기존 카드마다 그 기간에 넘은 가장 높은 실적 구간을 지키고 남는 실적."""
    tiers = {c.user_card_id: state.catalog.tiers[c.card_id] for c in state.cards}
    return {(key, uc): perf - max((t for t in tiers[uc] if t <= perf), default=0)
            for (key, uc), perf in perfs.items() if uc in tiers}


def _window(state, rows60: list[Payment], at: datetime, extra: Card | None, threshold: int) -> tuple[int, int]:
    """60일 전에 그 카드를 발급받았다고 보고: 앞 30일은 실적만 쌓고 뒤 30일의 혜택을 센다. (혜택, 새 카드 실적)"""
    cut = at - timedelta(days=30)
    period = lambda p: int(p.paid_at >= cut)
    prev = {c.user_card_id: (state.ledger[c.user_card_id].prev_perf if c.user_card_id in state.ledger else 0)
            for c in state.cards}
    total, perfs = _simulate(state, rows60, None, prev, period, 1, threshold)
    if extra is None:
        return total, 0
    total, perfs = _simulate(state, rows60, extra, prev, period, 1, threshold, _slack(state, perfs))
    return total, perfs.get((0, -1), 0)


def monthly_gain(state, rows60: list[Payment], card: Card, at: datetime, threshold: int,
                 base: int | None = None) -> tuple[int, int]:
    """(월 이득, 새 카드의 예상 월 실적) = 그 카드가 있었다면 지난 30일 더 받았을 혜택 − 연회비 ÷ 12."""
    base = _window(state, rows60, at, None, threshold)[0] if base is None else base
    with_card, perf = _window(state, rows60, at, card, threshold)
    return int(with_card - base - card.annual_fee / 12), perf


def _first_month_note(card: Card, category: str, amount: int, at: datetime, steady_prev: int) -> str | None:
    steady = evaluate(card, category, amount, CardMonth(prev_perf=steady_prev), at, None, SOLPAY)[0]
    first = evaluate(card, category, amount, CardMonth(prev_perf=0), at, None, SOLPAY)[0]
    if first < steady:
        return "발급 첫 달은 전월 실적이 없어 이 혜택이 적거나 없을 수 있어요"
    return None


def _won(n: int) -> str:
    return f"{int(round(n, -1)):,}원"


def recommend(state, payments: list[Payment], schedules: list[ScheduleItem], history: list[dict], at: datetime,
              params: Params) -> Recommendation | None:
    catalog = state.catalog
    last = max((h["at"] for h in history), default=None)
    if last is not None and at - last < timedelta(days=1):
        return None                                           # 하루에 한 번까지
    recent = {h["card_id"] for h in history if at - h["at"] < timedelta(days=params.recommend_same_card_days)}
    pool = [c for c in candidates(state) if c.card_id not in recent]
    if not pool:
        return None
    rows60 = [p for p in payments if at - timedelta(days=60) <= p.paid_at < at]
    rows30 = [p for p in rows60 if p.paid_at >= at - timedelta(days=30)]
    threshold = params.switch_threshold
    base = _window(state, rows60, at, None, threshold)[0]
    owned = [(c, catalog.cards[c.card_id]) for c in state.cards]

    # 1) 일정의 특수 업종·고액 결제
    for item in sorted(schedules, key=lambda i: -i.amount):
        if item.category not in params.special_categories and item.amount < BIG_AMOUNT:
            continue
        have = max((evaluate(card, item.category, item.amount, state.ledger.get(uc.user_card_id, CardMonth()),
                             item.start, None, SOLPAY)[0] for uc, card in owned), default=0)
        best = None
        for card in pool:
            _, perf = monthly_gain(state, rows60, card, at, threshold, base)
            steady_prev = max(perf, item.amount)
            value = evaluate(card, item.category, item.amount, CardMonth(prev_perf=steady_prev), item.start, None, SOLPAY)[0]
            gain = int(value - have - card.annual_fee / 12)
            if best is None or gain > best[0]:
                best = (gain, card, value, steady_prev)
        if best and best[0] >= params.recommend_min_event:
            gain, card, value, steady_prev = best
            name = catalog.category_name(item.category)
            return Recommendation(card.card_id, catalog.card_label(card.card_id), gain, "schedule",
                                  f"오늘 {name} {item.amount:,}원 일정이 있어요. {catalog.card_label(card.card_id)}로 "
                                  f"결제하면 지금 카드보다 약 {_won(gain)} 더 받을 수 있어요(연회비 반영).",
                                  _first_month_note(card, item.category, item.amount, item.start, steady_prev))

    def best_monthly(cards: list[Card]):
        scored = [(monthly_gain(state, rows60, c, at, threshold, base)[0], c) for c in cards]
        return max(scored, key=lambda x: x[0], default=(0, None))

    # 2) 최근 하루 안의 특수 업종 방문
    visited = [p.category for p in rows30 if p.is_placement and p.category in params.special_categories
               and at - p.paid_at <= timedelta(days=1)]
    for category in dict.fromkeys(visited):
        gain, card = best_monthly([c for c in pool if c.advertises(category) or _also(c, category)])
        if card is not None and gain >= params.recommend_min_monthly:
            name = catalog.category_name(category)
            return Recommendation(card.card_id, catalog.card_label(card.card_id), gain, "special_visit",
                                  f"{name}에서 결제하셨네요. {catalog.card_label(card.card_id)}가 있었다면 지난 30일 동안 "
                                  f"약 {_won(gain)} 더 받았을 거예요(연회비 반영).")

    # 3) 같은 업종 반복 (최근 4일 중 3일 이상)
    days: dict[str, set] = {}
    for p in rows30:
        if p.is_placement and at - p.paid_at <= timedelta(days=4):
            days.setdefault(p.category, set()).add(p.paid_at.date())
    for category, seen in sorted(days.items(), key=lambda kv: -len(kv[1])):
        if len(seen) < params.recommend_repeat_days:
            break
        gain, card = best_monthly([c for c in pool if c.advertises(category) or _also(c, category)])
        if card is not None and gain >= params.recommend_min_monthly:
            name = catalog.category_name(category)
            return Recommendation(card.card_id, catalog.card_label(card.card_id), gain, "repeat",
                                  f"최근 4일 중 {len(seen)}일 {name}에서 결제하셨어요. {catalog.card_label(card.card_id)}가 "
                                  f"있었다면 지난 30일 동안 약 {_won(gain)} 더 받았을 거예요(연회비 반영).")

    # 4) 정기 (3일 간격)
    if last is not None and at - last < timedelta(days=params.recommend_interval_days):
        return None
    gain, card = best_monthly(pool)
    return _regular(catalog, gain, card, params)


def _regular(catalog, gain: int, card: Card | None, params: Params) -> Recommendation | None:
    if card is not None and gain >= params.recommend_min_monthly:
        return Recommendation(card.card_id, catalog.card_label(card.card_id), gain, "regular",
                              f"{catalog.card_label(card.card_id)}가 있었다면 지난 30일 동안 약 {_won(gain)} 더 "
                              f"받았을 거예요(연회비 반영).")
    return None


def regular_recommendation(state, payments: list[Payment], history: list[dict], at: datetime,
                           params: Params) -> Recommendation | None:
    """일정 팝업의 카드 추천 (설계서 v4.1): 아직 없는 신한카드 중 월 이득(연회비 반영)이 가장 큰 카드.
    recommend_min_monthly 원 이상일 때만, 같은 카드는 recommend_same_card_days 일 안에 다시 추천하지 않는다.
    3일 간격은 부르는 쪽(engine.popup)이 확인한다."""
    recent = {h["card_id"] for h in history if at - h["at"] < timedelta(days=params.recommend_same_card_days)}
    pool = [c for c in candidates(state) if c.card_id not in recent]
    if not pool:
        return None
    rows60 = [p for p in payments if at - timedelta(days=60) <= p.paid_at < at]
    threshold = params.switch_threshold
    base = _window(state, rows60, at, None, threshold)[0]
    scored = [(monthly_gain(state, rows60, c, at, threshold, base)[0], c) for c in pool]
    gain, card = max(scored, key=lambda x: x[0], default=(0, None))
    return _regular(state.catalog, gain, card, params)


def _also(card: Card, category: str) -> bool:
    return any(b.also and category in b.also for b in card.benefits)


def missed_benefit(state, rows: list[Payment], threshold: int = 300, swap: bool = True) -> list[dict]:
    """연말정산 안내용: 이 기간 결제에 각 신한카드가 있었다면 더 받았을 금액 (연회비 반영, 큰 순서).
    결제는 그대로 두고 현장 결제만 다시 고른다. 달마다 실적을 넘긴다. 두 가정 중 큰 쪽을 쓴다 (2026-11-19 사용자 결정):
    - 함께 쓰기(add): 가진 카드 중 최선보다 threshold 원 이상 더 주고 기존 카드의 실적 구간을 지킬 때만 새 카드로 낸다.
    - 바꾸기(swap): 가진 카드 하나를 새 카드로 바꿨다고 본다 (그 카드로 내던 결제가 모두 새 카드로 가 새 카드 실적이 찬다).
      합이 같으면 가장 덜 쓰던 카드를 바꾼 것으로 보고, 그 카드를 이 기간에 전혀 안 썼으면 '함께 쓰기'로 말한다.
      바꾼 카드의 연회비가 줄어드는 몫은 세지 않는다."""
    month = lambda p: (p.paid_at.year, p.paid_at.month)
    keys = sorted({month(p) for p in rows})
    if len(keys) < 2:
        return []
    count_from, months = keys[1], len(keys) - 1          # 첫 달은 전월 실적을 몰라 실적만 쌓는다
    base, perfs = _simulate(state, rows, None, {}, month, count_from, threshold)
    slack = _slack(state, perfs)
    spend = {c.user_card_id: 0 for c in state.cards}
    for p in rows:
        if p.user_card_id in spend:
            spend[p.user_card_id] += p.amount
    label = state.catalog.card_label
    out = []
    for card in candidates(state):
        fee = card.annual_fee * months / 12
        gain = int(_simulate(state, rows, card, {}, month, count_from, threshold, slack)[0] - base - fee)
        item = {"card_id": card.card_id, "card_name": label(card.card_id), "gain": gain, "months": months,
                "annual_fee": card.annual_fee, "basis": "add", "replaces_user_card_id": None, "replaces": None}
        if swap and state.cards:
            total, _, _, uc = max((_simulate(state, rows, None, {}, month, count_from, threshold,
                                             replace={c.user_card_id: card})[0], -spend[c.user_card_id], c.display_order, c)
                                  for c in state.cards)
            swap_gain = int(total - base - fee)
            if swap_gain > gain:
                item["gain"] = swap_gain
                if spend[uc.user_card_id] > 0:
                    item.update(basis="swap", replaces_user_card_id=uc.user_card_id, replaces=label(uc.card_id))
        item["message"] = missed_message(item)
        out.append(item)
    return sorted(out, key=lambda x: -x["gain"])


def missed_message(item: dict) -> str:
    """연말정산 안내 문구 (정해진 틀, 2026-11-19 사용자 결정). 숫자는 엔진 계산값 그대로."""
    who = f"{item['replaces']} 대신 이 카드를 쓰셨다면" if item["basis"] == "swap" else "이 카드를 발급받으셨다면"
    span = "1년" if item["months"] == 12 else f"{item['months']}개월"
    return f"그때 {who} {span} 동안 {item['gain']:,}원을 더 받으셨어요"
