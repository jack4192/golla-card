"""④ AI 구조화: 혜택 원문 → CardExtract (Gemini).

결과: cache/crawl/structured/{ISSUER}/{id}.json   카드마다 하나, 이미 있으면 건너뛴다 (--force 면 다시)
      cache/crawl/responses/{ISSUER}/{id}.txt     모델 응답 원문 (실패 원인 확인용)
필요: data/.env 의 GEMINI_API_KEY
      모델은 GEMINI_MODEL (기본 gemini-3.6-flash), 과부하 때 쓸 예비 모델은 GEMINI_FALLBACK_MODEL
      (기본 gemini-3.5-flash-lite, 빈 값이면 안 씀)

호출은 client.interactions.create(response_format=JSON 스키마) (2026-11 Gemini API 문서 기준).
검증에 실패하면 한 번 더 요청하고, 마지막 시도는 범위 밖 숫자를 비워 복구한 뒤 경고를 남긴다
(모델이 숫자 칸에서 0을 끝없이 반복하는 경우가 있었다).
"""

import json
import os
import sys
import time

from pydantic import ValidationError

from generate.common import load_config, load_env

from .progress import Progress, waiting
from .schema import MAX_COUNT, MAX_WON, CardExtract
from .web import CRAWL, now

DEFAULT_MODEL = "gemini-3.6-flash"
DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite"   # 주 모델이 계속 과부하일 때 (2026-11 문서 기준 안정판)
MAX_TEXT = 20_000          # 원문이 이보다 길면 잘라서 보낸다 (경고 남김)
REQUEST_TIMEOUT_SEC = 180  # 요청 하나가 이보다 오래 걸리면 시간 초과로 본다
RETRY_CODES = {429, 500, 502, 503, 504}   # 속도 제한·과부하·일시 오류
RETRY_DELAYS_SEC = [10, 20, 40]           # 모델마다 이만큼 쉬며 다시 요청
COUNT_FIELDS = {"count_limit", "daily_count", "monthly_count"}

PROMPT = """너는 카드 상품 혜택 원문을 구조화한다. 아래 원문만 근거로 JSON 스키마에 맞춰 출력한다.

규칙
1. 원문에 없는 값은 지어내지 말고 null. 애매하면 needs_review=true, notes 에 이유.
2. 비율은 0~1 (10% → 0.1). 금액은 원 단위 정수 (1만원 → 10000).
3. 시각은 승인 시각 기준 "HH:MM".
4. 한 혜택에 영역이 여러 개이고 대상 가맹점이 다르면 영역마다 benefits 를 나눈다. 같은 한도를 쓰면 같은 cap_group.
5. 전월 실적 구간별 월 한도 표는 cap_groups.tiers 로 ("40만원 이상 80만원 미만" → min 400000, max 800000).
6. "할인 전 이용금액 기준 1회 1만원까지"는 max_eligible_amount_per_txn, "건당 최대 1천원"은 max_benefit_per_txn.
7. 업종 코드는 아래에서 고른다. 전 가맹점 ALL, 해외 OVERSEAS, 맞는 게 없으면 OTHER 와 tags.
{categories}
8. 간편결제 전용 혜택은 channel=pay_app, pay_apps 에 대상.
9. 수수료 면제·라운지·무이자 할부처럼 결제액에 비례하지 않는 혜택도 benefit_type 에 맞게 넣는다.
10. 카드 소개·유의사항·연체 이자율 같은 혜택이 아닌 내용은 benefits 에 넣지 않는다.

카드사: {issuer}  /  수집 주소: {url}
규칙 파서가 읽은 카드명(틀릴 수 있음): {name}

원문:
{text}
"""


def _repair(data) -> list[str]:
    """범위 밖 숫자를 비우고, 비워진 실적 구간 경계는 이웃 구간 값으로 채운다."""
    warnings: list[str] = []

    def walk(o, path):
        if isinstance(o, dict):
            for k, v in o.items():
                limit = MAX_COUNT if k in COUNT_FIELDS else MAX_WON
                if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) > limit and k != "rate":
                    o[k] = None
                    warnings.append(f"{path}.{k}: 범위 밖 숫자를 비움")
                else:
                    walk(v, f"{path}.{k}")
        elif isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f"{path}[{i}]")

    walk(data, "")
    for g in data.get("cap_groups", []):
        tiers = g.get("tiers", [])
        for i, t in enumerate(tiers):
            if t.get("min_prev_spend") is None:
                t["min_prev_spend"] = tiers[i - 1].get("max_prev_spend") if i else 0
                warnings.append(f"{g.get('code')} 구간 {i + 1}: 하한을 앞 구간 상한으로 채움")
            if t.get("max_prev_spend") is None and i + 1 < len(tiers) and tiers[i + 1].get("min_prev_spend"):
                t["max_prev_spend"] = tiers[i + 1]["min_prev_spend"]
                warnings.append(f"{g.get('code')} 구간 {i + 1}: 상한을 다음 구간 하한으로 채움")
    return warnings


def _status_code(e: Exception) -> int | None:
    """SDK 버전·호출 방식마다 오류 클래스가 달라서 상태 코드 속성으로 판단한다.
    (interactions 는 APIStatusError.status_code, 예전 generate_content 는 errors.APIError.code)"""
    for attr in ("status_code", "code"):
        v = getattr(e, attr, None)
        if isinstance(v, int):
            return v
    return None


def _is_timeout(e: Exception) -> bool:
    return isinstance(e, TimeoutError) or "Timeout" in type(e).__name__ or "timed out" in str(e).lower()


