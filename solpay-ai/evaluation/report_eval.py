"""월간 카드 리포트를 실제 OpenAI 문구로 만들어 본다 (설계서 2026-11-22-monthly-report-design.md 확인 방법).

    uv run python -m evaluation.report_eval [--at 2026-11-05T12:00:00+09:00]
    uv run python -m evaluation.report_eval --sample 60     # OpenAI 없이 사용자 1~60 의 효과 total 만

시연 사용자 1~5 의 리포트를 OpenAI 로 쓰고 문구 출처·다시 쓴 수·시간·요약 문장을 보인다.
저장소는 teamdb 로 강제한다 (공용 클라우드 DB 를 건드리지 않음). 결과는 artifacts/reports/report_copy_eval.json.
"""

import argparse
import json
import os
import statistics
from datetime import datetime

from engine.loader import ARTIFACTS


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--at", default="2026-11-05T12:00:00+09:00")
    parser.add_argument("--sample", type=int, default=0, help="사용자 1~N 의 효과 total 만 계산 (OpenAI 없음)")
    args = parser.parse_args()
    # 셸 설정과 상관없이 팀 CSV 저장소만 쓴다 (공용 DB 접속 방지)
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_DATABASE_URL"] = ""
    import engine.api

    svc = engine.api.build_service()
    at = datetime.fromisoformat(args.at)

    if args.sample:
        totals, none = [], 0
        for user_id in range(1, args.sample + 1):
            effect = svc.monthly_report(user_id, at, None)["solpay_effect"]
            if effect is None:
                none += 1
            else:
                totals.append(effect["diff"]["total"])
        print(f"사용자 1~{args.sample} ({args.at}) 지난달 SOL페이 효과 total")
        print(f"계산 {len(totals)}명 (효과 없음 {none}명), 중앙값 {statistics.median(totals):+,.0f}원, "
              f"음수 {sum(1 for t in totals if t < 0)}명, 최소 {min(totals):+,}원, 최대 {max(totals):+,}원")
        return

    from engine.chat.agent import openai_client
    from engine.chat.page_copy import CopySettings
    from engine.chat.report_copy import ReportCopyWriter

    client = openai_client()
    if client is None:
        print("OPENAI_API_KEY 가 없어 정해진 문구만 확인합니다.")
    writer = ReportCopyWriter(client, CopySettings.from_env(ReportCopyWriter.settings_env))
    rows = []
    for user_id in range(1, 6):
        report = svc.monthly_report(user_id, at, writer)
        log = report["copy_log"]
        effect = report["solpay_effect"]
        print(f"\n=== test{user_id} · 문구 {report['copy_source']} ({log.get('ms', 0)}ms, 다시 쓴 수 {log.get('retries', 0)}"
              f"{', ' + log['reason'] if log.get('reason') else ''}) · 효과 "
              + (f"{effect['diff']['total']:+,}원" if effect else f"없음({report['effect_note']})"))
        print(report["summary"]["headline"])
        for point in report["summary"]["points"]:
            print(f"  - {point}")
        for problem in log.get("problems", []):
            print(f"  검사: {problem}")
        rows.append({"user_id": user_id, "report": report})
    llm = [r for r in rows if r["report"]["copy_source"] == "llm"]
    ms = [r["report"]["copy_log"].get("ms", 0) for r in rows]
    print(f"\nOpenAI 문구 통과 {len(llm)}/{len(rows)}, 다시 쓴 사례 "
          f"{sum(1 for r in rows if r['report']['copy_log'].get('retries'))}, "
          f"시간 중앙값 {statistics.median(ms) / 1000:.1f}초·최대 {max(ms) / 1000:.1f}초")
    out = ARTIFACTS / "reports" / "report_copy_eval.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"at": args.at, "rows": rows}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
