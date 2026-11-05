"""요청 공통 부분: robots.txt 확인, 사이트별 간격, 정적 요청과 브라우저 렌더링, 근거 기록.

근거(evidence.jsonl)에는 주소·시각·방식·상태·크기·SHA-256 만 남기고 원문은 cache/ 밖으로 내보내지 않는다.
"""

import hashlib
import json
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from generate.common import CACHE_DIR

CRAWL = CACHE_DIR / "crawl"
KST = ZoneInfo("Asia/Seoul")

# 렌더링할 때 화면 텍스트와 상관없는 자원은 받지 않는다
SKIP_RESOURCES = {"image", "media", "font"}


class Blocked(Exception):
    """robots.txt 가 허용하지 않는 주소."""


def now() -> str:
    return datetime.now(KST).isoformat(timespec="seconds")


class Web:
    def __init__(self, user_agent: str, delay_sec: float):
        self.ua = user_agent
        self.delay = delay_sec
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._last: dict[str, float] = {}
        self._pw = self._browser = None
        CRAWL.mkdir(parents=True, exist_ok=True)
        self._evidence = open(CRAWL / "evidence.jsonl", "a", encoding="utf-8")

    # ---------- robots.txt ----------
    def allowed(self, url: str) -> bool:
        s = urlsplit(url)
        base = f"{s.scheme}://{s.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser(base + "/robots.txt")
            try:
                self._wait(s.netloc)
                rp.read()               # 401·403 이면 전부 불허, 그 밖의 4xx 면 전부 허용 (파이썬 표준 동작)
            except Exception:
                rp = None               # 응답이 없으면 허용 여부를 알 수 없으므로 막는다
            self._robots[base] = rp
        rp = self._robots[base]
        return rp is not None and rp.can_fetch(self.ua, url)

    # ---------- 공통 ----------
    def _wait(self, host: str) -> None:
        gap = time.monotonic() - self._last.get(host, 0)
        if gap < self.delay:
            time.sleep(self.delay - gap)
        self._last[host] = time.monotonic()

    def _record(self, **kw) -> None:
        self._evidence.write(json.dumps({"at": now(), **kw}, ensure_ascii=False) + "\n")
        self._evidence.flush()

    # ---------- 정적 요청 ----------
    def get(self, url: str, timeout: float = 30) -> str:
        if not self.allowed(url):
            self._record(url=url, method="static", result="robots_blocked")
            raise Blocked(url)
        self._wait(urlsplit(url).netloc)
        req = urllib.request.Request(url, headers={"User-Agent": self.ua, "Accept-Language": "ko-KR,ko"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                text = raw.decode(r.headers.get_content_charset() or "utf-8", "replace")
                self._record(url=url, method="static", result="ok", status=r.status, bytes=len(raw),
                             sha256=hashlib.sha256(raw).hexdigest())
                return text
        except (urllib.error.URLError, TimeoutError) as e:
            self._record(url=url, method="static", result="error", error=f"{type(e).__name__}: {e}"[:200])
            raise

    # ---------- 브라우저 렌더링 ----------
    def render(self, url: str, domains: list[str], js: str | None = None, timeout_ms: int = 45_000) -> tuple[str, str]:
        """(렌더링된 HTML, js 실행 결과). 카드사 도메인 밖의 요청과 robots.txt 가 막은 요청은 브라우저 안에서 차단한다."""
        if not self.allowed(url):
            self._record(url=url, method="render", result="robots_blocked")
            raise Blocked(url)
        if self._browser is None:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch()

        blocked: list[str] = []

        def route(r):
            req = r.request
            host = urlsplit(req.url).hostname or ""
            if req.resource_type in SKIP_RESOURCES:
                return r.abort()
            if not any(host == d or host.endswith("." + d) for d in domains):
                return r.abort()
            if req.url != url and not self.allowed(req.url):
                blocked.append(req.url)
                return r.abort()
            return r.continue_()

        self._wait(urlsplit(url).netloc)
        ctx = self._browser.new_context(user_agent=self.ua, locale="ko-KR")
        page = ctx.new_page()
        page.route("**/*", route)
        try:
            resp = page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            html = page.content()
            out = page.evaluate(js) if js else ""
            raw = html.encode("utf-8")
            self._record(url=url, method="render", result="ok", status=resp.status if resp else None,
                         bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                         robots_blocked_subrequests=len(blocked))
            return html, out
        except Exception as e:
            self._record(url=url, method="render", result="error", error=f"{type(e).__name__}: {e}"[:200])
            raise
        finally:
            ctx.close()

    def close(self) -> None:
        if self._browser is not None:
            self._browser.close()
            self._pw.stop()
        self._evidence.close()
