from tests.conftest import USER_CARDS, at, pay
from engine.domain import User
from engine.report import card_rows, limits_of, tier_info
from engine.state import UserState


def test_tier_info():
    assert tier_info([300_000, 500_000], 320_000) == {"first_tier": 300_000, "tier_reached": 300_000,
                                                      "achieved": True, "short_of_first": 0}
    assert tier_info([200_000], 150_000) == {"first_tier": 200_000, "tier_reached": None,
                                             "achieved": False, "short_of_first": 50_000}
    none = {"first_tier": None, "tier_reached": None, "achieved": None, "short_of_first": None}
    assert tier_info([0], 10_000) == none
    assert tier_info([], 10_000) == none


def _states(catalog, params):
    sept = [pay(101, 320_000, "CAFE", at(9, 5)), pay(103, 150_000, "TRANSIT", at(9, 6), merchant=20)]
    now, prev = UserState(User(1), USER_CARDS, catalog, params), UserState(User(1), USER_CARDS, catalog, params)
    for p in sept:
        now.apply(p)
        prev.apply(p)
    prev.roll_to("2026-09")
    now.apply(pay(101, 10_000, "CAFE", at(10, 3)))
    now.roll_to("2026-10")
    return now, prev


def test_card_rows_이번_달과_지난달(catalog, params):
    now, prev = _states(catalog, params)
    rows = {r["user_card_id"]: r for r in card_rows(now, prev, catalog)}
    r101, r102, r103 = rows[101], rows[102], rows[103]

    assert r101["name"] == catalog.card_label(1) and r101["card_id"] == 1 and r101["synced_note"] is False
    assert r101["prev_month"]["perf"] == 320_000 and r101["prev_month"]["achieved"] is True
    assert r101["prev_month"]["payments"] == 1
    t = r101["this_month"]
    assert (t["perf"], t["payments"], t["tier_min"]) == (10_000, 1, 300_000)
    assert (t["next_tier"], t["remaining_to_next"], t["remaining_to_keep"]) == (300_000, 290_000, 290_000)
    assert t["benefit"] == now.ledger[101].discount == 1_000
    assert t["limits"] == limits_of(catalog.cards[1], now.ledger[101])

    assert r103["synced_note"] is True
    assert r103["prev_month"]["short_of_first"] == 50_000 and r103["prev_month"]["achieved"] is False
    assert r103["this_month"]["tier_min"] is None and r103["this_month"]["next_tier"] == 200_000

    assert r102["prev_month"]["payments"] == 0 and r102["prev_month"]["perf"] == 0
    assert r102["prev_month"]["achieved"] is False


def test_무실적_카드는_구간_칸이_비어_있다(catalog, params):
    cards = USER_CARDS + [type(USER_CARDS[0])(104, 4, "SHINHAN", 4)]
    now, prev = (UserState(User(1), cards, catalog, params) for _ in range(2))
    for s, ym in ((now, "2026-10"), (prev, "2026-09")):
        s.roll_to(ym)
    r = next(r for r in card_rows(now, prev, catalog) if r["user_card_id"] == 104)
    assert all(r["this_month"][k] is None for k in ("tier_min", "remaining_to_keep", "next_tier", "remaining_to_next"))
    assert r["prev_month"] == {"perf": 0, "benefit": 0, "payments": 0, "first_tier": None, "tier_reached": None,
                               "achieved": None, "short_of_first": None}
