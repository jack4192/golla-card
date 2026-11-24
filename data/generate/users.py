"""③ 사용자와 보유 카드. 데모 5명은 personas.yml 그대로, 배경 사용자는 population.yml 규칙으로 만든다."""

from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import NormalDist

import math

import numpy as np
import pandas as pd

from .benefit import Card
from .common import load_config

BACKGROUND_ID_START = 1001
# 데모 사용자에게 나중에 더한 카드(personas.yml added_cards)의 난수. 공통 난수를 쓰면 뒤 사용자 값이 모두 밀린다
ADDED_CARD_SEED = 20261118


@dataclass
class UserCard:
    user_card_id: int
    card: Card
    display_order: int
    added: bool = False         # personas.yml added_cards 로 나중에 더한 카드


@dataclass
class User:
    user_id: int
    user_type: str
    display_name: str
    archetype: str
    age_band: str
    gender: str
    zones: dict
    kpass_tier: str
    cards: list[UserCard]                       # 기본 순서대로
    habit: dict
    kpass_card: int | None = None               # user_card_id
    transit_default: int | None = None          # user_card_id
    bill_card: int | None = None                # 자동이체·고정 결제에 쓰는 카드
    telecom: tuple[str, int] | None = None      # (통신사, 금액)
    fixed_day: dict[str, int] = field(default_factory=dict)  # 납부일 (TELECOM, EDU 등)
    subscriptions: list[tuple[str, int, int]] = field(default_factory=list)  # (서비스, 금액, 결제일)
    utilities: list[tuple[str, int]] = field(default_factory=list)           # (공과금 항목, 납부일)
    choice_model: str = "main_card"
    category_habit: dict[str, int] = field(default_factory=dict)   # 업종 → 늘 쓰는 user_card_id
    count_level: float = 1.0                    # 일반 결제 건수 배율
    amount_level: float = 1.0                   # 일반 결제 금액 배율
    favorite_prob: float = 0.7                  # 단골 3곳 중에서 고를 확률
    specials: frozenset = frozenset()           # 특수 고액 결제 묶음 (pet, golf, car, ev, intercity). 생성기 전용, 엔진은 모른다
    fixed_amount: dict = field(default_factory=dict)    # 고정 결제(학원비) 금액. 사용자마다 한 번 정한다
    # v2 나이대 효과 (배경 사용자만, 2026-11-22). 기본값이면 v1 과 같은 결과
    age_cat_mult: dict[str, float] = field(default_factory=dict)   # 생성기 종류 → 업종 가중치 배율
    age_amount_mult: float = 1.0                                  # 건당 금액 배율
    shift_offset: int = 0                                         # 교대근무 시작 위치 (user_id % 3)

    def card(self, user_card_id: int) -> UserCard:
        return next(uc for uc in self.cards if uc.user_card_id == user_card_id)


def _normalize(d: dict) -> dict:
    s = sum(d.values())
    return {k: v / s for k, v in d.items()}


def _spend_levels(rng, rule: dict, n: int) -> list[tuple[float, float]]:
    """사용자별 (건수 배율, 금액 배율). 분포를 n등분해 나눠 주므로 인원이 적어도 설정값에서 크게 벗어나지 않는다."""
    even = [NormalDist().inv_cdf((i + 0.5) / n) for i in range(n)]
    rho = rule["correlation"]
    z_count = rng.permutation(even)
    z_amount = rho * z_count + math.sqrt(1 - rho ** 2) * rng.permutation(even)

    def level(spec: dict, z: float) -> float:
        return float(np.clip(spec["median"] * math.exp(spec["sigma"] * z), *spec["range"]))

    return [(level(rule["count"], c), level(rule["amount"], m)) for c, m in zip(z_count, z_amount)]


