"""③ 규칙 파서: AI 없이 원문에서 바로 읽을 수 있는 기본 정보.

카드명, 종류(신용/체크), 국내 연회비, 출시일, 판매 종료 표시, 대표 혜택 문구(퍼센트·금액이 들어간 짧은 줄).
못 읽은 값은 비워 두고 warnings 에 남긴다 (0이나 false 로 채우지 않는다).
결과: cache/crawl/parsed/{ISSUER}.json
"""

import json
import re

from bs4 import BeautifulSoup

from .web import CRAWL

GENERIC_NAMES = {"", "카드", "신용카드", "체크카드", "전체메뉴보기", "주요혜택", "카드 혜택 안내", "하나카드", "우리카드",
                 "현대카드", "토스뱅크", "NH농협카드(개인)"}
HEADLINE = re.compile(r"(\d+(?:\.\d+)?\s*%|\d[\d,]*\s*(?:원|천원|만원|마일|포인트|P)\b).{0,30}(할인|적립|캐시백|면제)"
                      r"|(할인|적립|캐시백|면제).{0,30}(\d+(?:\.\d+)?\s*%|\d[\d,]*\s*(?:원|천원|만원|마일|포인트))")


def _name(soup: BeautifulSoup, text: str, strategies: list[str]) -> str | None:
    for s in strategies:
        cand = None
        if s == "title_split" and soup.title:
            cand = re.split(r"\s*[|>]\s*", soup.title.get_text(strip=True))[0]
        elif s == "title_last" and soup.title:
            cand = re.split(r"\s*[|>]\s*", soup.title.get_text(strip=True))[-1]
        elif s == "og_title":
            og = soup.find("meta", property="og:title")
            cand = og.get("content") if og else None
        elif s.startswith("selector:"):
            for el in soup.select(s.split(":", 1)[1]):
                t = el.get_text(" ", strip=True)
                if t and t not in GENERIC_NAMES and len(t) <= 40:
                    cand = t
                    break
        elif s == "content_first_line":
            cand = next((ln.strip() for ln in text.splitlines() if 2 <= len(ln.strip()) <= 40), None)
        if cand:
            cand = re.sub(r"\s+", " ", cand).strip()
            if cand not in GENERIC_NAMES:
                return cand
    return None


def _card_type(url: str, name: str | None, rule: dict | None) -> tuple[str | None, bool]:
    """(종류, 추정 여부)."""
    for key, kind in ((rule or {}).get("from_url") or {}).items():
        if key in url:
            return kind, False
    if name:
        return ("check" if re.search(r"체크|check", name, re.I) else "credit"), True
    return None, True


def _annual_fee(text: str) -> tuple[int | None, str | None]:
    """(연회비 추정, 근거 문장). '연회비' 바로 뒤에 금액이나 '없음'이 붙은 첫 문맥만 쓴다.
    메뉴 글자('연회비 SMS서비스…')나 혜택 문구('연회비 면제 서비스')는 건너뛴다."""
    for m in re.finditer(r"연회비", text):
        ctx = re.sub(r"\s+", " ", text[m.start(): m.start() + 60])
        if re.match(r"연회비\s*(?:안내)?\s*[:：]?\s*(?:없음|무료)", ctx):
            return 0, ctx[:60]
        amt = re.match(r"연회비\s*(?:안내)?\s*[:：]?\s*(?:[가-힣A-Za-z·,/()\s]{0,20}?)([\d,]{3,})\s*원", ctx)
        if amt:
            return int(amt.group(1).replace(",", "")), ctx[:60]
    return None, None


def _page_text(soup: BeautifulSoup) -> str:
    for el in soup.select("script, style, noscript"):
        el.decompose()
    return soup.get_text("\n", strip=True)


def _launch_date(text: str) -> str | None:
    m = re.search(r"출시\s*(?:일자|일)?\s*[:：]?\s*(\d{4})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})", text)
    return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else None


def _headlines(text: str, limit: int = 10) -> list[str]:
    out = []
    for ln in text.splitlines():
        ln = re.sub(r"\s+", " ", ln).strip()
        if 6 <= len(ln) <= 70 and HEADLINE.search(ln) and ln not in out:
            out.append(ln)
        if len(out) >= limit:
            break
    return out


def parse_card(cfg: dict, rec: dict, html: str, text: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    name = _name(soup, text, cfg.get("name", []))
    card_type, type_guessed = _card_type(rec["url"], name, cfg.get("card_type"))
    page = _page_text(soup)                   # 연회비·출시일은 혜택 영역 밖에 있는 경우가 많다
    fee, fee_ctx = _annual_fee(page)
    warnings = []
    if not name:
        warnings.append("카드명을 못 읽음")
    if type_guessed:
        warnings.append("종류는 카드명으로 추정")
    if fee is None:
        warnings.append("연회비를 못 읽음")
    return {
        "id": rec["id"], "url": rec["url"], "retrieved_at": rec["retrieved_at"], "sha256": rec.get("sha256"),
        "card_name": name, "card_type": card_type, "annual_fee_krw": fee, "annual_fee_context": fee_ctx,
        "launch_date": _launch_date(page),
        "discontinued": bool(re.search(r"판매\s*(?:가\s*)?종료|신규\s*발급\s*(?:이\s*)?(?:중단|불가)", text)),
        "headline_benefits": _headlines(text), "text_chars": len(text), "warnings": warnings,
    }


def run(issuers: dict) -> None:
    (CRAWL / "parsed").mkdir(parents=True, exist_ok=True)
    for code, cfg in issuers.items():
        pages = CRAWL / "pages" / f"{code}.json"
        if not pages.exists():
            continue
        out = []
        for rec in json.loads(pages.read_text(encoding="utf-8")):
            if rec["result"] != "ok":
                continue
            html = (CRAWL / "raw" / code / f"{rec['id']}.html").read_text(encoding="utf-8")
            text = (CRAWL / "text" / code / f"{rec['id']}.txt").read_text(encoding="utf-8")
            out.append(parse_card(cfg, rec, html, text))
        (CRAWL / "parsed" / f"{code}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        named = sum(1 for x in out if x["card_name"])
        print(f"[parse] {code:8} {len(out)}장 · 카드명 {named} · 연회비 {sum(x['annual_fee_krw'] is not None for x in out)}"
              f" · 대표 혜택 문구 평균 {sum(len(x['headline_benefits']) for x in out) / max(1, len(out)):.1f}줄", flush=True)
