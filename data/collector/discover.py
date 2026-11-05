"""① 상품 상세 주소 찾기. 결과: cache/crawl/urls/{ISSUER}.json"""

import html
import json
import re
from urllib.parse import urljoin

from generate.common import load_config

from .web import CRAWL, Blocked, Web


def _canonical(cfg: dict, found: str) -> tuple[str, str] | None:
    """찾은 주소 → (상품 id, 표준 상세 주소). id 를 못 뽑으면 None."""
    m = re.search(cfg["id_pattern"], found)
    if not m:
        return None
    pid = m.group(1)
    return pid, cfg["url_template"].format(id=pid) if cfg.get("url_template") else found


def _from_sitemap(web: Web, step: dict) -> list[str]:
    out = []
    for url in step["urls"]:
        text = web.get(url, timeout=60)
        locs = [html.unescape(x) for x in re.findall(r"<loc>\s*([^<\s]+)", text)]
        for nested in [x for x in locs if x.endswith(".xml")]:          # 사이트맵 인덱스면 한 단계 더
            locs += [html.unescape(x) for x in re.findall(r"<loc>\s*([^<\s]+)", web.get(nested, timeout=60))]
        out += [x for x in locs if re.search(step["pattern"], x)]
    return out


def _from_llms(web: Web, step: dict, cfg: dict) -> list[str]:
    ids = re.findall(step["pattern"], web.get(step["url"]))
    return [cfg["url_template"].format(id=i) for i in dict.fromkeys(ids)]


def _from_static_links(web: Web, step: dict) -> list[str]:
    out = []
    for page in step["pages"]:
        h = html.unescape(web.get(page))
        out += [urljoin(page, m.group(0)) for m in re.finditer(step["pattern"], h)]
    return out


def _from_rendered_links(web: Web, step: dict, cfg: dict) -> list[str]:
    out = []
    for page in step["pages"]:
        h, _ = web.render(page, cfg["domains"])
        out += [m.group(0) for m in re.finditer(step["pattern"], html.unescape(h))]
    return out


def discover_issuer(web: Web, code: str, cfg: dict) -> list[dict]:
    seeds = load_config("crawl_seeds") or {}
    found: dict[str, dict] = {}
    for step in cfg["discovery"]:
        kind = step["type"]
        try:
            if kind == "sitemap":
                urls = _from_sitemap(web, step)
            elif kind == "llms":
                urls = _from_llms(web, step, cfg)
            elif kind == "static_links":
                urls = _from_static_links(web, step)
            elif kind == "rendered_links":
                urls = _from_rendered_links(web, step, cfg)
            elif kind == "seeds":
                urls = seeds.get(code) or []
            else:
                raise ValueError(f"모르는 discovery type: {kind}")
        except Blocked as e:
            print(f"[discover] {code:8} {kind}: robots.txt 불허 {e}", flush=True)
            continue
        except Exception as e:
            print(f"[discover] {code:8} {kind}: 실패 {type(e).__name__}: {str(e)[:120]}", flush=True)
            continue
        n0 = len(found)
        for u in urls:
            c = _canonical(cfg, u)
            if c and c[0] not in found:
                found[c[0]] = {"id": c[0], "url": c[1], "found_by": kind}
        print(f"[discover] {code:8} {kind}: {len(found) - n0}개 추가 (누적 {len(found)})", flush=True)
    return list(found.values())


def run(web: Web, issuers: dict) -> None:
    (CRAWL / "urls").mkdir(parents=True, exist_ok=True)
    for i, (code, cfg) in enumerate(issuers.items(), start=1):
        print(f"[discover] ({i}/{len(issuers)}) {code} 상품 주소 찾는 중…", flush=True)
        items = discover_issuer(web, code, cfg)
        (CRAWL / "urls" / f"{code}.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[discover] {code:8} 상세 주소 {len(items)}개 → cache/crawl/urls/{code}.json", flush=True)
