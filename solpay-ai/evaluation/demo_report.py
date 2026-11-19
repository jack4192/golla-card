"""데모 사용자 한 명의 결과를 표로 보여 주고 결제별 CSV 를 저장한다.

    uv run python -m evaluation.demo_report --user 1
"""

import argparse

import pandas as pd

from engine.loader import ARTIFACTS
from engine.slots import BAND_NAMES, band_of
from evaluation.replay import Data, ReplayConfig, prepare, replay_user

DAYS = "월화수목금토일"


def short(user_card_id: int) -> str:
    card_id = next(c.card_id for rows in Data.cards.values() for c in rows if c.user_card_id == user_card_id)
    return Data.catalog.card_label(card_id)


def monthly(result: dict) -> pd.DataFrame:
    rows = []
    for ym, snap in result["months"].items():
        if ym < "2026-01":
            continue
        rows.append({"월": ym, "알고리즘": sum(v[2] for v in snap["algo"].values()),
                     "습관": sum(v[2] for v in snap["habit"].values())})
    return pd.DataFrame(rows)


def performance(result: dict) -> pd.DataFrame:
    rows = []
    card_ids = {c.user_card_id: c.card_id for c in Data.cards[result["user_id"]]}
    for ym, snap in result["months"].items():
        if ym < "2026-01" or ym > "2026-10":
            continue
        for uc, (_, perf, benefit) in snap["algo"].items():
            tiers = Data.catalog.tiers[card_ids[uc]]
            habit = snap["habit"][uc][1]
            first = tiers[0] if tiers else None
            rows.append({"월": ym, "카드": short(uc), "구간": "/".join(f"{t // 10000}만" for t in tiers) or "없음",
                         "실적": perf, "달성": "-" if first is None else ("O" if perf >= first else "X"),
                         "습관 실적": habit, "습관 달성": "-" if first is None else ("O" if habit >= first else "X")})
    return pd.DataFrame(rows)


def schedule(rows: list[dict]) -> pd.DataFrame:
    data = [{"시간대": BAND_NAMES[band_of(r["payment"].paid_at.hour)], "요일": DAYS[r["payment"].paid_at.weekday()],
             "카드": short(r["result"].cards[0].user_card_id)} for r in rows]
    frame = pd.DataFrame(data)
    def cell(s):
        counts = s.value_counts()
        return f"{counts.index[0]} {counts.iloc[0]}/{len(s)}"
    table = frame.groupby(["시간대", "요일"]).카드.agg(cell).unstack()
    return table.reindex(index=[b for b in BAND_NAMES if b in set(frame.시간대)], columns=list(DAYS)).fillna("-")


def payment_rows(rows: list[dict]) -> pd.DataFrame:
    out = []
    for r in rows:
        p, res = r["payment"], r["result"]
        shown = res.cards[:res.display_count]
        reasons = {None: "기본 카드 유지", "benefit": "즉시 혜택 교체", "performance": "실적 교체"}
        decision = reasons[res.swap_reason] + (" + 반복 구간" if res.repeat_applied else "") + \
            (" + 2장 표시" if res.display_count > 1 else "")
        merchant = Data.catalog.merchants.get(p.merchant_id)
        out.append({
            "일시": p.paid_at.strftime("%Y-%m-%d %H:%M"), "요일": DAYS[p.paid_at.weekday()],
            "가맹점": merchant.name if merchant else "", "업종": Data.catalog.category_name(p.category), "금액": p.amount,
            "결제 경로": p.card_select_mode, "시나리오": res.scenario_mode,
            "예측 1위 업종": Data.catalog.category_name(res.top_category) if res.top_category else "",
            "예측 적중": "Y" if res.top_category == p.category else "N",
            "기본 카드": short(res.base_card), "1순위": short(shown[0].user_card_id),
            "2순위": short(shown[1].user_card_id) if len(shown) > 1 else "", "사용 카드": short(r["chosen"]),
            "습관 카드": short(p.user_card_id), "판단": decision, "문구": shown[0].message,
            "받은 혜택": r["got"], "습관 혜택": r["habit_got"], "차이": r["got"] - r["habit_got"], "결제별 최대": r["best"],
            "프로모션": next((s["promotion_label"] for s in res.card_scores.values() if s.get("promotion_label")), ""),
        })
    return pd.DataFrame(out)


def report(user_id: int, label: str, cfg: ReplayConfig) -> None:
    result = replay_user(user_id, cfg)
    print(f"\n===== 사용자 {user_id} · {label} =====")
    print(f"혜택 {result['benefit']:,}원 (습관 {result['habit']:,}원), 결제 {result['spend']:,}원, "
          f"혜택률 {result['benefit'] / result['spend'] * 100:.2f}% (습관 {result['habit'] / result['spend'] * 100:.2f}%)")
    print(f"배치 {result['events']}건, 교체 {result['swaps']}건, 2장 {result['two']}건, 반복 구간 {result['repeat']}건, "
          f"기본 카드 변경 {result['base_changes']}회")
    print("\n[월별 혜택]\n" + monthly(result).to_string(index=False))
    print("\n[실적 달성]\n" + performance(result).to_string(index=False))
    print("\n[시간·요일별 1순위 카드 (횟수/전체)]\n" + schedule(result["rows"]).to_string())
    frame = payment_rows(result["rows"])
    print("\n[판단별 건수]\n" + frame.판단.value_counts().to_string())
    path = ARTIFACTS / "reports" / f"user{user_id}_{label.replace(' ', '_')}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"\n결제별 결과: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--user", type=int, default=1)
    args = parser.parse_args()
    pd.set_option("display.unicode.east_asian_width", True, "display.width", 200, "display.max_columns", 20)
    prepare()
    report(args.user, "일정 없음", ReplayConfig(keep_rows=True))
    report(args.user, "일정 입력 가정", ReplayConfig(keep_rows=True, schedule=True))


if __name__ == "__main__":
    main()
