"""② 가맹점.

카카오 수집 결과(data/cache/kakao_places.csv)가 있으면 그 안에서 구역·업종별 수만큼 뽑고,
없으면 구역 중심 주변에 가상 좌표로 만든다. 온라인·교통·자동이체 가맹점은 places.yml 목록으로 만든다.
평점은 두 경우 모두 가상이다.
"""

import math
import re

import numpy as np
import pandas as pd

from .common import CACHE_DIR, load_config
from .card_db import alias_table, brand_categories, brand_home_category, brand_of, normalize

# 가상 모드에서 브랜드 목록이 없는 종류의 가게 이름
GENERIC_NAMES = {
    "REST": ["한식당", "김밥", "국밥", "분식", "중식당", "일식당", "샐러드", "쌀국수", "백반집", "고깃집"],
    "MEDICAL": ["내과", "치과", "이비인후과", "정형외과", "약국", "피부과"],
    "EDU": ["영어학원", "수학학원", "피아노학원", "코딩학원", "미술학원"],
    "FUEL": ["주유소"],
    "STUDY": ["스터디카페", "독서실"],
    "STATIONERY": ["문구"],
    "HAIR": ["헤어살롱", "미용실"],
    "FITNESS": ["헬스", "필라테스"],
    "PARKING": ["공영주차장", "주차장"],
    "OPTICAL": ["안경원"],
}


def _normalize(name: str) -> str:
    return re.sub(r"[^0-9A-Za-z가-힣]", "", name)


def _split_brand(place_name: str, brands: list[str]) -> tuple[str, str]:
    compact = place_name.replace(" ", "")
    for b in sorted(brands, key=len, reverse=True):
        if compact.startswith(b.replace(" ", "")):
            rest = place_name[len(b):].strip() if place_name.startswith(b) else place_name.split(" ", 1)[-1]
            return b, rest
    return place_name, ""


def _rating(rng: np.random.Generator) -> float:
    return round(float(np.clip(rng.normal(4.1, 0.35), 2.5, 5.0)), 1)


def _from_kakao(rng, zones, places) -> tuple[list[dict], list[tuple[str, str]]]:
    """(가게 목록, (kakao_id, 동네) 목록). 반경이 넓은 업종은 한 가게가 여러 동네에서 뽑힐 수 있어서
    가게는 한 번만 만들고, 어느 동네에서 갈 수 있는지는 따로 돌려준다."""
    raw = pd.read_csv(CACHE_DIR / "kakao_places.csv", dtype={"kakao_id": str})
    # 한 가게가 여러 업종으로 잡혔으면 places.yml 에 먼저 적힌 업종 하나로
    order = {c: i for i, c in enumerate(places["kakao_sources"])}
    raw = raw.assign(_o=raw.category_code.map(order)).sort_values(["_o", "zone_code", "kakao_id"])
    raw = raw[raw.kakao_id.map(raw.drop_duplicates("kakao_id").set_index("kakao_id").category_code)
              == raw.category_code]

    picked: dict[str, dict] = {}
    links: list[tuple[str, str]] = []
    # 기본 종류를 먼저 다 뽑고, 새 카드 DB 혜택 브랜드를 위해 더 받은 종류(extra_zone_quota)는 뒤에 뽑는다
    # (기존 가맹점 선택이 바뀌지 않게). 더 받은 종류는 kind_fold 로 원래 종류에 합친다.
    plans = [(z, cat, quota) for z in zones for cat, quota in places["per_zone_quota"].items()]
    plans += [(z, cat, quota) for z in zones for cat, quota in places.get("extra_zone_quota", {}).items()]
    fold = places.get("kind_fold", {})
    for z, cat, quota in plans:
        cand = raw[(raw.zone_code == z["code"]) & (raw.category_code == cat)].sort_values("kakao_id")
        if cand.empty:
            continue
        pick = cand.iloc[sorted(rng.choice(len(cand), size=min(quota, len(cand)), replace=False))]
        for _, r in pick.iterrows():
            links.append((r.kakao_id, z["code"]))
            dist = float(r.distance_m) if pd.notna(r.distance_m) else 0.0
            prev = picked.get(r.kakao_id)
            if prev is not None and prev["_dist"] <= dist:
                continue
            kind = fold.get(cat, cat)
            brand, branch = _split_brand(r.place_name, places["known_brands"].get(kind, []))
            picked[r.kakao_id] = {
                "brand": brand, "branch_name": branch, "place_name": r.place_name,
                "kind": kind, "_kakao_category": r.category_name if isinstance(r.category_name, str) else "",
                "zone_code": z["code"], "lat": float(r.lat), "lng": float(r.lng),
                "address": r.road_address_name if isinstance(r.road_address_name, str) else r.address_name,
                "source": "kakao", "kakao_id": r.kakao_id, "_dist": dist,
            }
    rows = [{k: v for k, v in r.items() if k != "_dist"} for r in picked.values()]
    return rows, links


