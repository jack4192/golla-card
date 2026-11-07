"""기준값 후보를 8~9월로 비교하고 10월로 확인한다. 설정을 자동으로 바꾸지는 않는다.

    uv run python -m training.tune
"""

import itertools

import pandas as pd

from engine.loader import ARTIFACTS
from engine.params import Params
from evaluation.replay import ReplayConfig, prepare, run, summarize

GRID = {
    "switch_threshold": (200, 300, 500),
    "two_card_loss": (200, 300, 500),
    "repeat_min_share": (0.4, 0.5, 0.6),
}
MAX_SWAP, MAX_TWO = 25.0, 20.0      # 평가 목표


def evaluate(params: Params, start: str, until: str) -> dict:
    results = run(ReplayConfig(start=start, until=until, params=params))
    return summarize(results)


def main() -> None:
    prepare()
    rows = []
    for values in itertools.product(*GRID.values()):
        changes = dict(zip(GRID, values))
        s = evaluate(Params().with_(**changes), "2026-08", "2026-10")
        rows.append({**changes, **{k: s[k] for k in ("혜택률", "교체", "2장 표시", "실적 충족")}})
        print(rows[-1])
    table = pd.DataFrame(rows)
    allowed = table[(table.교체 <= MAX_SWAP) & (table["2장 표시"] <= MAX_TWO)]
    best = allowed.sort_values(["혜택률", "실적 충족"], ascending=False).iloc[0]
    changes = {k: best[k].item() for k in GRID}
    changes = {"switch_threshold": int(changes["switch_threshold"]), "two_card_loss": int(changes["two_card_loss"]),
               "repeat_min_share": float(changes["repeat_min_share"])}
    print("\n8~9월 기준 가장 좋은 조합:", changes)
    for label, params in (("선택 조합", Params().with_(**changes)), ("현재 설정", Params())):
        print(f"10월 확인 · {label}:", evaluate(params, "2026-10", "2026-11"))
    path = ARTIFACTS / "reports" / "tune.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(path, index=False, encoding="utf-8-sig")
    print(f"저장: {path}")


if __name__ == "__main__":
    main()
