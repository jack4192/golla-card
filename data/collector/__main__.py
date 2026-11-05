"""카드사 공식 상품 페이지 수집기.

실행 (data/ 에서)
  uv run python -m collector discover            ① 상품 상세 주소 찾기
  uv run python -m collector fetch               ② 원문 수집 (이미 받은 카드는 건너뜀)
  uv run python -m collector parse               ③ 규칙 파서 (카드명·종류·연회비·대표 혜택 문구)
  uv run python -m collector structure           ④ Gemini 구조화 (이미 된 카드는 건너뜀)
  uv run python -m collector load                ⑤ DB 적재
  uv run python -m collector report              카드사별 수집 결과 요약 → cache/crawl/report.json
  uv run python -m collector status              지금 어디까지 했는지 (다른 터미널에서 실행)
  uv run python -m collector all                 ①~⑤ 차례로

옵션
  --issuer KB --issuer HANA   카드사 지정 (기본: 제외되지 않은 전체)
  --limit 5                   카드사마다 앞에서 n장만 (시험용)
  --force                     이미 한 것도 다시
  --timeout 180               ④ Gemini 요청 하나의 제한 시간(초)
"""

import argparse
import json

from generate.common import load_config

from . import discover, fetch, load_db, parse, structure
from .progress import status
from .web import CRAWL, Web, now


def report(all_issuers: dict) -> None:
    rows = []
    for code, cfg in all_issuers.items():
        if cfg.get("exclude"):
            rows.append({"issuer": code, "status": "excluded", "note": cfg["exclude"]})
            continue

        def load(p):
            return json.loads(p.read_text(encoding="utf-8")) if p.exists() else []

        urls = load(CRAWL / "urls" / f"{code}.json")
        pages = load(CRAWL / "pages" / f"{code}.json")
        parsed = load(CRAWL / "parsed" / f"{code}.json")
        sdir = CRAWL / "structured" / code
        results = {}
        for p in pages:
            results[p["result"]] = results.get(p["result"], 0) + 1
        rows.append({
            "issuer": code, "status": "collected",
            "discovered": len(urls), "found_by": sorted({u["found_by"] for u in urls}),
            "fetch": results, "parsed": len(parsed),
            "named": sum(1 for x in parsed if x["card_name"]),
            "structured": len(list(sdir.glob("*.json"))) if sdir.exists() else 0,
        })
    out = {"generated_at": now(), "issuers": rows}
    (CRAWL / "report.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for r in rows:
        if r["status"] == "excluded":
            print(f"{r['issuer']:8} 제외 — {r['note']}")
        else:
            print(f"{r['issuer']:8} 주소 {r['discovered']:3} ({', '.join(r['found_by'])}) · 수집 {r['fetch']} · "
                  f"파싱 {r['parsed']} (카드명 {r['named']}) · 구조화 {r['structured']}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="collector")
    ap.add_argument("step", choices=["discover", "fetch", "parse", "structure", "load", "report", "status", "all"])
    ap.add_argument("--issuer", action="append")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--timeout", type=float, default=structure.REQUEST_TIMEOUT_SEC)
    a = ap.parse_args()
    if a.step == "status":
        status()
        return

    cfg = load_config("crawl")
    all_issuers = cfg["issuers"]
    targets = {k: v for k, v in all_issuers.items()
               if not v.get("exclude") and (not a.issuer or k in a.issuer)}
    steps = ["discover", "fetch", "parse", "structure", "load"] if a.step == "all" else [a.step]

    web = Web(cfg["user_agent"], cfg["delay_sec"]) if {"discover", "fetch"} & set(steps) else None
    try:
        for i, s in enumerate(steps, start=1):
            print(f"══ {s}" + (f" ({i}/{len(steps)})" if len(steps) > 1 else ""), flush=True)
            if s == "discover":
                discover.run(web, targets)
            elif s == "fetch":
                fetch.run(web, targets, a.force, a.limit)
            elif s == "parse":
                parse.run(targets)
            elif s == "structure":
                structure.run(targets, a.force, a.limit, a.timeout)
            elif s == "load":
                load_db.run(all_issuers)
            elif s == "report":
                report(all_issuers)
    finally:
        if web:
            web.close()


if __name__ == "__main__":
    main()