def _synthetic(rng, zones, places) -> list[dict]:
    rows = []
    for z in zones:
        m_per_deg_lat = 111_320
        m_per_deg_lng = 111_320 * math.cos(math.radians(z["lat"]))
        for cat, quota in places["per_zone_quota"].items():
            names = places["known_brands"].get(cat) or GENERIC_NAMES.get(cat, [cat])
            for k in range(quota):
                # 중심에서 멀수록 드물게 (반경의 절반을 표준편차로, 반경 1.3배 밖은 다시 뽑음)
                while True:
                    dx, dy = rng.normal(0, z["radius_m"] / 2, size=2)
                    if math.hypot(dx, dy) <= z["radius_m"] * 1.3:
                        break
                base = str(rng.choice(names))
                branch = f"{z['name']}{k + 1}호점"
                rows.append({
                    "brand": base, "branch_name": branch, "place_name": f"{base} {branch}",
                    "kind": cat, "zone_code": z["code"],
                    "lat": round(z["lat"] + dy / m_per_deg_lat, 6),
                    "lng": round(z["lng"] + dx / m_per_deg_lng, 6),
                    "address": None, "source": "synthetic", "kakao_id": None,
                })
    return rows


def _attach_brand_codes(df: pd.DataFrame, places: dict) -> None:
    """혜택 계산용 브랜드(최종 카드 DB의 정규화된 브랜드명).
    현장 가맹점은 새 DB가 그 브랜드를 다른 업종으로 두었으면 새 DB 업종을 따른다 (다이소 → 잡화, 써브웨이 → 그린푸드).
    온라인·자동이체 가맹점은 업종을 바꾸지 않고, 새 DB에서 그 업종의 브랜드일 때만 브랜드를 붙인다 (쿠팡와우는 쿠팡 쇼핑이 아니다)."""
    aliases = alias_table()
    cats, home = brand_categories(), brand_home_category()
    excluded = [normalize(n) for n in places.get("brand_exclude", [])]
    codes = []
    for i, r in df.iterrows():
        code = None if any(normalize(r.place_name).startswith(e) for e in excluded) else brand_of(r.place_name, aliases)
        cat = df.at[i, "category_code"]
        if code is not None and cat not in cats.get(code, {cat}):
            if r.is_online or r.kind in places.get("keep_category_kinds", []):
                code = None
            else:
                df.at[i, "category_code"] = home.get(code, cat)
        codes.append(code)
    df.insert(df.columns.get_loc("brand") + 1, "brand_code", codes)


def build_merchants(rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(merchants, merchant_zones). zone_code 는 가장 가까운 동네, merchant_zones 는 갈 수 있는 동네 전부."""
    zones = load_config("zones")["zones"]
    places = load_config("places")

    if (CACHE_DIR / "kakao_places.csv").exists():
        rows, links = _from_kakao(rng, zones, places)
    else:
        rows, links = _synthetic(rng, zones, places), None
    for r in rows:
        r.update(is_online=False, rating=_rating(rng))

    for kind, names in places["online"].items():
        for name in names:
            rows.append({
                "brand": name, "branch_name": "", "place_name": name, "kind": kind,
                "zone_code": None, "lat": None, "lng": None, "address": None,
                "source": "online", "kakao_id": None, "is_online": True, "rating": None,
            })

    df = pd.DataFrame(rows)
    df.insert(0, "merchant_id", range(1, len(df) + 1))
    df.insert(df.columns.get_loc("kind") + 1, "category_code", df.kind.map(places["kinds"]))
    # 카카오 분류로 업종을 나눈다 (병원 검색에 잡힌 약국 → PHARMACY)
    if "_kakao_category" in df.columns:
        for kind, rules in places.get("category_by_kakao", {}).items():
            for word, code in rules.items():
                hit = (df.kind == kind) & df._kakao_category.fillna("").str.contains(word)
                df.loc[hit, "category_code"] = code
        df = df.drop(columns=["_kakao_category"])
    _attach_brand_codes(df, places)
    df["normalized_name"] = df["place_name"].map(_normalize)
    df["is_demo_fixed"] = False

    off = df[~df.is_online]
    if links is None:
        mz = off[["merchant_id", "zone_code"]]
    else:
        id_of = dict(zip(off.kakao_id, off.merchant_id))
        mz = pd.DataFrame([{"merchant_id": id_of[k], "zone_code": z} for k, z in links]).drop_duplicates()
    mz = mz.sort_values(["zone_code", "merchant_id"]).reset_index(drop=True)
    return df, mz
