"""가상 데이터가 있을 때만 도는 검증. 없으면 data 에서 `uv run python -m generate.main` 을 실행한다."""

from pathlib import Path

import pandas as pd
import pytest

from engine import loader
from engine.domain import RankRequest
from engine.params import Params
from engine.priors import Priors
from engine.service import PlacementEngine, PlacementService
from engine.store import ParquetStore
from evaluation.replay import ReplayConfig, prepare, replay_user
from tests.conftest import at
from training.build_priors import priors_from_frame

DATA = loader.data_dir()
pytestmark = pytest.mark.skipif(not (DATA / "payments.parquet").exists(), reason="가상 데이터가 없습니다")
REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def data():
    prepare()


def test_혜택_계산_코드는_생성기와_같다():
    source = REPO / "data" / "generate" / "benefit.py"
    assert source.read_text(encoding="utf-8") == (REPO / "solpay-ai" / "engine" / "benefit_calc.py").read_text(encoding="utf-8")


def test_테이블로_만든_카드는_실제_카드_원본과_같다():
    import sys
    from dataclasses import astuple
    sys.path.insert(0, str(REPO / "data"))
    from generate.card_db import load_cards
    expected = {c.card_id: c for c in load_cards()}
    built = loader.load_catalog().cards
    assert len(expected) == 44
    # 2026-11-24 신한카드 4장(41~44)은 원본 CSV 에만 더했다. 가상 데이터(parquet)는 40장일 때 만들어
    # 그 4장이 없다 (데이터를 다시 만들면 이 줄을 set(built) == set(expected) 로 되돌린다).
    assert set(expected) - set(built) == {41, 42, 43, 44} and set(built) <= set(expected)
    for card_id in built:
        card = expected[card_id]
        assert built[card_id].cap_tiers == card.cap_tiers, card.code
        # 생성기와 엔진의 Benefit 은 글자까지 같은 다른 모듈의 클래스라 값으로 비교한다
        assert [astuple(b) for b in built[card_id].benefits] == [astuple(b) for b in card.benefits], card.code
        assert built[card_id].rewards == card.rewards, card.code
        assert built[card_id].total_caps == card.total_caps, card.code


def test_재생의_습관_결과는_생성기의_월별_혜택과_같다(data):
    status = pd.read_parquet(DATA / "card_month_status.parquet")
    for user_id in (1, 2, 3, 4, 5, 1077):
        result = replay_user(user_id, ReplayConfig())
        expected = status[status.user_id == user_id]
        for row in expected.itertuples():
            snap = result["months"][row.year_month]["habit"][row.user_card_id]
            assert snap[1] == row.perf, (user_id, row.year_month)
            assert snap[2] == row.benefit_amount, (user_id, row.year_month)


def test_재생은_결제_금액을_바꾸지_않고_카드만_바꾼다(data):
    result = replay_user(1, ReplayConfig())
    months = result["months"]
    for ym, snap in months.items():
        assert sum(v[1] for v in snap["algo"].values()) == sum(v[1] for v in snap["habit"].values())


def test_온라인과_대표_교통카드_결제는_배치하지_않는다(data):
    result = replay_user(1, ReplayConfig(keep_rows=True))
    assert all(r["payment"].is_placement for r in result["rows"])
    assert result["events"] == 925                 # 2026-01~11-05 현장 결제 (2026-11-16 점유율·자동이체·약국 수정 후 재생성)


def test_금지_컬럼은_읽지_않는다():
    assert "choice_reason" not in loader.read_payments().columns


def test_저장소로_실제_사용자를_배치한다():
    store = ParquetStore()
    frame = loader.read_payments()
    priors: Priors = priors_from_frame(frame, Params())
    service = PlacementService(store, PlacementEngine(store.load_catalog(), priors))
    _, result = service.rank(RankRequest(1, at(11, 5, 12)))
    assert result.version == "pattern"
    assert {c.user_card_id for c in result.cards} == {c.user_card_id for c in store.cards[1]}
    assert result.cards[0].message
    assert store.logs[-1]["user_id"] == 1


def test_결제_평가는_실제로_반영된_혜택과_같다():
    from engine.domain import Payment
    store = ParquetStore()
    priors = priors_from_frame(loader.read_payments(), Params())
    service = PlacementService(store, PlacementEngine(store.load_catalog(), priors))
    when = at(11, 5, 12, 30)
    before = {c["user_card_id"]: c["benefit_this_month"] for c in service.card_status(1, when)}
    cafe = next(m for m in store.load_catalog().merchants.values() if m.brand_code == "스타벅스")
    check = service.evaluate_payment(1, when, "CAFE", 15_000, used_card=2, merchant_id=cafe.merchant_id)
    paid = Payment(99_000_001, 1, 2, cafe.merchant_id, "CAFE", "offline_qr", "manual", 15_000, when, when)
    store.add_payment(paid)
    after = {c["user_card_id"]: c["benefit_this_month"] for c in service.card_status(1, when)}
    assert after[2] - before[2] == check["used_benefit"] - (check["used_promotion"] or 0)
    store.add_payment(paid)
    assert {c["user_card_id"]: c["benefit_this_month"] for c in service.card_status(1, when)} == after
    store.reset()
    assert {c["user_card_id"]: c["benefit_this_month"] for c in service.card_status(1, when)} == before
