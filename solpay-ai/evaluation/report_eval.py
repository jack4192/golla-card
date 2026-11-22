"""월간 카드 리포트를 실제 OpenAI 문구로 만들어 본다 (설계서 2026-11-22-monthly-report-design.md 확인 방법).

    uv run python -m evaluation.report_eval [--at 2026-11-05T12:00:00+09:00]
    uv run python -m evaluation.report_eval --sample 60     # OpenAI 없이 사용자 1~60 의 효과 total 만 (음수 사용자 번호 포함)
    uv run python -m evaluation.report_eval --users 19,23,28  # 그 사용자들만 OpenAI 로 (덜 받은 사용자 확인용)

시연 사용자 1~5(또는 --users)의 리포트를 OpenAI 로 쓰고 문구 출처·다시 쓴 수·시간·요약 문장을 보인다.
저장소는 teamdb 로 강제한다 (공용 클라우드 DB 를 건드리지 않음). 결과는 artifacts/reports/report_copy_eval.json (--users 면 report_copy_eval_users-….json).
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
    parser.add_argument("--users", default="1,2,3,4,5", help="OpenAI 로 문구를 쓸 사용자 번호 (쉼표로 구분)")
    args = parser.parse_args()
    users = [int(u) for u in args.users.split(",") if u.strip()]
    # 셸 설정과 상관없이 팀 CSV 저장소만 쓴다 (공용 DB 접속 방지)
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_DATABASE_URL"] = ""
    import engine.api

    svc = engine.api.build_service()
    at = datetime.fromisoformat(args.at)

    if args.sample:
        totals, none, negative = [], 0, []
        for user_id in range(1, args.sample + 1):
            effect = svc.monthly_report(user_id, at, None)["solpay_effect"]
            if effect is None:
                none += 1
            else:
                totals.append(effect["diff"]["total"])
                if effect["diff"]["total"] < 0:
                    negative.append((user_id, effect["diff"]["total"]))
        print(f"사용자 1~{args.sample} ({args.at}) 지난달 SOL페이 효과 total")
        print(f"계산 {len(totals)}명 (효과 없음 {none}명), 중앙값 {statistics.median(totals):+,.0f}원, "
              f"음수 {len(negative)}명, 최소 {min(totals):+,}원, 최대 {max(totals):+,}원")
        print("음수 사용자: " + (", ".join(f"{u}({t:+,}원)" for u, t in negative) or "없음"))
        return

    from engine.chat.agent import openai_client
    from engine.chat.page_copy import CopySettings
    from engine.chat.report_copy import ReportCopyWriter

    client = openai_client()
    if client is None:
        print("OPENAI_API_KEY 가 없어 정해진 문구만 확인합니다.")
    writer = ReportCopyWriter(client, CopySettings.from_env(ReportCopyWriter.settings_env))
    rows = []
    for user_id in users:
        report = svc.monthly_report(user_id, at, writer)
        log = report["copy_log"]
        effect = report["solpay_effect"]
        print(f"\n=== test{user_id} · 문구 {report['copy_source']} ({log.get('ms', 0)}ms, 다시 쓴 수 {log.get('retries', 0)}"
              f"{', ' + log['reason'] if log.get('reason') else ''}) · 효과 "
              + (f"{effect['diff']['total']:+,}원" if effect else f"없음({report['effect_note']})"))
        print(report["summary"]["headline"])
        for line in report["summary"]["effect"]:          # 엔진이 쓴 효과 문장
            print(f"  [엔진] {line}")
        for point in report["summary"]["points"]:
            print(f"  [{'AI' if report['copy_source'] == 'llm' else '정해진 문구'}] {point}")
        for problem in log.get("first_problems", []):
            print(f"  첫 답 검사: {problem}")
        for problem in log.get("problems", []):
            print(f"  검사: {problem}")
        rows.append({"user_id": user_id, "report": report})
    llm = [r for r in rows if r["report"]["copy_source"] == "llm"]
    ms = [r["report"]["copy_log"].get("ms", 0) for r in rows]
    print(f"\nOpenAI 문구 통과 {len(llm)}/{len(rows)}, 다시 쓴 사례 "
          f"{sum(1 for r in rows if r['report']['copy_log'].get('retries'))}, "
          f"시간 중앙값 {statistics.median(ms) / 1000:.1f}초·최대 {max(ms) / 1000:.1f}초")
    suffix = "" if users == [1, 2, 3, 4, 5] else "_users-" + "-".join(map(str, users))    # 시연 1~5 결과를 덮어쓰지 않게
    out = ARTIFACTS / "reports" / f"report_copy_eval{suffix}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"at": args.at, "users": users, "rows": rows}, ensure_ascii=False, indent=1, default=str),
                   encoding="utf-8")
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
