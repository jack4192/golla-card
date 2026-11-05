"""② 상세 페이지 원문 수집.

결과: cache/crawl/raw/{ISSUER}/{id}.html   받은(또는 렌더링한) HTML 그대로
      cache/crawl/text/{ISSUER}/{id}.txt   혜택 영역 텍스트 (파서·AI 입력)
      cache/crawl/pages/{ISSUER}.json      카드별 수집 결과 (주소, 수집 시각, 해시, 성공/실패)
이미 받은 카드는 건너뛴다 (--force 면 다시).
"""

import hashlib
import json
import re

from bs4 import BeautifulSoup

from .progress import Progress
from .web import CRAWL, Blocked, Web, now

# 우리카드 혜택 탭: 접힌 내용까지 읽으려고 textContent 를 줄 단위로 정리해 쓴다
RENDER_JS = {
    "woori_benefit_tab": """() => {
      const c = document.querySelector('#content') || document.body;
      const clone = c.cloneNode(true);
      clone.querySelectorAll('script,style').forEach(e => e.remove());
      clone.querySelectorAll('br').forEach(b => b.replaceWith('\\n'));
      clone.querySelectorAll('p,li,div,tr,h1,h2,h3,h4,dt,dd').forEach(e => e.append('\\n'));
      return clone.textContent.replace(/[ \\t\\u00a0]+/g, ' ').replace(/\\n\\s*\\n+/g, '\\n');
    }""",
}
DROP = "script, style, noscript, header, footer, nav, #header, #footer, .gnb, #gnb, .lnb"


def content_text(html: str, selectors: list[str]) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.select(DROP):
        el.decompose()
    parts = []
    for sel in selectors:
        parts += [el.get_text("\n", strip=True) for el in soup.select(sel)]
    text = "\n\n".join(dict.fromkeys(p for p in parts if p))
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", text)).strip()


def fetch_issuer(web: Web, code: str, cfg: dict, force: bool = False, limit: int | None = None) -> list[dict]:
    urls = json.loads((CRAWL / "urls" / f"{code}.json").read_text(encoding="utf-8"))
    raw_dir, text_dir = CRAWL / "raw" / code, CRAWL / "text" / code
    raw_dir.mkdir(parents=True, exist_ok=True)
    text_dir.mkdir(parents=True, exist_ok=True)
    index_path = CRAWL / "pages" / f"{code}.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index = {r["id"]: r for r in json.loads(index_path.read_text(encoding="utf-8"))} if index_path.exists() else {}

    todo = [u for u in urls if force or index.get(u["id"], {}).get("result") != "ok"]
    if limit:
        todo = todo[:limit]
    if len(urls) > len(todo):
        print(f"[fetch] {code:8} 이미 받은 {len(urls) - len(todo)}장은 건너뜀 (다시 받으려면 --force)", flush=True)
    prog = Progress("fetch", code, len(todo))
    for u in todo:
        rec = {"id": u["id"], "url": u["url"], "found_by": u["found_by"], "retrieved_at": now()}
        try:
            if cfg.get("render"):
                html, js_out = web.render(u["url"], cfg["domains"], RENDER_JS.get(cfg.get("render_js")))
                text = js_out.strip() if js_out else content_text(html, cfg["content"])
            else:
                html = web.get(u["url"])
                text = content_text(html, cfg["content"])
            (raw_dir / f"{u['id']}.html").write_text(html, encoding="utf-8")
            (text_dir / f"{u['id']}.txt").write_text(text, encoding="utf-8")
            rec.update(result="ok" if len(text) >= 200 else "too_short", text_chars=len(text),
                       sha256=hashlib.sha256(html.encode("utf-8")).hexdigest())
        except Blocked:
            rec.update(result="robots_blocked")
        except Exception as e:
            rec.update(result="error", error=f"{type(e).__name__}: {e}"[:200])
        index[u["id"]] = rec
        index_path.write_text(json.dumps(list(index.values()), ensure_ascii=False, indent=1), encoding="utf-8")
        note = "" if rec["result"] == "ok" else f" ({rec['result']})"
        prog.tick(f"{u['id']}{note}", ok=rec["result"] == "ok")
    prog.finish()
    return list(index.values())


def run(web: Web, issuers: dict, force: bool = False, limit: int | None = None) -> None:
    for code, cfg in issuers.items():
        if not (CRAWL / "urls" / f"{code}.json").exists():
            print(f"{code:8} 상세 주소가 없음 (먼저 discover)")
            continue
        recs = fetch_issuer(web, code, cfg, force, limit)
        by = {}
        for r in recs:
            by[r["result"]] = by.get(r["result"], 0) + 1
        print(f"[fetch] {code:8} 누적 결과 {by}", flush=True)
