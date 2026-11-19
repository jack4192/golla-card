"""1년 데이터 내보내기 (generate.export_db).

원본 그대로 쓰는 카드·혜택 표는 파일을 그대로 복사한다. pandas 로 읽었다 쓰면 빈칸이 있는 정수 칸이
0.0 처럼 소수로 바뀌어 PostgreSQL INTEGER 칸에 적재되지 않는다 (2026-11-18 로컬 적재에서 발견).
"""

from generate.export_db import COPY, copy_original


def test_원본_표는_바이트까지_그대로_복사한다(tmp_path):
    src, dst = tmp_path / "src", tmp_path / "dst"
    src.mkdir()
    body = "﻿tier_id,card_id,tier_no,min_amount,total_limit\n1,1,0,0,0\n2,1,1,400000,\n".encode("utf-8")
    (src / "card_tiers.csv").write_bytes(body)
    copy_original(src, dst, ["card_tiers"])
    assert (dst / "card_tiers.csv").read_bytes() == body          # 0 이 0.0 으로 바뀌지 않는다


def test_원본_그대로_쓰는_표_목록():
    """프로모션은 원본 5건 대신 SOL 페이 혜택 정보 29건을 넣으므로 그대로 복사하지 않는다 (2026-11-18)."""
    assert set(COPY) == {"categories", "merchant_aliases", "cards", "card_perks", "card_tiers", "benefit_groups",
                         "benefit_group_tiers", "benefits", "benefit_targets", "benefit_tiers"}
