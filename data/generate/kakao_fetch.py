"""카카오 로컬 API로 구역별 실제 가맹점 위치를 받아 캐시에 저장한다.

실행:  uv run python -m generate.kakao_fetch
필요:  data/.env 에 KAKAO_REST_API_KEY=...  (Kakao Developers에서 직접 발급, 깃에 올리지 않음)
결과:  data/cache/kakao_places.csv
       카카오 이용약관에서 저장·재배포 조건을 확인하기 전까지 깃에 올리지 않는다.

여기서는 후보를 넉넉히 모으기만 하고, 구역별 업종 수(per_zone_quota)에 맞춰 뽑는 건
merchants 단계가 시드 고정 난수로 한다. 반경을 넓힌 검색은 한 가게가 여러 동네 후보에 들어갈 수 있다.
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from .common import CACHE_DIR, load_config, load_env

API = "https://dapi.kakao.com/v2/local/search"
PAGE_SIZE = 15
MAX_PAGES = 3  # 카카오는 한 검색어에 최대 45건까지 준다
FIELDS = [
    "zone_code", "category_code", "kakao_id", "place_name", "category_name",
    "address_name", "road_address_name", "lat", "lng", "distance_m", "place_url",
]


def _get(path: str, params: dict, key: str) -> dict:
    url = f"{API}/{path}.json?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Authorization": f"KakaoAK {key}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 2:  # 쿼터 초과: 잠시 쉬고 다시
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("unreachable")


def _search(source: dict, zone: dict, key: str) -> list[dict]:
    base = {
        "x": zone["lng"], "y": zone["lat"], "radius": source.get("radius_m", zone["radius_m"]),
        "size": PAGE_SIZE, "sort": "distance",
    }
    if "group" in source:
        path, base["category_group_code"] = "category", source["group"]
    else:
        path, base["query"] = "keyword", source["keyword"]

    docs = []
    for page in range(1, MAX_PAGES + 1):
        data = _get(path, {**base, "page": page}, key)
        docs.extend(data["documents"])
        if data["meta"]["is_end"]:
            break
        time.sleep(0.1)
    return docs


def _keep(doc: dict, source: dict) -> bool:
    cat = doc.get("category_name", "")
    if source.get("include") and not any(s in cat for s in source["include"]):
        return False
    if any(s in cat for s in source.get("exclude", [])):
        return False
    if "keyword" in source and source["keyword"].replace(" ", "") not in doc["place_name"].replace(" ", ""):
        return False
    return True


def main() -> None:
    load_env()
    key = os.environ.get("KAKAO_REST_API_KEY")
    if not key:
        sys.exit("KAKAO_REST_API_KEY가 없습니다. data/.env 에 넣어 주세요 (.env.example 참고).")

    zones = load_config("zones")["zones"]
    sources = load_config("places")["kakao_sources"]

    rows, seen = [], set()
    for zone in zones:
        for category_code, srcs in sources.items():
            n_before = len(rows)
            for source in srcs:
                for doc in _search(source, zone, key):
                    uid = (zone["code"], doc["id"])   # 같은 동네 안에서는 먼저 잡힌 업종 하나로만
                    if uid in seen or not _keep(doc, source):
                        continue
                    seen.add(uid)
                    rows.append({
                        "zone_code": zone["code"],
                        "category_code": category_code,
                        "kakao_id": doc["id"],
                        "place_name": doc["place_name"],
                        "category_name": doc.get("category_name", ""),
                        "address_name": doc.get("address_name", ""),
                        "road_address_name": doc.get("road_address_name", ""),
                        "lat": doc["y"],
                        "lng": doc["x"],
                        "distance_m": doc.get("distance", ""),
                        "place_url": doc.get("place_url", ""),
                    })
            print(f"{zone['code']:<14} {category_code:<9} {len(rows) - n_before:>3}건")

    CACHE_DIR.mkdir(exist_ok=True)
    out = CACHE_DIR / "kakao_places.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"\n{len(rows)}건 저장 → {out}")


if __name__ == "__main__":
    main()