def _call(client, models: list[str], prompt: str, timeout_sec: float, label: str) -> tuple[str, str]:
    """(응답 원문, 실제로 쓴 모델). 과부하·속도 제한·시간 초과면 쉬었다가 다시, 그래도 안 되면 다음 모델로."""
    schema = CardExtract.model_json_schema()
    last: Exception | None = None
    for mi, model in enumerate(models):
        for attempt in range(len(RETRY_DELAYS_SEC) + 1):
            try:
                with waiting(f"{label} {model} 응답"):
                    res = client.interactions.create(
                        model=model, input=prompt,
                        response_format={"type": "text", "mime_type": "application/json", "schema": schema},
                        timeout=timeout_sec,
                    )
                status = getattr(res, "status", None)
                if status not in (None, "completed"):
                    raise RuntimeError(f"응답 상태 {status}")
                return res.output_text, model
            except Exception as e:
                code = _status_code(e)
                if code not in RETRY_CODES and not _is_timeout(e):
                    raise                                   # 요청 형식 오류·인증 오류 등은 다시 해도 같다
                last = e
                why = "시간 초과" if _is_timeout(e) else f"API {code}"
                if attempt < len(RETRY_DELAYS_SEC):
                    wait = RETRY_DELAYS_SEC[attempt]
                    print(f"      … {label} {model} {why} → {wait}초 후 다시 요청 "
                          f"({attempt + 1}/{len(RETRY_DELAYS_SEC)})", flush=True)
                    time.sleep(wait)
                    continue
                if mi + 1 < len(models):
                    print(f"      … {label} {model} 계속 {why} → 예비 모델 {models[mi + 1]} 로 전환", flush=True)
                break
    raise last or RuntimeError("요청 실패")


def structure_card(client, models: list[str], issuer: str, card: dict, text: str, resp_path,
                   timeout_sec: float) -> tuple[CardExtract, list[str], str]:
    """(결과, 경고, 실제로 쓴 모델)."""
    warnings = []
    if len(text) > MAX_TEXT:
        text, warnings = text[:MAX_TEXT], [f"원문 {len(text):,}자 중 앞 {MAX_TEXT:,}자만 보냄"]
    cats = "\n".join(f"   {c['code']}: {c['name']}" for c in load_config("categories")["categories"])
    prompt = PROMPT.format(categories=cats, issuer=issuer, url=card["url"], name=card.get("card_name"), text=text)
    label = f"{issuer} {card['id']}"
    for attempt in (1, 2):
        raw, used = _call(client, models, prompt, timeout_sec, label)
        if used != models[0]:
            warnings.append(f"주 모델 과부하로 예비 모델 {used} 사용")
        resp_path.parent.mkdir(parents=True, exist_ok=True)
        resp_path.write_text(raw, encoding="utf-8")
        try:
            return (CardExtract.model_validate_json(raw),
                    warnings + ([f"{attempt}번째 요청 결과"] if attempt > 1 else []), used)
        except ValidationError as e:
            if attempt == 1:
                print(f"      … {label} 응답이 스키마와 안 맞음 ({e.errors()[0]['type']}) → 한 번 더 요청", flush=True)
                time.sleep(2)
    print(f"      … {label} 두 번째도 안 맞아 자동 복구", flush=True)
    data = json.loads(raw, parse_int=lambda s: int(s) if len(s) <= 18 else 10**18)
    return CardExtract.model_validate(data), warnings + ["2번째 요청 결과를 자동 복구"] + _repair(data), used


def run(issuers: dict, force: bool = False, limit: int | None = None,
        timeout_sec: float = REQUEST_TIMEOUT_SEC) -> None:
    from google import genai

    load_env()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY가 없습니다. data/.env 에 넣어 주세요.")
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    fallback = os.environ.get("GEMINI_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)   # 빈 값이면 예비 모델 안 씀
    models = [model] + ([fallback] if fallback and fallback != model else [])
    client = genai.Client(api_key=key)
    print(f"[structure] 모델 {model}" + (f" (예비 {fallback})" if len(models) > 1 else "")
          + f" · 요청 제한 시간 {timeout_sec:.0f}초", flush=True)

    for code in issuers:
        parsed = CRAWL / "parsed" / f"{code}.json"
        if not parsed.exists():
            print(f"[structure] {code:8} 파싱 결과가 없음 (먼저 parse)", flush=True)
            continue
        cards = json.loads(parsed.read_text(encoding="utf-8"))
        out_dir = CRAWL / "structured" / code
        out_dir.mkdir(parents=True, exist_ok=True)
        todo = [c for c in cards if force or not (out_dir / f"{c['id']}.json").exists()]
        if limit:
            todo = todo[:limit]
        if len(cards) > len(todo):
            print(f"[structure] {code:8} 이미 된 {len(cards) - len(todo)}장은 건너뜀 (다시 하려면 --force)", flush=True)
        prog = Progress("structure", code, len(todo))
        for c in todo:
            text = (CRAWL / "text" / code / f"{c['id']}.txt").read_text(encoding="utf-8")
            print(f"      → {code} {c['id']} {c.get('card_name') or ''} (원문 {len(text):,}자) 요청", flush=True)
            try:
                ext, warnings, used = structure_card(client, models, code, c, text,
                                                     CRAWL / "responses" / code / f"{c['id']}.txt", timeout_sec)
            except Exception as e:
                print(f"      ✗ {code} {c['id']} 실패: {type(e).__name__}: {str(e)[:120]}", flush=True)
                prog.tick(f"{c['id']} 실패", ok=False)
                continue
            out = {"id": c["id"], "model": used, "structured_at": now(), "warnings": warnings, **ext.model_dump()}
            (out_dir / f"{c['id']}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
            warn = f" · 경고 {len(warnings)}" if warnings else ""
            prog.tick(f"{c.get('card_name') or c['id']} · 혜택 {len(ext.benefits)}{warn}")
            time.sleep(1)
        prog.finish()
