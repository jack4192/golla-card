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


# ---------- Task 2: OpenAI 보조 분류와 서비스 조립 ----------

import json  # noqa: E402

from tests.test_page_copy import FakeClient  # noqa: E402


@pytest.fixture
def svc(service):
    service.place_cache.clear()
    return service


def _llm(script):
    from engine.chat.page_copy import CopySettings
    from engine.chat.place_llm import PlaceLLM
    client = FakeClient(script)
    return PlaceLLM(client, CopySettings(timeout_sec=5)), client


def _answer(category, brand=None, confidence="high"):
    return json.dumps({"category": category, "brand": brand, "confidence": confidence}, ensure_ascii=False)


def test_OpenAI_분류_요청은_생각_단계_none_옛_모델은_온도_0():
    from engine.chat.page_copy import CopySettings
    from engine.chat.place_llm import PlaceLLM
    new, old = FakeClient([_answer("CAFE")]), FakeClient([_answer("CAFE")])
    PlaceLLM(new, CopySettings()).classify("스벅", {"CAFE": "카페"}, {})
    PlaceLLM(old, CopySettings(model="gpt-4o-mini", reasoning_effort=None)).classify("스벅", {"CAFE": "카페"}, {})
    assert new.requests[0]["reasoning_effort"] == "none" and "temperature" not in new.requests[0]
    assert old.requests[0]["temperature"] == 0 and "reasoning_effort" not in old.requests[0]


def test_검색으로_찾으면_OpenAI_안_부름(svc):
    llm, client = _llm([])
    r = svc.classify_place("스타벅스", llm=llm)
    assert (r["source"], r["category"], r["brand"]) == ("search", "CAFE", "스타벅스") and client.requests == []


def test_검색_실패면_OpenAI_분류(svc):
    llm, client = _llm([_answer("FITNESS")])
    r = svc.classify_place("헬스장", llm=llm)
    assert (r["source"], r["category"], r["brand"]) == ("llm", "FITNESS", None)
    assert r["category_name"] == svc.engine.catalog.category_name("FITNESS") and len(client.requests) == 1


def test_OpenAI_오타도_목록_안_브랜드면_받음(svc):
    llm, _ = _llm([_answer("CAFE", "스타벅스")])
    r = svc.classify_place("스타벅쓰", llm=llm)
    assert (r["source"], r["category"], r["brand"], r["brand_name"]) == ("llm", "CAFE", "스타벅스", "스타벅스")


def test_OpenAI_목록_밖_값은_버림(svc):
    llm, _ = _llm([_answer("GYM", "없는브랜드")])
    r = svc.classify_place("크로스핏 박스", llm=llm)
    assert (r["source"], r["category"], r["brand"]) == ("none", None, None)


def test_확신_낮으면_후보만(svc):
    llm, _ = _llm([_answer("FITNESS", confidence="low")])
    r = svc.classify_place("운동하러", llm=llm)
    assert r["category"] is None and r["brand"] is None and r["source"] == "llm"
    assert [c["category"] for c in r["candidates"]] == ["FITNESS"]


def test_OpenAI_실패나_키_없으면_none(svc):
    llm, _ = _llm([RuntimeError("boom")])
    assert svc.classify_place("필라테스", llm=llm)["source"] == "none"
    assert svc.classify_place("요가 수업", llm=None)["source"] == "none"


def test_같은_글자는_캐시(svc):
    llm, client = _llm([_answer("FITNESS")])
    first = svc.classify_place("동네 헬스", llm=llm)
    second = svc.classify_place("동네 헬스", llm=llm)
    assert first["category"] == second["category"] == "FITNESS" and len(client.requests) == 1


def test_OpenAI_로_가는_글은_가려지고_원문은_응답에_없음(svc):
    llm, client = _llm([_answer("FITNESS")])
    r = svc.classify_place("헬스 010-1234-5678", llm=llm)
    sent = json.dumps(client.requests[0]["messages"], ensure_ascii=False)
    assert "1234-5678" not in sent and "1234-5678" not in json.dumps(r, ensure_ascii=False)


def test_사용자가_있으면_그_사람_금액(svc):
    r = svc.classify_place("스타벅스", user_id=1, at=at(month=11, day=5))
    assert isinstance(r["amount_hint"], int) and r["amount_hint"] > 0 and isinstance(r["ms"], int)


# ---------- Task 3: API 와 일정 브랜드 저장 ----------

AT_Q = {"at": "2026-11-05T09:00:00+09:00"}


@pytest.fixture
def client(svc):
    from fastapi.testclient import TestClient
    from engine.api import create_app
    with TestClient(create_app(svc, chat_client=None)) as c:
        yield c
        c.put("/internal/users/1/schedules/2026-11-05", params=AT_Q, json={"items": []})


