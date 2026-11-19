"""전체 사용자 분포를 만든다. 개인 이력이 적은 구간과 금액을 이 분포로 보정한다.

    uv run python -m training.build_priors --until 2026-11-06
"""

import argparse

import numpy as np
import pandas as pd

from engine.loader import ARTIFACTS, read_payments
from engine.params import Params
from engine.priors import Priors
from engine.slots import band_of, slot_key


def placement_mask(df: pd.DataFrame) -> pd.Series:
    return (df.card_select_mode == "app_selected") | ((df.card_select_mode == "manual") & (df.channel != "online"))


def priors_from_frame(df: pd.DataFrame, params: Params, built_until: str = "") -> Priors:
    place = df[placement_mask(df)]
    if place.empty:
        return Priors.empty()
    day = place.paid_at.dt.strftime("%Y-%m-%d")
    weekend = (place.paid_at.dt.day_of_week >= 5) | day.isin(params.holidays)
    band = place.paid_at.dt.hour.map(band_of)
    counts = place.groupby([weekend, band, place.category_code]).size()
    slot_counts: dict[str, dict[str, int]] = {}
    for (is_we, b, category), n in counts.items():
        slot_counts.setdefault(slot_key((bool(is_we), int(b))), {})[category] = int(n)
    amounts = {c: int(g.amount.median()) for c, g in place.groupby("category_code")}
    brands: dict[str, dict[str, int]] = {}
    if "brand_code" in place.columns:
        for (category, brand), n in place.fillna({"brand_code": ""}).groupby(["category_code", "brand_code"]).size().items():
            brands.setdefault(category, {})[brand] = int(n)
    return Priors(slot_counts, amounts, built_until, brands)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--until", default="2026-11-06", help="이 날짜 전 결제만 쓴다")
    args = parser.parse_args()
    df = read_payments()
    used = df[df.paid_at < pd.Timestamp(args.until, tz="Asia/Seoul")]
    priors = priors_from_frame(used, Params(), args.until)
    path = ARTIFACTS / "priors.json"
    priors.save(path)
    print(f"{path} 저장: 결제 {placement_mask(used).sum():,}건, 구간 {len(priors.slot_counts)}개, 업종 {len(priors.amounts)}개")


if __name__ == "__main__":
    main()
