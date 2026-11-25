"""최종 카드 DB 로 옮기며 빠졌던 혜택 6줄 되살리기 (2026-11-23 팀 결정, 설계서 2026-11-23-recommend-fixes-design.md).

옛 22장 데이터(config/real_cards)에는 있었고 새 DB 에 업종이 있는 혜택만 되살린다. 값은 설계서 표의 가정을 따른다.
"""

import csv
from pathlib import Path

CARD_DB = Path(__file__).resolve().parents[1] / "config" / "card_db"


def rows(name: str) -> list[dict]:
    with open(CARD_DB / name, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def test_누락_혜택_6줄이_원본에_있다():
    b = {r["benefit_id"]: r for r in rows("benefits.csv")}
    # ① 나라사랑 CGV ② 나라사랑 테마파크 ③ Discount Plan 테마파크 ④ Discount Plan+ 테마파크 ⑤ SOL메이트 ⑥ SOL LINK
    assert [b[str(i)]["card_id"] for i in range(284, 290)] == ["11", "11", "1", "2", "13", "14"]
    assert b["284"]["value_type"] == "FIXED" and b["289"]["pay_type"] == "PAY"
    tiers = [t for t in rows("benefit_tiers.csv") if t["benefit_id"] == "284"]
    assert {t["tier_id"] for t in tiers} == {"34", "35", "36", "37", "38"} and {t["value"] for t in tiers} == {"5000"}
    assert {t["monthly_limit"] for t in rows("benefit_tiers.csv") if t["benefit_id"] == "288"} == {"2000"}
    targets = {(t["benefit_id"], t["category"], t["merchant_name"]) for t in rows("benefit_targets.csv")}
    assert ("284", "MOVIE", "CGV") in targets and ("288", "MEMBERSHIP", "쿠팡 로켓와우") in targets
    assert "14" not in {p["perk_id"] for p in rows("card_perks.csv")}       # 나라사랑 테마파크는 혜택으로 옮겼다


def test_테마파크는_월_1회_건당_3만원_한도_50퍼센트():
    tiers = [t for t in rows("benefit_tiers.csv") if t["benefit_id"] in ("285", "286", "287")]
    assert {(t["value"], t["monthly_count"], t["per_payment_limit"]) for t in tiers} == {("50", "1", "30000")}
    # 전월 30만원 조건은 바로 위 구간부터: 나라사랑 50만원(36~38), Discount Plan 40만원(2~4), Plan+ 40만원(6~10)
    assert {t["tier_id"] for t in tiers if t["benefit_id"] == "285"} == {"36", "37", "38"}
    assert {t["tier_id"] for t in tiers if t["benefit_id"] == "286"} == {"2", "3", "4"}
    assert {t["tier_id"] for t in tiers if t["benefit_id"] == "287"} == {"6", "7", "8", "9", "10"}


def test_새_번호가_겹치지_않는다():
    for name, key in (("benefits.csv", "benefit_id"), ("benefit_tiers.csv", "benefit_tier_id"), ("benefit_targets.csv", "target_id")):
        ids = [r[key] for r in rows(name)]
        assert len(ids) == len(set(ids)), name
    # 되살린 6줄은 카드 1~40 의 마지막 번호다. 2026-11-24 신한카드 4장(41~44, 혜택 290~)은 그 다음 번호부터 쓴다.
    old = lambda r: int(r["benefit_id"]) <= 289
    tiers, targets = rows("benefit_tiers.csv"), rows("benefit_targets.csv")
    assert max(int(r["benefit_tier_id"]) for r in tiers if old(r)) == 694
    assert max(int(r["target_id"]) for r in targets if old(r)) == 674
    assert min(int(r["benefit_tier_id"]) for r in tiers if not old(r)) == 695
    assert min(int(r["target_id"]) for r in targets if not old(r)) == 675
