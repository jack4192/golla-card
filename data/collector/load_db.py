"""⑤ DB 적재. parsed(규칙 파서) + structured(AI 구조화) → PostgreSQL.

필요: 레포 루트에서 docker compose up -d, data/.env 의 DATABASE_URL
여러 번 실행해도 같은 결과가 되도록 카드 단위로 혜택·한도를 지우고 다시 넣는다.
"""

import json
import os
import sys

from generate.common import DATA_DIR, load_env

from .progress import Progress
from .web import CRAWL

SCHEMA_DIR = DATA_DIR.parent / "db" / "schema"
BENEFIT_COLS = ["card_id", "seq", "title", "categories", "tags", "merchants", "benefit_type", "rate", "amount",
                "time_start", "time_end", "weekdays", "channel", "pay_apps", "min_txn_amount",
                "max_eligible_amount_per_txn", "max_benefit_per_txn", "daily_count", "monthly_count",
                "requires_prev_spend", "cap_group", "excludes", "notes", "quote", "needs_review"]


def run(all_issuers: dict) -> None:
    import psycopg

    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL이 없습니다. data/.env 를 확인해 주세요.")
    try:
        conn = psycopg.connect(url, connect_timeout=5)
    except psycopg.OperationalError:
        sys.exit("DB에 연결할 수 없습니다. Docker Desktop을 켜고 레포 루트에서 `docker compose up -d` 를 실행해 주세요.")
    with conn, conn.cursor() as cur:
        for f in sorted(SCHEMA_DIR.glob("*.sql")):
            cur.execute(f.read_text(encoding="utf-8"))

        for code, cfg in all_issuers.items():
            cur.execute(
                """INSERT INTO card_issuers (issuer_code, issuer_name, crawl_status, crawl_note) VALUES (%s,%s,%s,%s)
                   ON CONFLICT (issuer_code) DO UPDATE SET issuer_name = EXCLUDED.issuer_name,
                     crawl_status = EXCLUDED.crawl_status, crawl_note = EXCLUDED.crawl_note""",
                (code, cfg["name"], "excluded" if cfg.get("exclude") else "collected", cfg.get("exclude")))

        n_cards = n_ben = 0
        for code in all_issuers:
            parsed = CRAWL / "parsed" / f"{code}.json"
            if not parsed.exists():
                continue
            cards = json.loads(parsed.read_text(encoding="utf-8"))
            prog = Progress("load", code, len(cards), every=10)
            for c in cards:
                s_path = CRAWL / "structured" / code / f"{c['id']}.json"
                s = json.loads(s_path.read_text(encoding="utf-8")) if s_path.exists() else None
                # 카드명·연회비는 규칙 파서 값을 우선하고, 못 읽었으면 AI 값을 쓴다.
                # 종류는 주소로 확인한 값 > AI가 원문에서 읽은 값 > 카드명으로 추정한 값 순서
                name = c["card_name"] or (s or {}).get("card_name")
                type_guessed = "종류는 카드명으로 추정" in c["warnings"]
                ai_type = (s or {}).get("card_type")
                if type_guessed and ai_type:
                    ctype, type_guessed = ai_type, False
                else:
                    ctype = c["card_type"] or ai_type
                fee = c["annual_fee_krw"] if c["annual_fee_krw"] is not None else (s or {}).get("annual_fee_domestic")
                cur.execute(
                    """INSERT INTO card_products (issuer_code, source_id, product_url, card_name, card_type, card_type_guessed,
                         annual_fee_krw, annual_fee_note, launch_date, discontinued, headline_benefits, retrieved_at,
                         content_sha256, parse_warnings, structured_model, structured_at, structure_warnings)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (issuer_code, source_id) DO UPDATE SET product_url = EXCLUDED.product_url,
                         card_name = EXCLUDED.card_name, card_type = EXCLUDED.card_type,
                         card_type_guessed = EXCLUDED.card_type_guessed, annual_fee_krw = EXCLUDED.annual_fee_krw,
                         annual_fee_note = EXCLUDED.annual_fee_note, launch_date = EXCLUDED.launch_date,
                         discontinued = EXCLUDED.discontinued, headline_benefits = EXCLUDED.headline_benefits,
                         retrieved_at = EXCLUDED.retrieved_at, content_sha256 = EXCLUDED.content_sha256,
                         parse_warnings = EXCLUDED.parse_warnings, structured_model = EXCLUDED.structured_model,
                         structured_at = EXCLUDED.structured_at, structure_warnings = EXCLUDED.structure_warnings
                       RETURNING card_id""",
                    (code, c["id"], c["url"], name, ctype, type_guessed, fee,
                     c["annual_fee_context"] or (s or {}).get("annual_fee_note"), c["launch_date"], c["discontinued"],
                     c["headline_benefits"], c["retrieved_at"], c["sha256"], c["warnings"],
                     (s or {}).get("model"), (s or {}).get("structured_at"), (s or {}).get("warnings") or []))
                card_id = cur.fetchone()[0]
                n_cards += 1
                cur.execute("DELETE FROM card_benefits WHERE card_id = %s", (card_id,))
                cur.execute("DELETE FROM card_cap_tiers WHERE card_id = %s", (card_id,))
                if not s:
                    prog.tick(f"{name or c['id']} (AI 구조화 없음)")
                    continue
                rows = []
                for i, b in enumerate(s["benefits"]):
                    tw = b.get("time_window") or {}
                    d = {**b, "card_id": card_id, "seq": i, "time_start": tw.get("start"), "time_end": tw.get("end")}
                    rows.append([d.get(k) for k in BENEFIT_COLS])
                if rows:
                    cur.executemany(f"INSERT INTO card_benefits ({', '.join(BENEFIT_COLS)}) "
                                    f"VALUES ({', '.join(['%s'] * len(BENEFIT_COLS))})", rows)
                n_ben += len(rows)
                for g in s.get("cap_groups", []):
                    for t in g["tiers"]:
                        cur.execute(
                            """INSERT INTO card_cap_tiers (card_id, cap_group, description, tier_min, tier_max, cap_amount,
                                 count_limit) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
                            (card_id, g["code"], g["description"], t["min_prev_spend"], t.get("max_prev_spend"),
                             t.get("cap_amount"), t.get("count_limit")))
                prog.tick(f"{name or c['id']} · 혜택 {len(rows)}")
            prog.finish()
        conn.commit()
    print(f"[load] 적재 완료: 카드 {n_cards}장 · 혜택 {n_ben}건", flush=True)
