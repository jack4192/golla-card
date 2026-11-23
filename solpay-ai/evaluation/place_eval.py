"""일정 '직접 입력' 업종·가맹점 분류 정확도 (2026-11-23 설계서).

정답을 단 60개 표현(브랜드 20·별칭/약칭 10·오타 10·일반 말 15·애매/모름 5)을 분류해
업종 정확도, 브랜드 정확도, 틀린 브랜드를 붙인 수(목표 0), 출처(검색/AI/없음) 비율, 응답 시간을 잰다.
OpenAI 를 실제로 부른다 (OPENAI_API_KEY 필요, 표현마다 비용). --no-llm 이면 검색만.

    uv run python -m evaluation.place_eval
    uv run python -m evaluation.place_eval --no-llm
"""

import argparse
import json
import os
import statistics

# (표현, 맞는 업종들(빈 튜플 = 정하지 말아야 함), 맞는 브랜드 또는 None)
CASES = [
    # 브랜드 20
    ("스타벅스", ("CAFE",), "스타벅스"), ("투썸플레이스", ("CAFE",), "투썸플레이스"), ("이디야", ("CAFE",), "이디야"),
    ("올리브영", ("HNB",), "올리브영"), ("다이소", ("GENERAL_GOODS",), "다이소"), ("이마트", ("MART",), "이마트"),
    ("홈플러스", ("MART",), "홈플러스"), ("롯데마트", ("MART",), "롯데마트"), ("GS25", ("CONVENIENCE",), "GS25"),
    ("CU", ("CONVENIENCE",), "CU"), ("세븐일레븐", ("CONVENIENCE",), "세븐일레븐"),
    ("신세계백화점", ("DEPARTMENT_STORE",), "신세계백화점"), ("현대백화점", ("DEPARTMENT_STORE",), "현대백화점"),
    ("맥도날드", ("FAST_FOOD",), "맥도날드"), ("버거킹", ("FAST_FOOD",), "버거킹"), ("파리바게뜨", ("BAKERY",), "파리바게뜨"),
    ("CGV", ("MOVIE",), "CGV"), ("메가박스", ("MOVIE",), "메가박스"), ("교보문고", ("BOOKSTORE",), "교보문고"),
    ("아웃백", ("RESTAURANT",), "아웃백"),
    # 별칭·약칭 10 (카탈로그 별칭에 없는 것 포함: 올영·투썸·맥날·파바)
    ("스벅", ("CAFE",), "스타벅스"), ("메가커피", ("CAFE",), "메가MGC커피"), ("할리스", ("CAFE",), "할리스커피"),
    ("빕스", ("RESTAURANT",), "VIPS"), ("갤러리아", ("DEPARTMENT_STORE",), "갤러리아백화점"),
    ("하나로마트", ("MART",), "농협 하나로마트"), ("올영", ("HNB",), "올리브영"), ("투썸", ("CAFE",), "투썸플레이스"),
    ("맥날", ("FAST_FOOD",), "맥도날드"), ("파바", ("BAKERY",), "파리바게뜨"),
    # 오타 10
    ("스타벅쓰", ("CAFE",), "스타벅스"), ("올리브엉", ("HNB",), "올리브영"), ("이디아", ("CAFE",), "이디야"),
    ("홈플러쓰", ("MART",), "홈플러스"), ("맥도널드", ("FAST_FOOD",), "맥도날드"), ("롯대마트", ("MART",), "롯데마트"),
    ("다이쏘", ("GENERAL_GOODS",), "다이소"), ("신세게백화점", ("DEPARTMENT_STORE",), "신세계백화점"),
    ("버거낑", ("FAST_FOOD",), "버거킹"), ("메가박쓰", ("MOVIE",), "메가박스"),
    # 일반 말 15
    ("헬스장", ("FITNESS",), None), ("친구랑 저녁", ("RESTAURANT",), None), ("회식", ("RESTAURANT",), None),
    ("병원 진료", ("HOSPITAL",), None), ("주유", ("FUEL",), None), ("영화 보기", ("MOVIE",), None),
    ("장보기", ("MART", "SUPERMARKET"), None), ("약 사기", ("PHARMACY",), None), ("미용실", ("BEAUTY_SALON",), None),
    ("안경 맞추기", ("EYEWEAR",), None), ("동물병원", ("PET",), None), ("골프 연습", ("GOLF",), None),
    ("전기차 충전", ("EV_CHARGING",), None), ("택시", ("TAXI",), None), ("커피 한 잔", ("CAFE",), None),
    # 애매·모름 5 (업종도 브랜드도 정하지 말아야 함)
    ("GS", (), None), ("산책", (), None), ("집", (), None), ("약속", (), None), ("쇼핑", (), None),
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--no-llm", action="store_true", help="OpenAI 없이 검색만")
    args = parser.parse_args()
    # 공용 DB 를 건드리지 않게 팀 DB CSV 저장소로 고정한다 (셸에 SOLPAY_STORE=db 가 있어도 덮어쓴다)
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_DATABASE_URL"] = ""
    from engine.api import build_service
    from engine.chat.agent import openai_client
    from engine.chat.place_llm import PlaceLLM
    from engine.loader import ARTIFACTS

    svc = build_service()
    client = None if args.no_llm else openai_client()
    if client is None and not args.no_llm:
        print("OPENAI_API_KEY 가 없어 검색만으로 돕니다")
    llm = PlaceLLM(client)
    svc.place_cache.clear()
    rows = []
    for text, cats, brand in CASES:
        r = svc.classify_place(text, llm=llm)
        cat_ok = (r["category"] in cats) if cats else r["category"] is None
        brand_ok = r["brand"] == brand
        wrong_brand = r["brand"] is not None and r["brand"] != brand
        rows.append({"text": text, "expect_categories": list(cats), "expect_brand": brand, "category": r["category"],
                     "brand": r["brand"], "source": r["source"], "candidates": len(r["candidates"]), "ms": r["ms"],
                     "category_ok": cat_ok, "brand_ok": brand_ok, "wrong_brand": wrong_brand})
    n = len(rows)
    sources = {s: sum(1 for x in rows if x["source"] == s) for s in ("search", "llm", "none")}
    llm_ms = [x["ms"] for x in rows if x["source"] == "llm"] or [0]
    summary = {"cases": n, "category_accuracy": round(sum(x["category_ok"] for x in rows) / n, 3),
               "brand_accuracy": round(sum(x["brand_ok"] for x in rows) / n, 3),
               "wrong_brand": sum(x["wrong_brand"] for x in rows), "sources": sources,
               "ms_median": statistics.median(x["ms"] for x in rows), "ms_max": max(x["ms"] for x in rows),
               "llm_ms_median": statistics.median(llm_ms), "llm": not args.no_llm and client is not None}
    for x in rows:
        if not (x["category_ok"] and x["brand_ok"]):
            print(f"  ✗ {x['text']:<10} 업종 {x['category']} (정답 {x['expect_categories'] or '없음'}) "
                  f"브랜드 {x['brand']} (정답 {x['expect_brand']}) · {x['source']}")
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    path = ARTIFACTS / "reports" / ("place_eval.json" if summary["llm"] else "place_eval_search.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"summary": summary, "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"저장: {path}")


if __name__ == "__main__":
    main()