def _card_count(rng, count_dist: dict | None, archetype: str, age: str) -> int | None:
    """v2 보유 카드 수 (2026-11-22): 대학생 / 20대 / 60대 / 그 밖(30~50대) 집단의 분포에서 뽑는다. 분포가 없으면(v1) None."""
    if not count_dist:
        return None
    key = "student" if archetype == "STUDENT" else age if age in ("20s", "60s") else "30s_50s"
    dist = count_dist[key]
    ns = sorted(dist)
    p = np.array([dist[k] for k in ns], dtype=float)
    return int(ns[rng.choice(len(ns), p=p / p.sum())])


def _pick_background_cards(rng, cards: list[Card], archetype: str, rules: dict, eligibility: dict,
                           want_other: bool, exclusive: list[list[str]] = (), n: int | None = None) -> list[Card]:
    """신한 1장 이상, 타사 카드는 other_issuer_share 비율의 사용자만, 체크 1장 이상. 발급 자격 카드는 해당 유형만.
    한 카드의 모드·팩(MOVING 3모드, 올원더풀 2팩)은 묶음마다 하나만 가진다.
    n 이 있으면(v2) 장수를 고정하고, 신한만 가질 사용자는 처음부터 신한 카드 안에서 뽑는다 (5장을 무작위로 뽑아 전부 신한일 확률은 거의 0)."""
    pool = [c for c in cards if archetype in eligibility.get(c.code, [archetype])]
    if n is not None and not want_other:
        pool = [c for c in pool if c.issuer == rules["must_have_issuer"]]
    w = np.array([rules["credit_weight"][archetype] if c.card_type == "credit" else 1.0 for c in pool])
    fixed_n = n
    for _ in range(500):
        n = fixed_n if fixed_n is not None else int(rng.integers(rules["count"]["min"], rules["count"]["max"] + 1))
        idx = rng.choice(len(pool), size=n, replace=False, p=w / w.sum())
        picked = [pool[i] for i in idx]
        codes = {c.code for c in picked}
        if (any(c.issuer == rules["must_have_issuer"] for c in picked)
                and any(c.issuer != rules["must_have_issuer"] for c in picked) == want_other
                and sum(c.card_type == "check" for c in picked) >= rules["min_check"]
                and all(len(codes & set(group)) <= 1 for group in exclusive)):
            return picked
    raise RuntimeError(f"{archetype} 보유 카드 조건을 만족하는 조합을 못 찾음")


def _pick_specials(rng, special: dict, archetype: str, car_mult: float = 1.0) -> frozenset:
    """특수 고액 결제 묶음을 사용자마다 한 번 정한다. 같은 묶음(golf)의 종류들은 함께 정해진다.
    requires 가 있으면 그 묶음을 가진 사용자 중에서만 뽑는다 (전기차 충전은 차량 보유자 중에서).
    car_mult 는 차량 보유 비율에 곱하는 나이대 배율 (v2)."""
    groups = {}
    for kind, spec in special.items():
        groups.setdefault(spec.get("group", kind.lower() if kind != "VET" else "pet"), spec)
    picked = set()
    for g, spec in groups.items():
        owners = spec["owners"]
        share = owners.get(archetype, owners.get("all", 0.0))
        hit = rng.random() < (share * car_mult if g == "car" else share)
        if hit and spec.get("requires", g) in picked | {g}:
            picked.add(g)
    return frozenset(picked)


def _set_choice(rng, u: User, spec: dict, categories: list[str]) -> None:
    """카드 선택 방식. category_habit이면 업종마다 늘 쓰는 카드를 한 번 정해 둔다 (카드 혜택은 보지 않음)."""
    u.choice_model = spec["choice_model"]["type"]
    if u.choice_model != "category_habit":
        return
    main = u.cards[0].user_card_id
    others = [uc.user_card_id for uc in u.cards[1:]]
    for cat in categories:
        if not others or rng.random() < spec["choice_model"]["main_prob"]:
            u.category_habit[cat] = main
        else:
            u.category_habit[cat] = int(rng.choice(others))


