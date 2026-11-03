"""③ 사용자와 보유 카드. 데모 5명은 personas.yml 그대로, 배경 사용자는 population.yml 규칙으로 만든다."""

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from .benefit import Card
from .common import load_config

BACKGROUND_ID_START = 1001


@dataclass
class UserCard:
    user_card_id: int
    card: Card
    display_order: int


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
    loc_consent: bool
    kpass_card: int | None = None               # user_card_id
    transit_default: int | None = None          # user_card_id
    bill_card: int | None = None                # 자동이체·고정 결제에 쓰는 카드
    telecom: tuple[str, int] | None = None      # (통신사, 금액)
    subscriptions: list[tuple[str, int, int]] = field(default_factory=list)  # (서비스, 금액, 결제일)
    choice_model: str = "main_card"
    category_habit: dict[str, int] = field(default_factory=dict)   # 업종 → 늘 쓰는 user_card_id

    def card(self, user_card_id: int) -> UserCard:
        return next(uc for uc in self.cards if uc.user_card_id == user_card_id)


def _normalize(d: dict) -> dict:
    s = sum(d.values())
    return {k: v / s for k, v in d.items()}


def _pick_background_cards(rng, cards: list[Card], archetype: str, rules: dict) -> list[Card]:
    w = np.array([rules["credit_weight"][archetype] if c.card_type == "credit" else 1.0 for c in cards])
    for _ in range(200):
        n = int(rng.integers(rules["count"]["min"], rules["count"]["max"] + 1))
        idx = rng.choice(len(cards), size=n, replace=False, p=w / w.sum())
        picked = [cards[i] for i in idx]
        if (any(c.issuer == rules["must_have_issuer"] for c in picked)
                and len({c.issuer for c in picked}) >= rules["min_issuers"]
                and any(c.card_type == "check" for c in picked)):
            return picked
    raise RuntimeError(f"{archetype} 보유 카드 조건을 만족하는 조합을 못 찾음")


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


def _finish(rng, u: User, dists: dict, kpass_code: str | None, transit_code: str | None) -> None:
    """교통·자동이체 관련 필드를 채운다."""
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
    n_sub = int(rng.integers(rec["SUBSCR"]["count_range"][0], rec["SUBSCR"]["count_range"][1] + 1))
    names = list(rec["SUBSCR"]["prices"])
    for name in rng.choice(names, size=n_sub, replace=False):
        u.subscriptions.append((str(name), rec["SUBSCR"]["prices"][name], int(rng.integers(1, 29))))


def build_users(rng: np.random.Generator, cards: list[Card], dists: dict, n_background: int) -> list[User]:
    personas = load_config("personas")
    pop = load_config("population")
    categories = [c["code"] for c in load_config("categories")["categories"]]
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
            habit=dict(personas["archetypes"][p["archetype"]]["habit"]), loc_consent=True,
        )
        _finish(rng, u, dists, p["kpass_card"], p["transit_default"])
        _set_choice(rng, u, personas["archetypes"][p["archetype"]], categories)
        users.append(u)

    archetypes = list(pop["archetype_share"])
    share = np.array([pop["archetype_share"][a] for a in archetypes])
    for i in range(n_background):
        uid = BACKGROUND_ID_START + i
        a = str(rng.choice(archetypes, p=share / share.sum()))
        age = str(rng.choice(pop["age_band"][a]))
        picked = _pick_background_cards(rng, cards, a, pop["cards"])
        rng.shuffle(picked)
        habit = {k: max(0.02, v + rng.normal(0, pop["habit_jitter_sd"]))
                 for k, v in personas["archetypes"][a]["habit"].items()}
        u = User(
            user_id=uid, user_type="background", display_name=f"배경 사용자 {uid}", archetype=a,
            age_band=age, gender=str(rng.choice(["M", "F"])),
            zones={
                "home": str(rng.choice(pop["zones"]["home"])),
                "work": None if a == "REMOTE" else str(rng.choice(pop["zones"]["work"])),
                "weekend": str(rng.choice(pop["zones"]["weekend"])),
            },
            kpass_tier="youth" if age == "20s" and rng.random() < pop["youth_kpass_share_20s"] else "general",
            cards=make_cards(picked), habit=_normalize(habit), loc_consent=bool(rng.random() < 0.6),
        )
        kpass = next((uc.card.code for uc in u.cards if "kpass" in uc.card.tags), None)
        _finish(rng, u, dists, kpass, kpass or u.cards[0].card.code)
        _set_choice(rng, u, personas["archetypes"][a], categories)
        users.append(u)
    return users


def users_frames(rng: np.random.Generator, users: list[User], created: date) -> dict[str, pd.DataFrame]:
    urows, crows, hrows = [], [], []
    for u in users:
        urows.append({
            "user_id": u.user_id, "user_type": u.user_type, "display_name": u.display_name,
            "persona_code": u.archetype, "age_band": u.age_band, "gender": u.gender,
            "home_zone": u.zones["home"], "work_zone": u.zones["work"], "weekend_zone": u.zones["weekend"],
            "kpass_tier": u.kpass_tier if u.kpass_card else None,
            "loc_consent": u.loc_consent, "loc_feature_on": u.loc_consent,
            "habit_habit": u.habit["habit"], "habit_random": u.habit["random"],
            "choice_model": u.choice_model,
            "created_at": pd.Timestamp(created, tz="Asia/Seoul"),
        })
        for cat, uc_id in u.category_habit.items():
            hrows.append({"user_id": u.user_id, "category_code": cat, "user_card_id": uc_id})
        for uc in u.cards:
            c = uc.card
            crows.append({
                "user_card_id": uc.user_card_id, "user_id": u.user_id, "card_id": c.card_id,
                "card_code": c.code, "issuer_code": c.issuer,
                "registered_via": "own_issuer" if c.issuer == "SHINHAN" else "openpay",
                "display_order": uc.display_order, "exclude_from_placement": False,
                "is_kpass_registered": uc.user_card_id == u.kpass_card,
                "is_transit_default": uc.user_card_id == u.transit_default,
                "is_bill_card": uc.user_card_id == u.bill_card,
                "nickname": None,
                "masked_number": f"****-****-****-{int(rng.integers(0, 10000)):04d}",
                "issued_at": date(2021, 1, 1) + timedelta(days=int(rng.integers(0, 1980))),
            })
    return {
        "users": pd.DataFrame(urows),
        "user_cards": pd.DataFrame(crows),
        "user_category_habits": pd.DataFrame(hrows, columns=["user_id", "category_code", "user_card_id"]),
    }
