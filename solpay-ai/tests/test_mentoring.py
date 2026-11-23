"""2026-11-14 멘토링 반영: 일정 암호화·당일 삭제, 외부 AI 개인정보 차단, 신규 카드 추천."""

from datetime import date, datetime, timedelta

import pytest
from cryptography.fernet import Fernet

from engine.crypto import DataCipher, MissingKey, load_cipher
from engine.domain import ScheduleItem
from engine.privacy import llm_view, redact
from engine.recommend import missed_benefit, recommend
from tests.conftest import KST, at, pay


# ---------- 암호화 ----------
def test_일정은_암호문으로_저장되고_같은_키로만_풀린다():
    cipher = DataCipher(Fernet.generate_key())
    token = cipher.encrypt({"items": [{"category": "VET_HOSPITAL", "amount": 300000}]})
    assert b"VET_HOSPITAL" not in token and b"300000" not in token
    assert cipher.decrypt(token)["items"][0]["amount"] == 300000
    with pytest.raises(ValueError):
        DataCipher(Fernet.generate_key()).decrypt(token)


def test_키가_없으면_저장하지_않고_오류를_낸다(monkeypatch):
    for name in ("SOLPAY_DATA_KEY", "SOLPAY_DATA_KEY_ENCRYPTED", "SOLPAY_KMS_KEY_ID"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(MissingKey):
        load_cipher()
    monkeypatch.setenv("SOLPAY_DATA_KEY", Fernet.generate_key().decode())
    assert load_cipher().decrypt(load_cipher().encrypt({"a": 1})) == {"a": 1}


def test_지난_날의_일정은_지운다():
    from engine.store import ParquetStore
    store = ParquetStore.__new__(ParquetStore)
    store.users = {1: object()}
    store.schedule_items = {}
    item = ScheduleItem(1, 1, at(10, 6, 12), at(10, 6, 13), "CAFE", 5000)
    store.schedule_items[(1, date(2026, 10, 6))] = [item]
    store.schedule_items[(1, date(2026, 10, 7))] = [item]
    assert store.purge_schedules(date(2026, 10, 7)) == 1
    assert list(store.schedule_items) == [(1, date(2026, 10, 7))]


# ---------- 외부 AI 로 보내기 전 ----------
def test_문장_속_개인정보를_가린다():
    text = "카드 1234-5678-9012-3456 이고 010-1234-5678, a.b@ex.com, 900101-1234567"
    out = redact(text)
    for secret in ("1234-5678-9012-3456", "010-1234-5678", "a.b@ex.com", "900101-1234567"):
        assert secret not in out
    assert "[카드번호]" in out and "[전화번호]" in out


def test_외부_AI에는_허용한_항목만_보낸다():
    view = llm_view({"user_id": 7, "masked_number": "****-1234", "cards": [{"name": "신한 Simple Plan", "perf": 300000,
                                                                          "user_card_id": 101}]})
    assert view == {}                                     # cards 키도 허용 목록에 없으면 통째로 빠진다
    assert llm_view([{"name": "신한 Simple Plan", "perf": 300000, "user_card_id": 101}]) == \
        [{"name": "신한 Simple Plan", "perf": 300000}]


# ---------- 신규 카드 추천 ----------
def _ready(state):
    state.roll_to("2026-10")
    return state


def test_일정의_특수_고액_결제는_그_한_번에서_3천원_이상_이득이면_추천한다(state, params):
    item = ScheduleItem(1, 1, at(10, 7, 12), at(10, 7, 14), "CVS", 1_000_000)
    rec = recommend(_ready(state), [], [item], [], at(10, 7, 8), params.with_(special_categories=("CVS",)))
    assert rec is not None and rec.trigger == "schedule" and rec.card_id == 4      # 무실적 0.5% 카드
    assert rec.gain == 5_000 and "편의점" in rec.reason


def test_같은_업종_반복이면_그_업종_카드를_추천한다(state, params):
    rows = [pay(101, 50_000, "CVS", at(10, d, 12)) for d in (3, 4, 5, 6)]
    for p in rows:
        state.apply(p)
    rec = recommend(state, rows, [], [], at(10, 7, 8), params.with_(recommend_min_monthly=0))
    assert rec is None or rec.trigger in ("repeat", "regular")


def test_하루에_한_번까지_같은_카드는_2주_동안_다시_추천하지_않는다(state, params):
    item = ScheduleItem(1, 1, at(10, 7, 12), at(10, 7, 14), "CVS", 1_000_000)
    p = params.with_(special_categories=("CVS",))
    assert recommend(_ready(state), [], [item], [{"at": at(10, 7, 0), "card_id": 9}], at(10, 7, 8), p) is None
    assert recommend(state, [], [item], [{"at": at(10, 1, 0), "card_id": 4}], at(10, 7, 8), p) is None
    assert recommend(state, [], [item], [{"at": at(9, 24, 0), "card_id": 4}], at(10, 7, 8), p) is None          # 13일 8시간 전
    assert recommend(state, [], [item], [{"at": at(9, 23, 0), "card_id": 4}], at(10, 7, 8), p) is not None      # 14일 8시간 전
    assert recommend(state, [], [item], [{"at": at(9, 1, 0), "card_id": 4}], at(10, 7, 8), p) is not None


def test_연말정산_놓친_혜택은_기존_카드의_구간을_지키는_만큼만_옮긴다(state):
    """1번 카드는 매달 40만 원으로 30만 원 구간을 넘는다. 새 카드(0.5%)로 옮길 수 있는 건 구간을 지키고 남는 10만 원뿐."""
    rows = [pay(101, 100_000, "CVS", at(m, d, 12)) for m in (7, 8, 9, 10) for d in (10, 11, 12, 13)]
    out = missed_benefit(state, rows, swap=False)                       # 함께 썼다고 보는 계산만
    card4 = next(m for m in out if m["card_id"] == 4)
    assert card4["months"] == 3 and card4["gain"] == 3 * 500           # 첫 달은 실적만, 이후 매달 10만 원 × 0.5%


# 2026-11-19 사용자 결정: 가진 카드 하나를 그 신한카드로 바꿨다고 보는 계산도 하고 큰 쪽을 쓴다. 문구는 정해진 틀.
def _year_rows(extra=()):
    rows = [pay(101, 100_000, "CVS", at(m, d, 12)) for m in (7, 8, 9, 10) for d in (10, 11, 12, 13)]
    for card, amount, category in extra:
        rows += [pay(card, amount, category, at(m, 20, 12)) for m in (7, 8, 9, 10)]
    return rows


def test_연말정산은_가진_카드를_바꿨다고_보는_경우도_계산한다(state):
    """카드 셋을 모두 쓴다. 어느 카드를 바꿔도 합이 같으면 가장 덜 쓰던 카드(103, 월 2천 원)를 바꾼 것으로 본다."""
    rows = _year_rows([(102, 10_000, "REST"), (102, 10_000, "REST"), (103, 2_000, "TRANSIT")])
    card4 = next(m for m in missed_benefit(state, rows) if m["card_id"] == 4)
    assert card4["basis"] == "swap" and card4["replaces_user_card_id"] == 103 and card4["replaces"] == "국민 교통"
    assert card4["gain"] == 3 * (4 * 500 + 2 * 50 + 10)                # 모든 결제 × 0.5%, 10원 미만 버림 (함께 쓰기는 1,500원)
    assert card4["message"] == "그때 국민 교통 대신 이 카드를 쓰셨다면 3개월 동안 6,330원을 더 받으셨어요"


def test_쓰지_않던_카드를_바꾼_셈이면_발급받았다면으로_말한다(state):
    card4 = next(m for m in missed_benefit(state, _year_rows()) if m["card_id"] == 4)
    assert card4["basis"] == "add" and card4["replaces"] is None and card4["gain"] == 3 * 4 * 500
    assert card4["message"] == "그때 이 카드를 발급받으셨다면 3개월 동안 6,000원을 더 받으셨어요"


def test_연말정산_문구는_12개월이면_1년이라고_한다():
    from engine.recommend import missed_message
    item = {"basis": "add", "replaces": None, "months": 12, "gain": 95_333}
    assert missed_message(item) == "그때 이 카드를 발급받으셨다면 1년 동안 95,333원을 더 받으셨어요"


# 2026-11-21: 추천 페이지가 오늘 더 주는 카드만 1년 계산을 한다
def test_연말정산_계산은_고른_카드만_할_수_있다(state):
    rows = _year_rows()
    everything = missed_benefit(state, rows)
    assert len(everything) > 0 and missed_benefit(state, rows, only={4}) == [m for m in everything if m["card_id"] == 4]
    assert missed_benefit(state, rows, only=set()) == []


def test_표시_순서가_같고_쓰지_않은_카드가_둘이어도_계산한다(catalog, params):
    """user_card_details 행이 없는 카드는 표시 순서가 모두 99 다. 바꿀 카드를 고를 때 순서까지 같으면 카드 번호로 정한다."""
    from engine.domain import User, UserCard
    from engine.state import UserState
    cards = [UserCard(101, 1, "SHINHAN", 99), UserCard(102, 2, "SHINHAN", 99), UserCard(103, 3, "KB", 99)]
    card4 = next(m for m in missed_benefit(UserState(User(1), cards, catalog, params), _year_rows()) if m["card_id"] == 4)
    assert card4["gain"] == 3 * 4 * 500 and card4["basis"] == "add"


# 2026-11-24 연말 결산: 센 첫 달을 정하면 앞 달 결제는 실적만 쌓고 그 달부터 센다
def _cvs(months, amount=100_000):
    return [pay(101, amount, "CVS", datetime(y, m, d, 12, tzinfo=KST)) for (y, m) in months for d in (10, 11, 12, 13)]


def test_센_첫_달을_주면_앞_달은_실적만_쌓는다(state):
    rows = _cvs([(2026, m) for m in (6, 7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7)) if m["card_id"] == 4)
    assert card4["months"] == 4 and card4["gain"] == 4 * 500


def test_센_첫_달_앞에_결제가_없어도_그_달부터_센다(state):
    rows = _cvs([(2026, m) for m in (7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7)) if m["card_id"] == 4)
    assert card4["months"] == 4 and card4["gain"] == 4 * 500         # 기본(첫 달은 준비)이면 3개월 1,500원


def test_달_수를_주면_그_달_수로_말한다(state):
    rows = _cvs([(2026, m) for m in (7, 8, 9, 10)])
    card4 = next(m for m in missed_benefit(state, rows, swap=False, count_from=(2026, 7), months=5) if m["card_id"] == 4)
    assert card4["months"] == 5
    assert card4["message"] == "그때 이 카드를 발급받으셨다면 5개월 동안 2,000원을 더 받으셨어요"


def test_센_첫_달부터_결제가_없으면_빈_목록이다(state):
    assert missed_benefit(state, _cvs([(2026, 7)]), count_from=(2026, 8)) == []
