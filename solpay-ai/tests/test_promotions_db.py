"""행사 목록을 DB 로 옮기기 (2026-11-23): promotions 표의 화면용 칸을 읽고, 칸이 없으면 yml 로 채운다."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from engine.team_db import CardMap, CsvSource, load_promotions, load_team

KST = ZoneInfo("Asia/Seoul")
DISPLAY = ["display_name", "benefit_type", "benefit_text", "display_start", "display_end", "payout", "pay_method",
           "note", "needs_check", "logo_url"]


class OnlyPromotionsChanged:
    """실제 팀 DB 폴더를 읽되 promotions 표의 화면용 칸만 뺀다 (마이그레이션 전 DB·예전 zip·v2 폴더와 같은 모양)."""

    def __init__(self):
        self.real = CsvSource()

    def read(self, table):
        df = self.real.read(table)
        return df.drop(columns=DISPLAY, errors="ignore") if table == "promotions" else df


def kst(month, day, hour=12):
    return datetime(2026, month, day, hour, tzinfo=KST)


def by_id(promotions):
    return {p.promotion_id: p for p in promotions}


@pytest.fixture(scope="module")
def team():
    return load_team(CsvSource())


def test_화면용_칸이_있으면_화면_이름_실제_기간_로고_확인_필요를_싣는다(team):
    ps = by_id(team.promotions)
    assert len(ps) == 29 and 30 not in ps and 31 not in ps
    assert ps[2].name == "온라인 다이소몰" and ps[2].brand == "다이소몰"        # 가맹점 찾기 이름은 그대로
    assert not ps[3].shown(kst(11, 10)) and ps[3].active(kst(11, 10))         # 다이소데이 실제 시작 11-16, 점수 기간은 2025-11-01~
    assert ps[3].shown(kst(11, 20))
    assert ps[1].logo_url == "/brand-logos/mega.png" and ps[21].name == "차앤박(CNP)"
    assert ps[5].needs_check and ps[6].needs_check and not ps[1].needs_check


def test_화면용_칸이_없으면_yml_로_확인_필요와_실제_기간을_채운다(team):
    ps = by_id(load_promotions(OnlyPromotionsChanged(), team.catalog, CardMap.load()))
    assert ps[5].needs_check and ps[6].needs_check                            # 칸이 없다고 점수에 다시 들어가면 안 된다
    assert ps[3].shown_from == datetime(2026, 11, 16, tzinfo=KST) and not ps[3].shown(kst(11, 10))
    assert ps[2].name == "온라인 다이소몰" and ps[2].logo_url is None


def test_확인_필요_행사는_점수에_들어가지_않는다(team):
    ps = by_id(team.promotions)
    mega = ps[1]
    assert mega.merchant_ids and mega.applies(next(iter(mega.merchant_ids)), "SHINHAN", 1, kst(11, 20))   # 보통 행사는 받는다
    for pid in (5, 6):
        p = ps[pid]
        merchant = next(iter(p.merchant_ids), next(iter(mega.merchant_ids)))
        assert not p.applies(merchant, "SHINHAN", 1, kst(11, 20))


def test_팀_DB_저장소는_행사_목록이_완전하다고_알린다():
    from engine.db_store import TeamDbPgStore
    from engine.team_db import TeamDbStore
    assert TeamDbStore.promotions_complete and TeamDbPgStore.promotions_complete


# ---------- 서비스: yml 합치기 그만, 챗봇 목록은 실제 기간·화면 이름 ----------

@pytest.fixture(scope="module")
def svc(tmp_path_factory):
    import os
    os.environ["SOLPAY_STORE"] = "teamdb"
    os.environ["SOLPAY_STRATEGY_DB"] = str(tmp_path_factory.mktemp("promo") / "strategy.sqlite")
    from engine.api import build_service
    return build_service()


def test_챗봇_행사_목록은_실제_기간과_화면_이름을_말한다(svc):
    from engine.chat.tools import ToolBox
    svc.store.reset()
    rows = ToolBox(svc, 1, kst(11, 23, 19)).list_promotions()["promotions"]
    ids = {r["promotion_id"] for r in rows}
    assert rows and 5 not in ids and 6 not in ids
    assert all(r["start"].startswith("2026-11-") for r in rows)                # 2025-11-01(가상 데이터 기간)이 아니라
    assert next(r for r in rows if r["promotion_id"] == 2)["brand"] == "온라인 다이소몰"
    assert all("logo_url" in r for r in rows)


def test_챗봇_행사_목록은_시작_전_행사를_뺀다(svc):
    from engine.chat.tools import ToolBox
    ids = {r["promotion_id"] for r in ToolBox(svc, 1, kst(11, 10)).list_promotions()["promotions"]}
    assert 2 in ids and 3 not in ids                                          # 다이소데이는 11-16 시작


def test_완전한_저장소에서는_yml_을_합치지_않는다(svc):
    ctx = svc.store.context(1, kst(11, 23, 19))
    ids = [p.promotion_id for p in svc._all_promotions(ctx)]
    assert len(ids) == len(set(ids)) <= 29
    assert len(svc.popup_promotions) == 29 and svc.popup_promotions[0].logo_url == "/brand-logos/mega.png"