def _item(**kw):
    return {"start": "14:00", "end": "15:00", "category": "CAFE", "amount": 6000, **kw}


def test_api_분류_200_빈글_422_없는사용자_404(client):
    r = client.post("/internal/places/classify", json={"text": "스타벅스"})
    assert r.status_code == 200 and r.json()["source"] == "search" and r.json()["brand"] == "스타벅스"
    r = client.post("/internal/places/classify", json={"text": "   "})
    assert r.status_code == 422 and r.json()["detail"] == "가게 이름을 입력해 주세요"
    assert client.post("/internal/places/classify", json={"text": "스벅", "user_id": 99_999_999}).status_code == 404


def test_일정_brand_저장과_조회(client):
    r = client.put("/internal/users/1/schedules/2026-11-05", params=AT_Q, json={"items": [_item(brand="스타벅스")]})
    assert r.status_code == 200 and r.json()["items"][0]["brand"] == "스타벅스"
    got = client.get("/internal/users/1/schedules/2026-11-05")
    assert got.json()["items"][0]["brand"] == "스타벅스"


def test_브랜드_없는_예전_일정도_그대로(client):
    r = client.put("/internal/users/1/schedules/2026-11-05", params=AT_Q, json={"items": [_item()]})
    assert r.status_code == 200 and r.json()["items"][0]["brand"] is None


def test_목록_밖_brand_는_422(client):
    r = client.put("/internal/users/1/schedules/2026-11-05", params=AT_Q, json={"items": [_item(brand="없는브랜드")]})
    assert r.status_code == 422 and "알 수 없는 가맹점 브랜드" in r.json()["detail"]


# ---------- Task 4: 브랜드를 추천에 반영 ----------

from datetime import date, datetime, time  # noqa: E402
from zoneinfo import ZoneInfo  # noqa: E402

KST = ZoneInfo("Asia/Seoul")
DAY = date(2026, 11, 5)
MORNING = datetime(2026, 11, 5, 9, tzinfo=KST)


def _sched(category, brand=None, hour=14, amount=6000):
    from engine.domain import ScheduleItem
    return ScheduleItem(1, 1, datetime.combine(DAY, time(hour), KST), datetime.combine(DAY, time(hour + 1), KST),
                        category, amount, brand)


def _state(svc, when):
    return svc.build_state(svc.store.context(1, when), when)


def _scenario(svc, item):
    from engine.domain import RankRequest
    from engine.scenarios import build
    when = datetime.combine(DAY, time(item.start.hour, 5), KST)
    st = _state(svc, when)
    sset = build(st, RankRequest(1, when), svc.engine.catalog, svc.engine.priors, svc.engine.params, None, None, [item])
    return st, sset


def test_브랜드_일정은_그_브랜드_확률_1(svc):
    st, sset = _scenario(svc, _sched("CONVENIENCE", "CU"))
    assert "CU" in st.relevant_brands
    s = sset.scenarios[0]
    assert s.brands == {"CU": 1.0} and s.promo_brands == {"CU": 1.0}


def test_내_카드와_무관한_브랜드는_혜택_계산에서_None_행사_계산은_그대로(svc):
    st0 = _state(svc, MORNING)
    other = sorted(m.brand_code for m in svc.engine.catalog.merchants.values()
                   if m.category == "CAFE" and m.brand_code and m.brand_code not in st0.relevant_brands)[0]
    st, sset = _scenario(svc, _sched("CAFE", other))
    assert other not in st.relevant_brands
    s = sset.scenarios[0]
    assert s.brands == {None: 1.0} and s.promo_brands == {other: 1.0}


def test_팝업_행사는_일정_브랜드만(svc):
    from engine.popup import promotion_offers
    st = _state(svc, MORNING)
    promos = svc._all_promotions(svc.store.context(1, MORNING))
    hollys = promotion_offers(st, [_sched("CAFE", "할리스커피")], promos, MORNING, svc.engine.params)   # 행사 이름은 '할리스'
    assert hollys and {o.brand for o in hollys} == {"할리스"}
    assert promotion_offers(st, [_sched("CAFE", "스타벅스")], promos, MORNING, svc.engine.params) == []


def test_추천_페이지는_일정_브랜드로_계산(svc):
    svc.put_schedule(1, DAY, [{"start": time(14), "end": time(15), "category": "CAFE", "amount": 6000,
                               "brand": "메가MGC커피"}], MORNING)
    try:
        page = svc.recommendation_page(1, MORNING, None)
        offers = (page["merchant"] or {}).get("offers", [])
        assert offers and {o["brand"] for o in offers} == {"메가MGC커피"}
        for i in (page["card"] or {}).get("items", []):
            if i["category"] == "CAFE":
                assert i["brand"] == "메가MGC커피"
    finally:
        svc.put_schedule(1, DAY, [], MORNING)


