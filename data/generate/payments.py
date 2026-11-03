"""④ 결제 시뮬레이션 (소비 데이터만).

사용자마다 하루씩 진행하며 언제, 어디서, 무엇을, 얼마에, 어떤 가상 카드로 결제했는지만 만든다.
혜택·실적·한도는 계산하지 않는다. 실제 카드 상품을 매칭할 때 이 결제 내역 위에서 계산한다.

- 사용자마다 난수를 따로 쓴다 (seed, user_id). 사용자를 추가해도 기존 사용자의 결제는 바뀌지 않는다.
- 카드 선택은 혜택과 무관한 습관(주 카드 / 업종별 습관 카드 / 무작위)으로만 정한다.
"""

import math
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from .users import User

KST = ZoneInfo("Asia/Seoul")


def _weighted(rng, d: dict) -> str:
    keys = list(d)
    p = np.array([d[k] for k in keys], dtype=float)
    return str(keys[rng.choice(len(keys), p=p / p.sum())])


class Simulator:
    def __init__(self, settings, dists, programs, categories, places, merchants: pd.DataFrame):
        self.seed = settings["seed"]
        self.start = settings["start_date"]
        as_of = settings["as_of"]
        if isinstance(as_of, str):
            as_of = datetime.fromisoformat(as_of)
        self.as_of = (as_of if as_of.tzinfo else as_of.replace(tzinfo=ZoneInfo("UTC"))).astimezone(KST)

        self.d = dists
        self.prog = programs
        self.holidays = set(dists["holidays"])
        self.channel = {c["code"]: c["channel"] for c in categories}
        self.noise_cats = [c["code"] for c in categories
                           if c["placement_target"] and c["code"] not in ("TRANSIT", "EDU")]
        self.online_cats = set(places["online"])

        off = merchants[~merchants.is_online]
        self.by_zone_cat = {k: sorted(g.merchant_id.tolist()) for k, g in off.groupby(["zone_code", "category_code"])}
        self.any_zone_cat = {k: sorted(g.merchant_id.tolist()) for k, g in off.groupby("category_code")}
        on = merchants[merchants.is_online]
        self.online = {k: sorted(g.merchant_id.tolist()) for k, g in on.groupby("category_code")}
        self.online_by_name = dict(zip(on.place_name, on.merchant_id))

    # ---------- 하루 일정 ----------
    def _is_weekend(self, day: date) -> bool:
        return day.weekday() >= 5 or day in self.holidays

    def _at(self, day: date, hour: int, minute: float) -> datetime:
        return datetime.combine(day, time(0, 0), tzinfo=KST) + timedelta(hours=hour, minutes=float(minute))

    def _day_events(self, rng, u: User, day: date) -> list[tuple]:
        a = self.d["archetypes"][u.archetype]
        weekend = self._is_weekend(day)
        dtype = "weekend" if weekend else "weekday"
        ev = []

        # 자동이체·고정 결제
        if day.day == self.d["recurring"]["TELECOM"]["day"]:
            ev.append((self._at(day, 7, rng.uniform(0, 60)), "auto_debit", "TELECOM", u.telecom))
        for name, price, dom in u.subscriptions:
            if day.day == dom:
                ev.append((self._at(day, 7, rng.uniform(0, 60)), "auto_debit", "SUBSCR", (name, price)))
        for fx in a.get("monthly_fixed", []):
            if day.day == fx["day"]:
                ev.append((self._at(day, 16, rng.uniform(0, 120)), "fixed", fx["category"], fx["amount"]))

        # 출퇴근 교통
        cm = a["commute"]
        commute_today = (not weekend) and (cm["days"] == "weekday" or (cm["days"] == "twice_a_week" and rng.random() < 0.4))
        if commute_today:
            for h, m, sd in (cm["out"], cm["back"]):
                ev.append((self._at(day, h, m + rng.normal(0, sd)), "transit", "TRANSIT", None))
        if weekend:
            for _ in range(rng.poisson(self.d["transit"]["weekend_rides_per_day"])):
                ev.append((self._at(day, int(rng.integers(10, 21)), rng.uniform(0, 60)), "transit", "TRANSIT", None))

        # 일반 결제
        for _ in range(rng.poisson(a["per_day"][dtype])):
            slot = _weighted(rng, a["slot_weight"][dtype])
            hour = int(rng.choice(self.d["slots"][slot]))
            ev.append((self._at(day, hour, rng.uniform(0, 60)), "regular", None, slot))

        ev.sort(key=lambda e: e[0])
        return [e for e in ev if e[0] < self.as_of]

    # ---------- 업종·가맹점·금액 ----------
    def _category(self, rng, u: User, slot: str, weekend: bool) -> str:
        if rng.random() < self.d["noise"]:
            return str(rng.choice(self.noise_cats))
        a = self.d["archetypes"][u.archetype]
        w = dict(a["category_weight"][slot])
        if weekend:
            boost = a.get("weekend_boost", self.d["weekend_boost"])
            w = {k: v * boost.get(k, 1.0) for k, v in w.items()}
        return _weighted(rng, w)

    def _zone(self, rng, u: User, slot: str, weekend: bool) -> str:
        rule = self.d["zone_by_slot"]["weekend" if weekend else "weekday"][slot]
        key = _weighted(rng, rule) if isinstance(rule, dict) else rule
        return u.zones.get(key) or u.zones["home"]

    def _merchant(self, rng, u: User, zone: str, cat: str, favs: dict) -> int | None:
        if cat in self.online_cats:
            return int(rng.choice(self.online[cat]))
        pool = self.by_zone_cat.get((zone, cat))
        if not pool:
            for z in (u.zones["home"], u.zones["work"], u.zones["weekend"]):
                pool = self.by_zone_cat.get((z, cat))
                if pool:
                    zone = z
                    break
        if not pool:
            pool = self.any_zone_cat.get(cat)
            if not pool:
                return None
        key = (zone, cat)
        if key not in favs:
            favs[key] = [int(x) for x in rng.choice(pool, size=min(3, len(pool)), replace=False)]
        if rng.random() < self.d["favorite_prob"]:
            return int(rng.choice(favs[key]))
        return int(rng.choice(pool))

    def _amount(self, rng, u: User, cat: str) -> int:
        median, sigma = self.d["amount"][cat]
        median *= self.d["archetypes"][u.archetype]["amount_mult"]
        return max(100, int(round(median * math.exp(sigma * rng.normal()) / 100)) * 100)

    def _transit(self, rng) -> tuple[str, int]:
        modes = self.d["transit"]["modes"]
        name = _weighted(rng, {k: v[1] for k, v in modes.items()})
        return name, modes[name][0] + int(rng.choice(self.d["transit"]["surcharge"]))

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
        rows = []
        day = self.start
        while day <= self.as_of.date():
            weekend = self._is_weekend(day)
            for ts, kind, cat, extra in self._day_events(rng, u, day):
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
                        uc_id, reason = self._choose(rng, u, cat)
                        select_mode = "app_selected"
                    else:
                        uc_id = u.transit_default or u.cards[0].user_card_id
                        reason, select_mode = "default_card", "default_card"
                else:
                    slot = extra
                    cat = self._category(rng, u, slot, weekend)
                    merchant_id = self._merchant(rng, u, self._zone(rng, u, slot, weekend), cat, favs)
                    if merchant_id is None:
                        continue
                    amount = self._amount(rng, u, cat)
                    uc_id, reason = self._choose(rng, u, cat)

                card = u.card(uc_id).card
                own = card.issuer == "SHINHAN"
                synced = ts if own else datetime.combine(ts.date() + timedelta(days=1), time(6, 0), tzinfo=KST)
                rows.append({
                    "user_id": u.user_id, "user_card_id": uc_id, "card_id": card.card_id,
                    "issuer_code": card.issuer, "merchant_id": merchant_id, "category_code": cat,
                    "channel": self.channel[cat], "card_select_mode": select_mode, "amount": amount,
                    "paid_at": ts, "source": "own" if own else "mydata", "synced_at": synced,
                    "is_scenario": False, "choice_reason": reason,
                })
            day += timedelta(days=1)
        return rows


def simulate(sim: Simulator, users: list[User]) -> pd.DataFrame:
    rows = []
    for u in users:
        rows.extend(sim.run_user(u))
    df = pd.DataFrame(rows).sort_values(["paid_at", "user_id"], kind="stable").reset_index(drop=True)
    df["merchant_id"] = df["merchant_id"].astype("Int64")
    return df
