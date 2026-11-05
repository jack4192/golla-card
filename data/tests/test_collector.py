"""수집기 단위 테스트 (네트워크 없이)."""

import urllib.robotparser

from bs4 import BeautifulSoup

from collector.discover import _canonical
from collector.parse import _annual_fee, _card_type, _headlines, _name
from collector.schema import CardExtract
from collector.structure import _repair
from collector.web import Web


def test_연회비_메뉴글자와_혜택문구는_건너뜀():
    text = "연회비 SMS서비스이용 금융거래 수수료\n연회비 면제 서비스 제공\n연회비 안내 5,000원(모바일단독: 1,000원)"
    assert _annual_fee(text)[0] == 5000


def test_연회비_없음은_0():
    assert _annual_fee("연회비 없음 후불교통 사용 가능")[0] == 0


def test_연회비_못읽으면_None():
    assert _annual_fee("혜택 안내만 있는 페이지") == (None, None)


def test_카드명_제목_마지막_토막과_일반명_건너뛰기():
    soup = BeautifulSoup("<title>토스뱅크 | 토스뱅크 체크카드</title><h1 class='tit'>카드</h1>", "html.parser")
    assert _name(soup, "", ["selector:h1.tit", "title_last"]) == "토스뱅크 체크카드"


def test_카드종류_주소우선_없으면_이름으로_추정():
    rule = {"from_url": {"/apply/check/": "check"}}
    assert _card_type("https://x/apply/check/1_2.html", "아무 카드", rule) == ("check", False)
    assert _card_type("https://x/detail?id=1", "노리2 체크카드", None) == ("check", True)
    assert _card_type("https://x/detail?id=1", None, None) == (None, True)


def test_대표혜택_문구():
    text = "카드 소개\nDAY 10% 결제일 할인 : 카페 / 음식점\n유의사항 전문\n월 최대 5천원 캐시백"
    assert _headlines(text) == ["DAY 10% 결제일 할인 : 카페 / 음식점", "월 최대 5천원 캐시백"]


def test_상품id와_표준주소():
    cfg = {"id_pattern": r"cooperationcode=(\d+)",
           "url_template": "https://card.kbcard.com/CRD/DVIEW/HCAMCXPRICAC0076?mainCC=a&cooperationcode={id}"}
    pid, url = _canonical(cfg, "https://card.kbcard.com/CRD/DVIEW/HCAMCXPRICAC0076?cooperationcode=01142&x=1")
    assert pid == "01142" and url.endswith("cooperationcode=01142")
    assert _canonical(cfg, "https://card.kbcard.com/other") is None


def test_robots_불허_주소는_허용하지_않음():
    web = Web("solpay-test", 0)
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(["User-agent: *", "Disallow: /mob/"])
    web._robots["https://www.example.com"] = rp
    web._robots["https://down.example.com"] = None      # robots.txt 응답 없음
    try:
        assert web.allowed("https://www.example.com/pconts/a.html")
        assert not web.allowed("https://www.example.com/mob/list.ajax")
        assert not web.allowed("https://down.example.com/a.html")
    finally:
        web.close()


def test_숫자_반복_복구():
    data = {"benefits": [], "cap_groups": [{"code": "T", "description": "", "tiers": [
        {"min_prev_spend": 400000, "max_prev_spend": 10**18, "cap_amount": 5000},
        {"min_prev_spend": 800000, "max_prev_spend": None, "cap_amount": 10000}]}]}
    warnings = _repair(data)
    assert data["cap_groups"][0]["tiers"][0]["max_prev_spend"] == 800000
    assert len(warnings) == 2
    CardExtract.model_validate(data)
