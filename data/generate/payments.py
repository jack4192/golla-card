"""④ 결제 시뮬레이션 (소비 데이터만).

사용자마다 하루씩 진행하며 언제, 어디서, 무엇을, 얼마에, 어떤 가상 카드로 결제했는지만 만든다.
혜택·실적·한도는 여기서 계산하지 않고, 이 결제 내역을 받아 card_status.py에서 계산한다.

- 사용자마다 난수를 따로 쓴다 (seed, user_id). 사용자를 추가해도 기존 사용자의 결제는 바뀌지 않는다.
- 카드 선택은 혜택과 무관한 습관(주 카드 / 업종별 습관 카드 / 무작위)으로만 정한다.
- 시간대·금액은 생성기의 '종류'(places.yml kinds)로 정하고, 결제에 찍히는 업종은 가맹점의 실제 업종 코드다.
"""

import math
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .users import User

KST = ZoneInfo("Asia/Seoul")
DAYS_PER_MONTH = 30.4


def _lognormal_won(rng, median: float, sigma: float) -> int:
    """로그정규분포에서 뽑아 100원 단위로 맞춘 금액."""
    return max(100, int(round(median * math.exp(sigma * rng.normal()) / 100)) * 100)


def _weighted(rng, d: dict) -> str:
    keys = list(d)
    p = np.array([d[k] for k in keys], dtype=float)
    return str(keys[rng.choice(len(keys), p=p / p.sum())])