def _finish(rng, u: User, dists: dict, kpass_code: str | None, transit_code: str | None,
            edu_share: float | None = None) -> None:
    """교통·자동이체 관련 필드를 채운다. edu_share 가 있으면(v2 나이대 효과) 그 확률로만 학원비를 낸다."""
    by_code = {uc.card.code: uc.user_card_id for uc in u.cards}
    if kpass_code is not None:
        u.kpass_card = by_code[kpass_code]
    # 교통 대표 카드를 따로 정하지 않았으면 기본 순서 1번
    u.transit_default = by_code[transit_code] if transit_code is not None else u.cards[0].user_card_id

    # 고지서는 신용카드에 거는 경우가 많다고 보고, 신용카드가 있으면 그중 기본 순서가 가장 앞선 것
    credit = [uc for uc in u.cards if uc.card.card_type == "credit"]
    u.bill_card = (credit or u.cards)[0].user_card_id

    places = load_config("places")["online"]
    rec = dists["recurring"]
    lo, hi = rec["TELECOM"]["amount_range"]
    u.telecom = (str(rng.choice(places["TELECOM"])), int(rng.integers(lo, hi + 1) // 100 * 100))
    # 납부일: 통신비는 정해진 날 중 하나, 학원비 같은 고정 결제는 범위 안에서 사용자마다 한 번 정한다 (2026-11-16)
    u.fixed_day["TELECOM"] = int(rng.choice(rec["TELECOM"]["days"]))
    for fx in dists["archetypes"][u.archetype].get("monthly_fixed", []):
        if edu_share is not None and fx["category"] == "EDU" and rng.random() >= edu_share:
            continue
        lo_d, hi_d = fx["day_range"]
        u.fixed_day[fx["category"]] = int(rng.integers(lo_d, hi_d + 1))
    n_sub = int(rng.integers(rec["SUBSCR"]["count_range"][0], rec["SUBSCR"]["count_range"][1] + 1))
    names = list(rec["SUBSCR"]["prices"])
    for name in rng.choice(names, size=n_sub, replace=False):
        u.subscriptions.append((str(name), rec["SUBSCR"]["prices"][name], int(rng.integers(1, 29))))

    util = rec["UTILITY"]
    if rng.random() < util["payer_share"].get(u.archetype, 1.0):
        for item in util["items"]:
            if u.archetype in item.get("only", [u.archetype]):
                u.utilities.append((item["name"], int(rng.integers(1, 29))))


def build_users(rng: np.random.Generator, cards: list[Card], dists: dict, n_background: int) -> list[User]:
    personas = load_config("personas")
    pop = load_config("population")
    card_map = load_config("card_db_map")
    eligibility, exclusive = card_map["eligibility"], card_map["exclusive_groups"]
    categories = [c["code"] for c in load_config("categories")["categories"] if c["generated"]]
    by_code = {c.code: c for c in cards}
    users: list[User] = []
    next_uc = 1

    def make_cards(card_list: list[Card]) -> list[UserCard]:
        nonlocal next_uc
        out = []
        for order, c in enumerate(card_list, start=1):
            out.append(UserCard(next_uc, c, order))
            next_uc += 1
        return out

    for p in personas["demo_users"]:
        u = User(
            user_id=p["id"], user_type="demo", display_name=p["display_name"], archetype=p["archetype"],
            age_band=p["age_band"], gender=p["gender"], zones=dict(p["zones"]), kpass_tier=p["kpass_tier"],
            cards=make_cards([by_code[c] for c in p["cards"]]),
            habit=dict(personas["archetypes"][p["archetype"]]["habit"]),
            amount_level=p["amount_level"], favorite_prob=dists["favorite_prob"],
        )
        _finish(rng, u, dists, p["kpass_card"], p["transit_default"])
        _set_choice(rng, u, personas["archetypes"][p["archetype"]], categories)
        u.specials = frozenset(p.get("special", []))
        users.append(u)

    if "cells" in pop:
        # v2 (2026-11-22): 직업×나이대 칸마다 정한 인원을 펼친 뒤 순서만 섞는다
        total = sum(c["n"] for c in pop["cells"])
        if total != n_background:
            raise ValueError(f"cells 합 {total} != n_background_users {n_background}")
        cells = [(c["archetype"], c["age_band"]) for c in pop["cells"] for _ in range(c["n"])]
        cells = [cells[k] for k in rng.permutation(n_background)]
    else:
        archetypes = list(pop["archetype_share"])
        share = np.array([pop["archetype_share"][a] for a in archetypes])
        # 유형은 설정한 비율대로 정확히 나눈 뒤 순서만 섞는다
        assigned = rng.permutation(np.searchsorted(np.cumsum(share / share.sum()), (np.arange(n_background) + 0.5) / n_background))
        cells = [(archetypes[k], None) for k in assigned]
    levels = _spend_levels(rng, pop["spend_level"], n_background)
    favorite = rng.permutation(np.linspace(*pop["favorite_prob_range"], n_background))
    # KB 보유자도 설정 비율대로 정확히 나눈 뒤 순서만 섞는다
    n_other = round(pop["cards"]["other_issuer_share"] * n_background)
    want_other = rng.permutation([True] * n_other + [False] * (n_background - n_other))
    age_effects = dists.get("age_effects", {})
    work_rule = pop.get("work_zone_rule", {})

    def work_zone(a: str, home: str) -> str | None:
        """회사 동네. 규칙이 없으면(v1) 기본 후보 중 하나."""
        rule = work_rule.get(a)
        if a in pop["no_work_zone"]:
            return None
        if rule == "home":
            return home
        return str(rng.choice(rule if rule else pop["zones"]["work"]))

    def add_background(i: int, a: str, age: str | None, level: tuple[float, float], fav: float, other: bool) -> None:
        uid = BACKGROUND_ID_START + i
        age = age or str(rng.choice(pop["age_band"][a]))
        n_cards = _card_count(rng, pop["cards"].get("count_dist"), a, age)
        picked = _pick_background_cards(rng, cards, a, pop["cards"], eligibility, other, exclusive, n_cards)
        rng.shuffle(picked)
        habit = {k: max(0.02, v + rng.normal(0, pop["habit_jitter_sd"]))
                 for k, v in personas["archetypes"][a]["habit"].items()}
        count_level, amount_level = level
        gender = str(rng.choice(["M", "F"]))
        home = str(rng.choice(pop["zones"]["home"]))
        zones = {"home": home, "work": work_zone(a, home), "weekend": str(rng.choice(pop["zones"]["weekend"]))}
        ae = age_effects.get(age, {})
        u = User(
            user_id=uid, user_type="background", display_name=f"배경 사용자 {uid}", archetype=a,
            age_band=age, gender=gender, zones=zones,
            kpass_tier="youth" if age == "20s" and rng.random() < pop["youth_kpass_share_20s"] else "general",
            cards=make_cards(picked), habit=_normalize(habit),
            count_level=count_level, amount_level=amount_level, favorite_prob=fav,
            age_cat_mult=dict(ae.get("category_mult") or {}), age_amount_mult=ae.get("amount_mult", 1.0),
            shift_offset=uid % 3,
        )
        kpass = next((uc.card.code for uc in u.cards if "kpass" in uc.card.tags), None)
        _finish(rng, u, dists, kpass, kpass or u.cards[0].card.code, ae.get("edu_share"))
        _set_choice(rng, u, personas["archetypes"][a], categories)
        u.specials = _pick_specials(rng, dists.get("special", {}), a, ae.get("car_mult", 1.0))
        users.append(u)

    for i, (a, age) in enumerate(cells):
        add_background(i, a, age, levels[i], float(favorite[i]), bool(want_other[i]))

    # 추가 인원 (2026-11-14 결정: 기존 300명은 그대로 두고 50대 60명을 더한다)
    extra = [(g["archetype"], g["age_band"]) for g in pop.get("extra_users", []) for _ in range(g["n"])]
    if extra:
        n = len(extra)
        order = rng.permutation(n)
        levels2 = _spend_levels(rng, pop["spend_level"], n)
        favorite2 = rng.permutation(np.linspace(*pop["favorite_prob_range"], n))
        n_other2 = round(pop["cards"]["other_issuer_share"] * n)
        want_other2 = rng.permutation([True] * n_other2 + [False] * (n - n_other2))
        for j, k in enumerate(order):
            a, age = extra[k]
            add_background(n_background + j, a, age, levels2[j], float(favorite2[j]), bool(want_other2[j]))

    # 데모 사용자에게 나중에 더한 카드 (2026-11-18: 모든 사용자가 신한카드를 갖는다).
    # 다른 사용자의 카드 번호와 공통 난수를 바꾸지 않도록 맨 뒤 번호를 쓰고, 업종별 습관은 별도 난수로 다시 정한다
    by_id = {u.user_id: u for u in users}
    for p in personas["demo_users"]:
        added = p.get("added_cards") or []
        if not added:
            continue
        u = by_id[p["id"]]
        for code in added:
            u.cards.append(UserCard(next_uc, by_code[code], len(u.cards) + 1, added=True))
            next_uc += 1
        u.category_habit = {}
        _set_choice(np.random.default_rng([ADDED_CARD_SEED, u.user_id]), u, personas["archetypes"][p["archetype"]],
                    categories)
    return users


def users_frames(rng: np.random.Generator, users: list[User], created: date) -> dict[str, pd.DataFrame]:
    urows, crows, hrows = [], [], []
    for u in users:
        urows.append({
            "user_id": u.user_id, "user_type": u.user_type, "display_name": u.display_name,
            "persona_code": u.archetype, "age_band": u.age_band, "gender": u.gender,
            "home_zone": u.zones["home"], "work_zone": u.zones["work"], "weekend_zone": u.zones["weekend"],
            "kpass_tier": u.kpass_tier if u.kpass_card else None,
            "habit_habit": u.habit["habit"], "habit_random": u.habit["random"],
            "choice_model": u.choice_model,
            "special_groups": ",".join(sorted(u.specials)),     # 생성기 전용
            "created_at": pd.Timestamp(created, tz="Asia/Seoul"),
        })
        for cat, uc_id in u.category_habit.items():
            hrows.append({"user_id": u.user_id, "category_code": cat, "user_card_id": uc_id})
        for uc in u.cards:
            c = uc.card
            r = np.random.default_rng([ADDED_CARD_SEED, uc.user_card_id]) if uc.added else rng   # 공통 난수를 밀지 않는다
            crows.append({
                "user_card_id": uc.user_card_id, "user_id": u.user_id, "card_id": c.card_id,
                "card_code": c.code, "issuer_code": c.issuer,
                "registered_via": "own_issuer" if c.issuer == "SHINHAN" else "openpay",
                "display_order": uc.display_order, "exclude_from_placement": False,
                "is_kpass_registered": uc.user_card_id == u.kpass_card,
                "is_transit_default": uc.user_card_id == u.transit_default,
                "is_bill_card": uc.user_card_id == u.bill_card,
                "nickname": None,
                "masked_number": f"****-****-****-{int(r.integers(0, 10000)):04d}",
                # 데이터 시작 전에 발급한 카드만 둔다 (2026-11-14: 시작을 2025-11 로 당기면서 발급 전 결제가 생겼던 문제)
                "issued_at": date(2021, 1, 1) + timedelta(days=int(r.integers(0, (created - date(2021, 1, 1)).days))),
            })
    return {
        "users": pd.DataFrame(urows),
        "user_cards": pd.DataFrame(crows),
        "user_category_habits": pd.DataFrame(hrows, columns=["user_id", "category_code", "user_card_id"]),
    }
