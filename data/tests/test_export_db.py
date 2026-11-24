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


# v2 (2026-11-22): 결과 폴더와 데모 카드 행
import pandas as pd
import pytest

import generate.export_db as ex


def test_v2_결과_폴더는_v1과_다르다():
    assert ex.default_dst("v1").name == "카드서비스_DB_1년"
    assert ex.default_dst("v2").name == "카드서비스_DB_1년_v2"


def test_v2가_v1_폴더를_가리키면_멈춘다():
    with pytest.raises(SystemExit, match="v1 폴더"):
        ex.check_dst(ex.default_dst("v1"), "v2")
    ex.check_dst(ex.default_dst("v2"), "v2")
    ex.check_dst(ex.default_dst("v1"), "v1")


def test_데모_카드는_카드로_원본_행을_찾는다():
    db_uc = pd.DataFrame([{"user_card_id": 1, "user_id": 1, "card_id": 2, "card_last4": 1234, "target_tier_id": 7}])
    uc = pd.DataFrame([
        {"user_card_id": 1, "user_id": 1, "card_id": 17, "masked_number": "****-****-****-0001"},   # 원본 1번 행과 번호만 같고 카드가 다름
        {"user_card_id": 2, "user_id": 1, "card_id": 2, "masked_number": "****-****-****-5555"},    # 원본에 있는 카드
        {"user_card_id": 3, "user_id": 2, "card_id": 10, "masked_number": "****-****-****-0042"},   # 원본에 없는 카드
    ]).assign(registered_via="openpay", display_order=1, exclude_from_placement=False, is_kpass_registered=False,
              is_transit_default=False, is_bill_card=False, issued_at=pd.Timestamp("2024-01-01"))
    out, _ = ex._user_cards(db_uc, uc, {1: 1, 2: 2})
    out = out.set_index("user_card_id")
    assert out.loc[1, "card_last4"] == "0001" and pd.isna(out.loc[1, "target_tier_id"])
    assert out.loc[2, "card_last4"] == "1234" and out.loc[2, "target_tier_id"] == 7
    assert out.loc[3, "card_last4"] == "0042" and pd.isna(out.loc[3, "target_tier_id"])
