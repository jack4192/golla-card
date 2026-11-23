"""일정 '직접 입력' 업종·가맹점 분류 (2026-11-23 설계서 docs/superpowers/specs/2026-11-23-place-classify-design.md)."""

from datetime import timedelta

import pytest

from engine.loader import ARTIFACTS
from engine.team_db import team_db_dir
from tests.conftest import at, pay


@pytest.fixture(scope="module")
def service(tmp_path_factory):
    if not (team_db_dir() / "payments.csv").exists() or not (ARTIFACTS / "priors.json").exists():
        pytest.skip("팀 DB CSV 또는 artifacts 가 없습니다")
    import os
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_STRATEGY_DB"] = str(tmp_path_factory.mktemp("place") / "strategy.sqlite")
    from engine.api import build_service
    return build_service()


@pytest.fixture
def catalog(service):
    return service.engine.catalog


def _merchant_of(catalog, brand):
    return next(m.merchant_id for m in sorted(catalog.merchants.values(), key=lambda m: m.merchant_id)
                if m.brand_code == brand)


# ---------- Task 1: 규칙 분류 ----------

@pytest.mark.parametrize("text, category, brand", [
    ("스타벅스", "CAFE", "스타벅스"),
    ("스벅", "CAFE", "스타벅스"),
    ("메가커피", "CAFE", "메가MGC커피"),
    ("올리브영", "HNB", "올리브영"),
    ("신세계백화점", "DEPARTMENT_STORE", "신세계백화점"),
    ("스타벅스 강남", "CAFE", "스타벅스"),
])
def test_브랜드_별칭_정확_일치(catalog, text, category, brand):
    from engine.place import match_place
    m = match_place(text, catalog)
    assert (m.category, m.brand, m.exact) == (category, brand, True)
    assert m.brand_name == brand


def test_업종_이름만이면_브랜드_없음(catalog):
    from engine.place import match_place
    m = match_place("백화점", catalog)
    assert m.category == "DEPARTMENT_STORE" and m.brand is None and m.exact is False


def test_여러_브랜드면_후보만(catalog):
    from engine.place import match_place
    m = match_place("GS", catalog)
    assert m.category is None and m.brand is None
    pairs = {(c["category"], c["brand"]) for c in m.candidates}
    assert ("CONVENIENCE", "GS25") in pairs and ("FUEL", "GS칼텍스") in pairs


def test_짧은_말이_한_가맹점_이름의_일부일_뿐이면_확정하지_않음(catalog):
    from engine.place import match_place
    m = match_place("스타", catalog)          # 스타벅스·CJ온스타일 둘 다 걸린다 → 후보
    assert m.brand is None and m.category is None and len(m.candidates) >= 2


@pytest.mark.parametrize("text", ["헬스장", "친구랑 저녁"])
def test_못_찾으면_빈_결과(catalog, text):
    from engine.place import match_place
    m = match_place(text, catalog)
    assert (m.category, m.brand, m.candidates) == (None, None, [])


def test_clean_text():
    from engine.place import clean_text
    assert clean_text("  스타벅스  ") == "스타벅스"
    assert len(clean_text("가" * 41)) == 40
    assert "1234-5678" not in clean_text("010-1234-5678 스벅")


def test_amount_hint_순서(service, catalog):
    from engine.place import amount_hint
    priors = service.engine.priors
    when = at(month=11, day=5)
    sb = _merchant_of(catalog, "스타벅스")
    other_cafe = next(m.merchant_id for m in catalog.merchants.values()
                      if m.category == "CAFE" and m.brand_code not in (None, "스타벅스"))
    brand_rows = [pay(card=1, amount=a, category="CAFE", merchant=sb, when=when - timedelta(days=d))
                  for a, d in ((5_000, 3), (6_500, 5), (7_000, 9))]
    cafe_rows = [pay(card=1, amount=a, category="CAFE", merchant=other_cafe, when=when - timedelta(days=d))
                 for a, d in ((3_000, 2), (4_000, 4), (9_000, 6))]
    assert amount_hint(brand_rows + cafe_rows, catalog, "CAFE", "스타벅스", when, priors) == 6_500
    assert amount_hint(cafe_rows, catalog, "CAFE", "스타벅스", when, priors) == 4_000
    old = [pay(card=1, amount=50_000, category="CAFE", merchant=sb, when=when - timedelta(days=120))]
    assert amount_hint(old, catalog, "CAFE", "스타벅스", when, priors) == round(priors.amount_median("CAFE"), -2)