class Simulator:
    def __init__(self, settings, dists, programs, categories, places,
                 merchants: pd.DataFrame, merchant_zones: pd.DataFrame):
        self.seed = settings["seed"]
        self.start = settings["start_date"]
        as_of = settings["as_of"]
        if isinstance(as_of, str):
            as_of = datetime.fromisoformat(as_of)
        self.as_of = (as_of if as_of.tzinfo else as_of.replace(tzinfo=ZoneInfo("UTC"))).astimezone(KST)

        self.d = dists
        self.prog = programs
        # v2.1 개인 루틴 (2026-11-23). 설정이 없으면(v1·v2) 난수를 하나도 쓰지 않아 결과가 그대로다
        self.routine_cfg = dists.get("routines")
        self.user_routines: list[dict] = []
        self.routine_events: list[dict] = []
        self.routine_dropped = 0
        self.holidays = set(dists["holidays"])
        self.utility_items = {i["name"]: i for i in dists["recurring"]["UTILITY"]["items"]}
        self.channel = {c["code"]: c["channel"] for c in categories}
        self.noise_kinds = list(dists["noise_kinds"])
        self.online_kinds = set(places["online"])
        self.category_of = dict(zip(merchants.merchant_id, merchants.category_code))
        self.kind_of = dict(zip(merchants.merchant_id, merchants.kind))

        off = merchants[~merchants.is_online]
        mz = merchant_zones.merge(off[["merchant_id", "kind"]], on="merchant_id")
        self.by_zone_cat = {k: sorted(g.merchant_id.tolist()) for k, g in mz.groupby(["zone_code", "kind"])}
        self.any_zone_cat = {k: sorted(g.merchant_id.tolist()) for k, g in off.groupby("kind")}
        on = merchants[merchants.is_online]
        self.online = {k: sorted(g.merchant_id.tolist()) for k, g in on.groupby("kind")}
        self.online_by_name = dict(zip(on.place_name, on.merchant_id))
        self.home_shopping = sorted(self.online_by_name[n] for n in places["home_shopping"])
        self.online["ONLINE"] = [m for m in self.online["ONLINE"] if m not in self.home_shopping]
        # 배달앱·쇼핑몰은 시장 점유율로 고른다 (places.yml online_share, 없는 종류는 균등)
        name_of = {v: k for k, v in self.online_by_name.items()}
        self.online_p = {}
        for kind, share in places.get("online_share", {}).items():
            w = np.array([share[name_of[m]] for m in self.online[kind]], dtype=float)
            self.online_p[kind] = w / w.sum()

    # ---------- 하루 일정 ----------
    def _is_weekend(self, day: date) -> bool:
        return day.weekday() >= 5 or day in self.holidays

    def _at(self, day: date, hour: int, minute: float) -> datetime:
        return datetime.combine(day, time(0, 0), tzinfo=KST) + timedelta(hours=hour, minutes=float(minute))

    def _slot_at(self, rng, day: date, slot: str) -> datetime:
        """시간대 안의 시각. slot_time 이 있으면 정규분포로 뽑아 경계가 계단처럼 끊기지 않게 한다."""
        spec = self.d.get("slot_time", {}).get(slot)
        if spec is None:
            return self._at(day, int(rng.choice(self.d["slots"][slot])), rng.uniform(0, 60))
        lo, hi = self.d["slot_time_bounds"]
        h = float(np.clip(rng.normal(*spec), lo, hi))
        return self._at(day, 0, h * 60)

    def _debit_at(self, rng, day: date) -> datetime:
        """자동이체 승인 시각: 새벽 일괄 처리가 많고 오전·오후에도 일부 (distributions.yml debit_time)."""
        band = _weighted(rng, {k: v["weight"] for k, v in self.d["debit_time"].items()})
        lo, hi = self.d["debit_time"][band]["hours"]
        return self._at(day, 0, rng.uniform(lo, hi) * 60)

    @staticmethod
    def _is_due(day: date, dom: int) -> bool:
        """납부일이 그달 말일보다 크면(31일 등) 말일에 낸다."""
        first_next = date(day.year + day.month // 12, day.month % 12 + 1, 1)
        return day.day == min(dom, (first_next - timedelta(days=1)).day)

    def _spec(self, u: User, day: date) -> dict:
        """그날의 유형 설정. 교대근무(v2 shift_rotation)는 주마다 근무가 돌아가며 시간대·출퇴근·동네 규칙을 덮어쓴다."""
        a = self.d["archetypes"][u.archetype]
        rot = a.get("shift_rotation")
        if not rot:
            return a
        shift = rot["cycle"][(day.toordinal() // 7 + u.shift_offset) % len(rot["cycle"])]
        return {**a, **rot[shift]}

    def _day_events(self, rng, u: User, day: date, a: dict | None = None) -> list[tuple]:
        a = a or self._spec(u, day)
        weekend = self._is_weekend(day)
        dtype = "weekend" if weekend else "weekday"
        ev = []

        # 자동이체·고정 결제
        if self._is_due(day, u.fixed_day["TELECOM"]):
            ev.append((self._debit_at(rng, day), "auto_debit", "TELECOM", u.telecom))
        for name, price, dom in u.subscriptions:
            if self._is_due(day, dom):
                ev.append((self._debit_at(rng, day), "auto_debit", "SUBSCR", (name, price)))
        for name, dom in u.utilities:
            if self._is_due(day, dom):
                bill = (name, self._utility_bill(rng, name, day))
                ev.append((self._debit_at(rng, day), "auto_debit", "UTILITY", bill))
        for fx in a.get("monthly_fixed", []):
            # 학원비를 내지 않는 사용자(v2 나이대 효과)는 납부일이 없다
            if fx["category"] in u.fixed_day and self._is_due(day, u.fixed_day[fx["category"]]):
                amount = u.fixed_amount.get(fx["category"], fx.get("amount"))
                ev.append((self._debit_at(rng, day), "fixed", fx["category"], amount))

        # 출퇴근 교통
        cm = a["commute"]
        commute_today = (not weekend) and (cm["days"] == "weekday" or (cm["days"] == "twice_a_week" and rng.random() < 0.4))
        if commute_today:
            for h, m, sd in (cm["out"], cm["back"]):
                ev.append((self._at(day, h, m + rng.normal(0, sd)), "transit", "TRANSIT", None))
        default_rides = {"weekday": 0.0, "weekend": self.d["transit"]["weekend_rides_per_day"]}
        for _ in range(rng.poisson(a.get("rides_per_day", default_rides)[dtype])):
            ev.append((self._at(day, int(rng.integers(10, 21)), rng.uniform(0, 60)), "transit", "TRANSIT", None))

        # 일반 결제와 충동·대형 결제 (대형 결제는 배경 사용자만)
        n_regular = rng.poisson(a["per_day"][dtype] * u.count_level)
        n_impulse = rng.poisson(self.d["impulse"]["per_month"] / DAYS_PER_MONTH) if u.user_type == "background" else 0
        for kind, n in (("regular", n_regular), ("impulse", n_impulse)):
            for _ in range(n):
                slot = _weighted(rng, a["slot_weight"][dtype])
                ev.append((self._slot_at(rng, day, slot), kind, None, slot))

        # 특수 고액 결제 (동물병원·골프·자동차 정비)
        for kind, spec in self.d.get("special", {}).items():
            group = spec.get("group", "pet" if kind == "VET" else kind.lower())
            hours = spec["when"].get(dtype)
            if group not in u.specials or not hours:
                continue
            open_days = sum(DAYS_PER_MONTH * (5 / 7 if d == "weekday" else 2 / 7) for d in spec["when"])
            for _ in range(rng.poisson(spec["per_month"] / open_days)):
                ev.append((self._at(day, int(rng.choice(hours)), rng.uniform(0, 60)), "special", kind, None))

        # 심야 결제
        dawn = self.d["dawn"]
        rate = dawn["per_day"] * dawn["archetype_mult"].get(u.archetype, 1.0) * u.count_level * a.get("dawn_mult", 1.0)
        for _ in range(rng.poisson(rate)):
            hour = int(_weighted(rng, dawn["hour_weight"]))
            ev.append((self._at(day, hour, rng.uniform(0, 60)), "regular", None, "DAWN"))

        ev.sort(key=lambda e: e[0])
        return [e for e in ev if e[0] < self.as_of]

    # ---------- 업종·가맹점·금액 ----------
    def _category(self, rng, u: User, slot: str, weekend: bool) -> str:
        if slot == "DAWN":
            return _weighted(rng, self.d["dawn"]["category_weight"])
        if rng.random() < self.d["noise"]:
            return str(rng.choice(self.noise_kinds))
        a = self.d["archetypes"][u.archetype]
        w = dict(a["category_weight"][slot])
        if weekend:
            boost = a.get("weekend_boost", self.d["weekend_boost"])
            w = {k: v * boost.get(k, 1.0) for k, v in w.items()}
        if u.age_cat_mult:      # v2 나이대 효과
            w = {k: v * u.age_cat_mult.get(k, 1.0) for k, v in w.items()}
        return _weighted(rng, w)

    def _zone(self, rng, u: User, slot: str, weekend: bool, a: dict | None = None) -> str:
        a = a or self.d["archetypes"][u.archetype]
        dtype = "weekend" if weekend else "weekday"
        # 외근직(v2): 평일 정해진 시간대에는 여러 동네를 돈다
        if not weekend and slot in a.get("roam_slots", ()):
            return str(rng.choice(a["roam_zones"]))
        rule = (a.get("zone_by_slot") or {}).get(dtype, self.d["zone_by_slot"][dtype])[slot]
        key = _weighted(rng, rule) if isinstance(rule, dict) else rule
        return u.zones.get(key) or u.zones["home"]

    def _merchant(self, rng, u: User, zone: str, cat: str, favs: dict, only: str | None = None) -> int | None:
        """only: 이 업종 코드의 가맹점만 고른다 (예: 큰 의료비는 병원만)."""
        home_shopping = self.d["archetypes"][u.archetype].get("home_shopping_share")
        if cat == "ONLINE" and home_shopping and rng.random() < home_shopping:
            return int(rng.choice(self.home_shopping))
        if cat in self.online_kinds:
            return int(rng.choice(self.online[cat], p=self.online_p.get(cat)))

        def pick(ids):
            return [m for m in ids if self.category_of[m] == only] if ids and only else ids

        pool = pick(self.by_zone_cat.get((zone, cat)))
        if not pool:
            for z in (u.zones["home"], u.zones["work"], u.zones["weekend"]):
                pool = pick(self.by_zone_cat.get((z, cat)))
                if pool:
                    zone = z
                    break
        if not pool:
            pool = pick(self.any_zone_cat.get(cat))
            if not pool:
                return None
        key = (zone, cat) if only is None else (zone, cat, only)
        if key not in favs:
            favs[key] = [int(x) for x in rng.choice(pool, size=min(3, len(pool)), replace=False)]
        if rng.random() < u.favorite_prob:
            return int(rng.choice(favs[key]))
        return int(rng.choice(pool))

    def _amount(self, rng, u: User, cat: str, slot: str, weekend: bool = False, category: str | None = None) -> int:
        spec = self.d["amount"][cat]
        cap = None
        if isinstance(spec, dict) and "by_category" in spec:   # 병원·약국처럼 실제 업종마다 금액이 다른 종류
            cap = spec.get("cap", {}).get(category)
            spec = spec["by_category"][category]
        if isinstance(spec, dict) and "by_slot" in spec:
            spec = spec["by_slot"][slot]
        elif isinstance(spec, dict):
            kinds = spec["mix"]
            weights = np.array([k["weight"] for k in kinds], dtype=float)
            spec = kinds[rng.choice(len(kinds), p=weights / weights.sum())]["amount"]
        median, sigma = spec
        a = self.d["archetypes"][u.archetype]
        median *= a["amount_mult"] * u.amount_level * u.age_amount_mult
        median *= a.get("slot_amount_mult", {}).get(slot, {}).get(cat, 1.0)
        if weekend:
            median *= self.d.get("weekend_amount_mult", {}).get(cat, 1.0)
        won = _lognormal_won(rng, median, sigma)
        return won if cap is None else min(won, cap)

    def _impulse_category(self, rng) -> str:
        return _weighted(rng, {cat: spec["weight"] for cat, spec in self.d["impulse"]["category"].items()})

    def _impulse_amount(self, rng, u: User, cat: str) -> int:
        rule = self.d["impulse"]
        median = (rule["category"][cat]["median"] * self.d["archetypes"][u.archetype]["amount_mult"] * u.amount_level
                  * u.age_amount_mult)
        lo, hi = rule["range"]
        while not lo <= (won := _lognormal_won(rng, median, rule["sigma"])) <= hi:
            pass
        return won

    def _utility_bill(self, rng, name: str, day: date) -> int:
        item = self.utility_items[name]
        median, sigma = item["amount"]
        return _lognormal_won(rng, median * item.get("month_mult", {}).get(day.month, 1.0), sigma)

    def _transit(self, rng) -> tuple[str, int]:
        modes = self.d["transit"]["modes"]
        name = _weighted(rng, {k: v[1] for k, v in modes.items()})
        return name, modes[name][0] + int(rng.choice(self.d["transit"]["surcharge"]))

    # ---------- 개인 루틴 (v2.1, 2026-11-23 팀 결정) ----------
    @staticmethod
    def _minute(hhmm: str) -> int:
        h, m = hhmm.split(":")
        return int(h) * 60 + int(m)

    def _overlap(self, a: dict, b: dict) -> bool:
        """두 루틴의 시각 범위가 같은 요일 종류에서 겹치는지. 출근 시각 기준 루틴끼리는 겹친다고 본다."""
        if a["days"] != b["days"]:
            return False
        if "time" not in a or "time" not in b:
            return "time" not in a and "time" not in b
        (a0, a1), (b0, b1) = ([self._minute(x) for x in t["time"]] for t in (a, b))
        return a0 <= b1 and b0 <= a1

    def _slot_of_minute(self, minute: float) -> str:
        hour = int(minute // 60)
        return next((name for name, hours in self.d["slots"].items() if hour in hours), "DAWN")

    def _assign_routines(self, u: User) -> tuple[list[dict], np.random.Generator | None]:
        """배경 사용자에게 직업에 맞는 루틴 0~2개. 따로 뽑은 난수라 나머지 결제 난수는 밀리지 않는다."""
        rc = self.routine_cfg
        if not rc or u.user_type != "background" or u.archetype not in rc["by_archetype"]:
            return [], None
        rr = np.random.default_rng([self.seed, u.user_id, rc["seed"]])
        if rr.random() >= rc["share"]:
            return [], None
        n = int(_weighted(rr, {str(k): v for k, v in rc["count"].items()}))
        weights, chosen = dict(rc["by_archetype"][u.archetype]), []
        while len(chosen) < n and weights:
            name = _weighted(rr, weights)
            del weights[name]
            if not any(self._overlap(rc["templates"][name], rc["templates"][c]) for c in chosen):
                chosen.append(name)
        routines = []
        for no, name in enumerate(chosen, 1):
            t = rc["templates"][name]
            minute, before = -1, 0
            if "time" in t:
                lo, hi = (self._minute(x) for x in t["time"])
                minute = int(rr.integers(lo // 5, hi // 5 + 1)) * 5
            else:
                before = int(rr.integers(t["before_commute"][0], t["before_commute"][1] + 1))
            routines.append({"user_id": u.user_id, "routine_no": no, "template": name, "name": t["name"],
                             "days_type": t["days"], "kind": t["kind"], "minute": minute, "before_min": before,
                             "keep_prob": round(float(rr.uniform(*rc["keep_prob"])), 3), "merchant_id": None})
        return routines, rr

    def _typical_amount(self, u: User, kind: str, slot: str) -> float:
        """루틴 결제의 평소 금액(중앙값). 바꿀 결제를 금액이 비슷한 것으로 골라 월 지출이 v2 와 비슷하게 한다."""
        spec = self.d["amount"][kind]
        if isinstance(spec, dict):
            spec = spec["by_slot"].get(slot, next(iter(spec["by_slot"].values()))) if "by_slot" in spec else spec["mix"][0]["amount"]
        a = self.d["archetypes"][u.archetype]
        return spec[0] * a["amount_mult"] * u.amount_level * u.age_amount_mult

    def _pick_slot(self, u: User, r: dict, ts, slot: str, rows: list, free: list[int]) -> int | None:
        """바꿀 일반 결제: 같은 종류(예: 다른 시각의 카페)에서 가장 가까운 시각 → 없으면 금액이 비슷한(similar_amount_ratio 배 안)
        결제 중 가장 비슷한 것. 둘 다 없으면 None (루틴 결제를 새로 만든다)."""
        same = [i for i in free if self.kind_of.get(rows[i]["merchant_id"]) == r["kind"]]
        if same:
            return min(same, key=lambda i: abs((rows[i]["paid_at"] - ts).total_seconds()))
        typical = math.log(self._typical_amount(u, r["kind"], slot))
        band = math.log(self.routine_cfg["similar_amount_ratio"])
        near = [i for i in free if abs(math.log(rows[i]["amount"]) - typical) <= band]
        return min(near, key=lambda i: abs(math.log(rows[i]["amount"]) - typical), default=None)

    def _routine_plan(self, rr, u: User, routines: list[dict], day: date, spec: dict, weekend: bool,
                      events: list[tuple], rows: list) -> tuple[dict, list, list[int]]:
        """오늘 지킬 루틴과 자리. 반환: (바꿀 결제 번호 → (시각, 루틴, 시간대, 방식), 새로 만들 [(시각, 루틴, 시간대, 방식)], 남은 일반 결제 번호)."""
        rc = self.routine_cfg
        free = [i for i, e in enumerate(events) if e[1] == "regular" and e[3] != "DAWN" and rows[i] is not None]
        convert, add = {}, []
        for r in routines:
            if (r["days_type"] == "weekend") != weekend:
                continue
            if r["minute"] >= 0:
                base = r["minute"]
            else:
                cm = spec["commute"]
                if cm["days"] != "weekday":
                    continue
                base = cm["out"][0] * 60 + cm["out"][1] - r["before_min"]
            if rr.random() >= r["keep_prob"]:
                continue
            minute = base + rr.uniform(-rc["jitter_min"], rc["jitter_min"])
            ts = self._at(day, 0, minute)
            if ts >= self.as_of:
                continue
            slot = self._slot_of_minute(minute)
            pick = self._pick_slot(u, r, ts, slot, rows, free)
            if pick is None:
                add.append((ts, r, slot, "added"))
            else:
                free.remove(pick)
                kind = "same_kind" if self.kind_of.get(rows[pick]["merchant_id"]) == r["kind"] else "similar_amount"
                convert[pick] = (ts, r, slot, kind)
        return convert, add, free

    def _routine_pay(self, rr, u: User, r: dict, slot: str, weekend: bool, spec: dict, favs: dict):
        """루틴 결제의 (가맹점, 금액, 카드, 이유). 늘 가는 가게는 처음 갈 때 정한다. favs 는 루틴 전용 단골 목록."""
        zone = self._zone(rr, u, slot, weekend, spec)
        if r["merchant_id"] is None:
            r["merchant_id"] = self._merchant(rr, u, zone, r["kind"], favs)
        if r["merchant_id"] is not None and rr.random() < self.routine_cfg["same_merchant"]:
            merchant_id = r["merchant_id"]
        else:
            merchant_id = self._merchant(rr, u, zone, r["kind"], favs)
        if merchant_id is None:
            return None
        amount = self._amount(rr, u, r["kind"], "MORNING" if slot == "DAWN" else slot, weekend,
                              self.category_of[merchant_id])
        uc_id, reason = self._choose(rr, u, self.category_of[merchant_id])
        return merchant_id, amount, uc_id, reason

    # ---------- 카드 선택 ----------
    def _choose(self, rng, u: User, cat: str) -> tuple[int, str]:
        if _weighted(rng, u.habit) == "habit":
            if u.choice_model == "category_habit":
                return u.category_habit.get(cat, u.cards[0].user_card_id), "category_habit"
            return u.cards[0].user_card_id, "main_card"
        return u.cards[int(rng.integers(len(u.cards)))].user_card_id, "random"

    # ---------- 사용자 한 명 ----------
    def run_user(self, u: User) -> list[dict]:
        rng = np.random.default_rng([self.seed, u.user_id])
        favs: dict = {}
        # 학원비처럼 사용자마다 한 번 정해 매달 같은 금액인 고정 결제 (만 원 단위)
        for fx in self.d["archetypes"][u.archetype].get("monthly_fixed", []):
            if "amount_range" in fx:
                u.fixed_amount[fx["category"]] = int(rng.uniform(*fx["amount_range"]) // 10000 * 10000)
        routines, rr = self._assign_routines(u)
        routine_favs: dict = {}                 # 루틴 전용 단골 (공통 단골 목록을 건드리면 나머지 난수가 밀린다)
        debt = 0                                # 새로 만든 루틴 결제 수만큼 뒤의 날 일반 결제를 빼서 결제 수를 맞춘다
        rows = []
        day = self.start
        while day <= self.as_of.date():
            weekend = self._is_weekend(day)
            spec = self._spec(u, day)
            events = self._day_events(rng, u, day, spec)
            # 원래 결제는 모두 먼저 만든다 (바꾸거나 빼더라도 공통 난수는 그대로 써서 뒤 결제가 밀리지 않게)
            rows_today = [self._event_row(rng, u, day, weekend, spec, favs, *e) for e in events]
            convert, add, drop = ({}, [], set())
            if routines:
                convert, add, free = self._routine_plan(rr, u, routines, day, spec, weekend, events, rows_today)
                if debt and free:       # 앞서 새로 만든 루틴 결제만큼 뺀다: 루틴과 같은 종류 → 금액이 비슷한 결제만
                    kinds = {r["kind"] for r in routines}
                    typical = math.log(np.mean([self._typical_amount(u, r["kind"], "LUNCH") for r in routines]))
                    band = math.log(self.routine_cfg["similar_amount_ratio"])
                    gap = {i: abs(math.log(rows_today[i]["amount"]) - typical) for i in free}
                    ok = [i for i in free if self.kind_of.get(rows_today[i]["merchant_id"]) in kinds or gap[i] <= band]
                    order = sorted(ok, key=lambda i: (self.kind_of.get(rows_today[i]["merchant_id"]) not in kinds, gap[i]))
                    drop = set(order[:debt])
                    debt -= len(drop)
                    self.routine_dropped += len(drop)
                debt += len(add)
            for i, row in enumerate(rows_today):
                if i in convert:        # 일반 결제를 루틴으로 바꾼다
                    row = self._routine_row(rr, u, weekend, spec, routine_favs, convert[i]) or row
                elif i in drop:
                    row = None
                if row is not None:
                    rows.append(row)
            for item in add:
                row = self._routine_row(rr, u, weekend, spec, routine_favs, item)
                if row is not None:
                    rows.append(row)
            day += timedelta(days=1)
        self.user_routines.extend(routines)
        return rows

    def _routine_row(self, rr, u: User, weekend: bool, spec: dict, favs: dict, item: tuple) -> dict | None:
        ts, r, slot, how = item
        pay = self._routine_pay(rr, u, r, slot, weekend, spec, favs)
        if pay is None:
            return None
        merchant_id, amount, uc_id, reason = pay
        self.routine_events.append({"user_id": u.user_id, "routine_no": r["routine_no"], "paid_at": ts, "how": how})
        return self._row(u, ts, "regular", merchant_id, amount, uc_id, reason, "manual")

    def _event_row(self, rng, u: User, day: date, weekend: bool, spec: dict, favs: dict,
                   ts, kind, cat, extra) -> dict | None:
        """하루 일정의 결제 하나를 결제 행으로 만든다 (v2 까지의 run_user 본문 그대로)."""
        select_mode = "manual"
        if kind == "auto_debit":
            name, amount = extra
            merchant_id = self.online_by_name[name]
            uc_id, reason, select_mode = u.bill_card, "auto_debit", "auto_debit"
        elif kind == "fixed":
            amount = extra
            merchant_id = self._merchant(rng, u, u.zones["home"], cat, favs)
            uc_id, reason, select_mode = u.bill_card, "fixed", "auto_debit"
        elif kind == "transit":
            name, amount = self._transit(rng)
            merchant_id = self.online_by_name[name]
            if rng.random() < self.prog["transit"]["app_selected_prob"]:
                uc_id, reason = self._choose(rng, u, self.category_of[merchant_id])
                select_mode = "app_selected"
            else:
                uc_id = u.transit_default or u.cards[0].user_card_id
                reason, select_mode = "default_card", "default_card"
        elif kind == "special":
            sp = self.d["special"][cat]
            zone = u.zones["home"] if sp.get("zone") == "home" else self._zone(rng, u, "AFTERNOON", weekend, spec)
            merchant_id = self._merchant(rng, u, zone, cat, favs)
            if merchant_id is None:
                return None
            big = sp.get("big")
            if big and rng.random() < big["share"]:
                amount = int(rng.uniform(*big["range"]) // 1000 * 1000)
            else:
                amount = _lognormal_won(rng, *sp["amount"])
            uc_id, reason = self._choose(rng, u, self.category_of[merchant_id])
        else:
            slot = extra
            cat = self._category(rng, u, slot, weekend) if kind == "regular" else self._impulse_category(rng)
            only = self.d["impulse"]["category"][cat].get("only") if kind == "impulse" else None
            merchant_id = self._merchant(rng, u, self._zone(rng, u, slot, weekend, spec), cat, favs, only)
            if merchant_id is None:
                return None
            amount = (self._amount(rng, u, cat, slot, weekend, self.category_of[merchant_id]) if kind == "regular"
                      else self._impulse_amount(rng, u, cat))
            uc_id, reason = self._choose(rng, u, self.category_of[merchant_id])
        return self._row(u, ts, kind, merchant_id, amount, uc_id, reason, select_mode)

    def _row(self, u: User, ts, kind: str, merchant_id: int, amount: int, uc_id: int, reason: str,
             select_mode: str) -> dict:
        card = u.card(uc_id).card
        cat = self.category_of[merchant_id]
        own = card.issuer == "SHINHAN"
        # SOL페이 결제화면을 연 결제는 타사 카드라도 앱이 바로 안다 (그 밖의 타사 결제는 마이데이터로 다음 날 6시)
        in_app = select_mode == "app_selected" or (select_mode == "manual" and self.channel[cat] != "online")
        synced = ts if own or in_app else datetime.combine(ts.date() + timedelta(days=1), time(6, 0), tzinfo=KST)
        return {
            "user_id": u.user_id, "user_card_id": uc_id, "card_id": card.card_id,
            "issuer_code": card.issuer, "merchant_id": merchant_id, "category_code": cat,
            # 학원비 같은 고정 결제는 자동이체로 나간다 (업종 기본값은 현장 결제)
            "channel": "auto_debit" if kind == "fixed" else self.channel[cat],
            "card_select_mode": select_mode, "amount": amount,
            "paid_at": ts, "source": "own" if own else "mydata", "synced_at": synced,
            "is_scenario": False, "choice_reason": reason,
        }


def simulate(sim: Simulator, users: list[User]) -> pd.DataFrame:
    rows = []
    for u in users:
        rows.extend(sim.run_user(u))
    df = pd.DataFrame(rows).sort_values(["paid_at", "user_id"], kind="stable").reset_index(drop=True)
    df["merchant_id"] = df["merchant_id"].astype("Int64")
    return df
