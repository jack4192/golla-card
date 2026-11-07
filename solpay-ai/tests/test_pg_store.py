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
    from engine.pg_store import PostgresStore
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
    rule = {"rule_type": "force", "target": {"issuer": "SHINHAN"}, "source_text": "신한카드로 해줘"}
    pg.store.save_rules(2, [rule])
    recommendation_id, result = pg.rank(RankRequest(2, at(10, 7, 12), 37.5, 127.0, 20))
    assert recommendation_id > 0 and result.reason_code == "RULE"
    pg.store.save_rules(2, [])
    assert pg.rank(RankRequest(2, at(10, 7, 12)))[1].reason_code != "RULE"


def test_없는_사용자(services):
    with pytest.raises(UnknownUser):
        services[0].rank(RankRequest(99_999, at()))