# ---------- 평가에서 찾은 검색 버그 (2026-11-23): 업종 이름 부분 일치로 업종을 확정하지 않는다 ----------

@pytest.mark.parametrize("text, wrong", [("동물병원", "HOSPITAL"), ("집", "CHILDCARE"), ("신세게백화점", "DEPARTMENT_STORE")])
def test_업종_이름이_일부만_겹치면_검색으로_확정하지_않음(catalog, text, wrong):
    from engine.place import match_place
    m = match_place(text, catalog)
    assert m.category is None and m.brand is None


# ---------- 평가에서 찾은 틀린 브랜드 2건 (2026-11-23 실제 OpenAI) ----------

def test_검색이_여러_브랜드를_찾으면_OpenAI_로_하나를_고르지_않음(svc):
    llm, client = _llm([_answer("CONVENIENCE", "GS25")])
    r = svc.classify_place("GS", llm=llm)
    assert r["category"] is None and r["brand"] is None and client.requests == []
    assert {c["brand"] for c in r["candidates"]} >= {"GS25", "GS칼텍스"}


def test_OpenAI_브랜드가_글과_닮지_않으면_브랜드는_버림(svc):
    llm, _ = _llm([_answer("CAFE", "스타벅스")])
    r = svc.classify_place("커피 한 잔", llm=llm)
    assert (r["category"], r["brand"], r["source"]) == ("CAFE", None, "llm")


@pytest.mark.parametrize("text, brand", [("스타벅쓰", "스타벅스"), ("올영", "올리브영"), ("맥날", "맥도날드"),
                                         ("파바", "파리바게뜨"), ("투썸", "투썸플레이스")])
def test_오타_줄임말은_닮았으면_브랜드_유지(svc, text, brand):
    category = {"스타벅스": "CAFE", "올리브영": "HNB", "맥도날드": "FAST_FOOD", "파리바게뜨": "BAKERY", "투썸플레이스": "CAFE"}[brand]
    llm, _ = _llm([_answer(category, brand)])
    assert svc.classify_place(text, llm=llm)["brand"] == brand


# ---------- 최종 검토 수정 (2026-11-23) ----------

@pytest.mark.parametrize("text", ["멜론 빙수", "웨이브 펌", "outback", "flower", "biscuit", "kt wiz 야구"])
def test_짧은_브랜드가_글에_들어_있기만_하면_검색으로_확정하지_않음(catalog, text):
    from engine.place import match_place
    m = match_place(text, catalog)
    assert m.brand is None and m.exact is False


def test_브랜드를_품은_글은_후보로만_두고_OpenAI_가_확정(svc, catalog):
    from engine.place import match_place
    m = match_place("스타벅스 강남", catalog)
    assert m.brand is None and m.exact is False and "스타벅스" in {c["brand"] for c in m.candidates}
    llm, client = _llm([_answer("CAFE", "스타벅스")])
    r = svc.classify_place("스타벅스 강남", llm=llm)
    assert (r["category"], r["brand"], r["source"]) == ("CAFE", "스타벅스", "llm") and len(client.requests) == 1


def test_OpenAI_업종과_브랜드가_맞지_않으면_브랜드는_버림(svc):
    llm, _ = _llm([_answer("CAFE", "올리브영")])
    r = svc.classify_place("올리브엉 앞 카페", llm=llm)
    assert (r["category"], r["brand"]) == ("CAFE", None)


def test_업종과_맞지_않는_brand_일정은_422(client):
    r = client.put("/internal/users/1/schedules/2026-11-05", params=AT_Q, json={"items": [_item(category="FUEL", brand="스타벅스")]})
    assert r.status_code == 422 and "업종과 맞지 않는" in r.json()["detail"]


def test_OpenAI_가_JSON_객체가_아닌_답을_주면_none(svc):
    llm, _ = _llm(["[1, 2]"])
    assert svc.classify_place("필라테스 센터", llm=llm)["source"] == "none"


@pytest.mark.parametrize("text, category", [("카페", "CAFE"), ("커피", "CAFE"), ("주유소", "FUEL")])
def test_여러_브랜드가_한_업종이면_업종은_정함(svc, text, category):
    llm, client = _llm([])
    r = svc.classify_place(text, llm=llm)
    assert (r["category"], r["brand"], r["source"]) == (category, None, "search") and client.requests == []
