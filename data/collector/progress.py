"""진행 표시.

- 항목 하나가 끝날 때마다 한 줄: [fetch] KB  12/41 ( 29%) · 성공 11 · 실패 1 · 경과 1:02 · 남은 예상 2:35 · 01142 The CJ
- 같은 내용을 cache/crawl/progress.json 에도 써서, 다른 터미널에서 `python -m collector status` 로 볼 수 있다.
- 오래 걸리는 대기(AI 응답 등)는 waiting() 으로 감싸면 30초마다 '대기 중' 줄을 찍는다.
"""

import json
import threading
import time
from contextlib import contextmanager

from .web import CRAWL, now

PROGRESS_FILE = CRAWL / "progress.json"


def _fmt(sec: float) -> str:
    sec = int(sec)
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


class Progress:
    def __init__(self, step: str, issuer: str, total: int, every: int = 1):
        """every: 몇 개마다 한 줄 찍을지 (실패와 마지막 항목은 항상 찍는다)."""
        self.step, self.issuer, self.total, self.every = step, issuer, total, every
        self.done = self.ok = self.fail = self.skip = 0
        self.t0 = time.monotonic()
        self._write(current=None)

    def tick(self, label: str = "", ok: bool = True, skipped: bool = False) -> None:
        self.done += 1
        if skipped:
            self.skip += 1
        elif ok:
            self.ok += 1
        else:
            self.fail += 1
        self._write(current=label)
        if ok and self.done % self.every and self.done != self.total:
            return
        elapsed = time.monotonic() - self.t0
        eta = elapsed / self.done * (self.total - self.done) if self.done else 0
        pct = self.done / self.total * 100 if self.total else 100
        parts = [f"[{self.step}] {self.issuer:8} {self.done:>4}/{self.total:<4} ({pct:3.0f}%)",
                 f"성공 {self.ok}", f"실패 {self.fail}"]
        if self.skip:
            parts.append(f"건너뜀 {self.skip}")
        parts += [f"경과 {_fmt(elapsed)}", f"남은 예상 {_fmt(eta)}"]
        if label:
            parts.append(label[:40])
        print(" · ".join(parts), flush=True)

    def finish(self) -> None:
        print(f"[{self.step}] {self.issuer:8} 끝 · 성공 {self.ok} · 실패 {self.fail}"
              + (f" · 건너뜀 {self.skip}" if self.skip else "")
              + f" · 걸린 시간 {_fmt(time.monotonic() - self.t0)}", flush=True)
        self._write(current=None, finished=True)

    def _write(self, **extra) -> None:
        PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROGRESS_FILE.write_text(json.dumps({
            "updated_at": now(), "step": self.step, "issuer": self.issuer, "done": self.done, "total": self.total,
            "ok": self.ok, "fail": self.fail, "skip": self.skip,
            "elapsed_sec": round(time.monotonic() - self.t0), **extra,
        }, ensure_ascii=False, indent=1), encoding="utf-8")


@contextmanager
def waiting(what: str, every_sec: int = 30):
    """블록이 끝날 때까지 every_sec 마다 '대기 중' 줄을 찍는다."""
    stop = threading.Event()
    t0 = time.monotonic()

    def beat():
        while not stop.wait(every_sec):
            print(f"      … {what} 대기 중 {_fmt(time.monotonic() - t0)}", flush=True)

    th = threading.Thread(target=beat, daemon=True)
    th.start()
    try:
        yield
    finally:
        stop.set()
        th.join(timeout=1)


def status() -> None:
    if not PROGRESS_FILE.exists():
        print("진행 기록이 없습니다.")
        return
    p = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    state = "끝남" if p.get("finished") else "진행 중"
    print(f"{p['updated_at']} 기준 · [{p['step']}] {p['issuer']} {p['done']}/{p['total']} · 성공 {p['ok']} · "
          f"실패 {p['fail']} · 경과 {_fmt(p['elapsed_sec'])} · {state}"
          + (f" · 지금: {p['current']}" if p.get("current") else ""))
