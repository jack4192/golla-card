"""실제 PostgreSQL 검증. 데이터를 넣은 DB 주소를 SOLPAY_TEST_DATABASE_URL 로 주면 돈다."""

import os

import pytest

from engine.domain import RankRequest
from engine.params import Params
from engine.service import PlacementEngine, PlacementService
from engine.store import ParquetStore, UnknownUser
from tests.conftest import at
from training.build_priors import priors_from_frame
from engine import loader

URL = os.environ.get("SOLPAY_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="SOLPAY_TEST_DATABASE_URL 이 없습니다")


@pytest.fixture(scope="module")
def services():
    import psycopg
    from engine.pg_store import PostgresStore
    # 엔진이 쓰는 기록(추천 로그·규칙)을 비우고 시작한다. 남아 있으면 '직전 기본 카드'가 달라져 문구가 바뀐다
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute("delete from placement.recommendation_logs")
        conn.execute("delete from placement.user_rules")
    priors = priors_from_frame(loader.read_payments(), Params())
    pg, parquet = PostgresStore(URL), ParquetStore()
    return (PlacementService(pg, PlacementEngine(pg.load_catalog(), priors)),
            PlacementService(parquet, PlacementEngine(parquet.load_catalog(), priors)))


@pytest.mark.parametrize("user_id", [1, 2, 3, 4, 5, 1077, 1200])
@pytest.mark.parametrize("when", [at(10, 7, 12), at(11, 5, 9), at(9, 30, 19)])
def test_DB와_가상_데이터의_배치_결과가_같다(services, user_id, when):
    pg, parquet = services
    _, a = pg.rank(RankRequest(user_id, when))
    _, b = parquet.rank(RankRequest(user_id, when))
    assert [(c.user_card_id, c.score_won, c.message) for c in a.cards] == \
           [(c.user_card_id, c.score_won, c.message) for c in b.cards]
    assert a.display_count == b.display_count and a.reason_code == b.reason_code


def test_추천_로그와_규칙을_저장한다(services):
    pg, _ = services
    card = pg.store.context(2, at(10, 7, 12)).cards[-1].user_card_id      # 사용자 2 의 마지막 카드 (타사 카드만 보유)
    rule = {"rule_type": "force", "target": {"user_card_ids": [card]}, "source_text": "이 카드로 해줘"}
    pg.store.save_rules(2, [rule])
    recommendation_id, result = pg.rank(RankRequest(2, at(10, 7, 12)))      # GPS 는 쓰지 않는다 (2026-11-14)
    assert recommendation_id > 0 and result.reason_code == "RULE" and result.cards[0].user_card_id == card
    pg.store.save_rules(2, [])
    assert pg.rank(RankRequest(2, at(10, 7, 12)))[1].reason_code != "RULE"


def test_없는_사용자(services):
    with pytest.raises(UnknownUser):
        services[0].rank(RankRequest(99_999, at()))
