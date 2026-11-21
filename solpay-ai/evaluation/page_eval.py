"""맞춤 추천 페이지를 실제 OpenAI 문구로 만들어 본다 (설계서 2026-11-19-recommendation-page-design.md 11절).

    uv run python -m evaluation.page_eval [--at 2026-11-05T08:00:00+09:00]

시연 사용자 1~5 마다 (a) 일정 없음(평소 소비) (b) 12:00~13:00 음식점 13,000원 + 15:00~16:00 카페 5,000원 두 경우.
개인 DB 에 추천 기록을 남기지 않도록 기본 저장소는 teamdb(CSV, 기록은 메모리)다. 결과는 artifacts/reports/page_copy_eval.json.
"""

import argparse
import json
import os
import statistics
from datetime import datetime, time

from engine.loader import ARTIFACTS

SCHEDULE = [{"start": time(12), "end": time(13), "category": "RESTAURANT", "amount": 13_000},
            {"start": time(15), "end": time(16), "category": "CAFE", "amount": 5_000}]


def _summary(page: dict) -> str:
    card = page.get("card")
    offers = (page.get("merchant") or {}).get("offers", [])
    parts = [f"탭 {page['tabs'] or '없음(건너뜀)'}", f"카드날 {page['card_day']}", f"기준 {page['source']}"]
    if card:
        year = (f"지난 {card['yearly_months']}개월 {card['yearly_gain']:,}원"
                + (f" · {card['replaces']} 대신" if card.get("replaces") else "")) if card.get("yearly_gain") is not None else "1년 계산 없음"
        parts.append(f"카드 {card['card_name']} [{card['keyword']}] 오늘 +{card['gain']:,}원 | {year} (연회비 {card['annual_fee']:,}원)")
    parts += [f"행사 {o['brand']} {o['total']:,}원" for o in offers]
    return " | ".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", default="2026-11-05T08:00:00+09:00")
    args = parser.parse_args()
    # 셸에 SOLPAY_STORE=db 가 있어도 개인 DB 를 쓰지 않는다 (추천 기록을 남기거나 app 표를 지우지 않게).
    # teamdb 는 기록을 메모리에만 두고 실행마다 비어 있어 초기화도 필요 없다.
    os.environ["SOLPAY_STORE"] = "teamdb"
    import engine.api
    from engine.chat.agent import openai_client
    from engine.chat.page_copy import CopySettings, PageCopyWriter

    svc = engine.api.build_service()
    client = openai_client()
    if client is None:
        print("OPENAI_API_KEY 가 없어 정해진 문구만 확인합니다.")
    writer = PageCopyWriter(client, CopySettings.from_env())
    at = datetime.fromisoformat(args.at)
    rows = []
    for user_id in range(1, 6):
        for name, items in (("일정 없음", []), ("점심·카페 일정", SCHEDULE)):
            svc.put_schedule(user_id, at.date(), items, at)
            page = svc.recommendation_page(user_id, at, writer)
            log = page["copy_log"]
            print(f"\n=== test{user_id} · {name} · 문구 {page['copy_source']} ({log.get('ms', 0)}ms"
                  f"{', 다시 씀' if log.get('retries') else ''}{', ' + log['reason'] if log.get('reason') else ''})")
            print(_summary(page))
            for problem in log.get("problems", []):
                print(f"  검사: {problem}")
            if page.get("card"):
                print(json.dumps(page["card"]["copy"], ensure_ascii=False, indent=1))
            if page.get("merchant"):
                m = page["merchant"]
                print(json.dumps({**m["copy"], "offers": [o["copy"] for o in m["offers"]]}, ensure_ascii=False, indent=1))
            rows.append({"user_id": user_id, "case": name, "page": page})
    llm = [r for r in rows if r["page"]["copy_source"] == "llm"]
    shown = [r for r in rows if r["page"]["tabs"]]
    ms = [r["page"]["copy_log"].get("ms", 0) for r in rows if r["page"]["tabs"]]
    print(f"\n페이지가 뜬 사례 {len(shown)}/{len(rows)}, OpenAI 문구 통과 {len(llm)}/{len(shown)}, "
          f"다시 쓴 사례 {sum(1 for r in rows if r['page']['copy_log'].get('retries'))}"
          + (f", 시간 중앙값 {statistics.median(ms) / 1000:.1f}초·최대 {max(ms) / 1000:.1f}초" if ms else ""))
    out = ARTIFACTS / "reports" / "page_copy_eval.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"at": args.at, "rows": rows}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
