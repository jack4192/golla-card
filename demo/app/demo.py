"""시연 설정: 데모 사용자, 시연 시각, 동네 이름, 일정 업종. 가상 데이터의 데모 사용자 5명과 같다.

동네(zones)는 가상 POS 의 가맹점 목록을 묶어 보여 줄 때만 쓴다 (2026-11-14 부터 위치는 추천에 쓰지 않는다).
"""

ZONES = {
    "BANGBAE": "방배", "GANGNAM": "강남역", "SEONGSU": "성수", "SILLIM": "신림", "SINCHON": "신촌",
    "HONGDAE": "홍대", "JEONGJA": "정자", "PANGYO": "판교", "MANGWON": "망원", "GASAN": "가산디지털단지",
    "YEONNAM": "연남",
}

USERS = [
    {"user_id": 1, "name": "데모 사용자 1", "desc": "30대 직장인 · 방배 거주, 강남역 출근",
     "zones": [("GANGNAM", "회사"), ("BANGBAE", "집"), ("SEONGSU", "주말")]},
    {"user_id": 2, "name": "데모 사용자 2", "desc": "20대 대학생 · 신림 거주, 신촌 통학",
     "zones": [("SINCHON", "학교"), ("SILLIM", "집"), ("HONGDAE", "주말")]},
    {"user_id": 3, "name": "데모 사용자 3", "desc": "50대 · 정자 거주, 동네 소비 중심",
     "zones": [("JEONGJA", "집")]},
    {"user_id": 4, "name": "데모 사용자 4", "desc": "20대 야간형 · 망원 거주, 가산 출근",
     "zones": [("GASAN", "회사"), ("MANGWON", "집")]},
    {"user_id": 5, "name": "데모 사용자 5", "desc": "30대 재택근무 · 연남 거주",
     "zones": [("YEONNAM", "집")]},
]

# 가상 데이터는 2026-11-05 10:00 까지 있다. 그 뒤 시각은 시연에서 쌓는 결제로 이어진다.
TIMES = [
    {"label": "목 08:00 아침 알림", "at": "2026-11-05T08:00:00+09:00"},
    {"label": "목 08:10 출근길", "at": "2026-11-05T08:10:00+09:00"},
    {"label": "목 12:20 점심", "at": "2026-11-05T12:20:00+09:00"},
    {"label": "목 19:10 퇴근 후", "at": "2026-11-05T19:10:00+09:00"},
    {"label": "토 14:30 주말 오후", "at": "2026-11-07T14:30:00+09:00"},
    {"label": "11/30(월) 12:20 월말 점심", "at": "2026-11-30T12:20:00+09:00"},
]
DEFAULT_TIME = TIMES[2]["at"]

ISSUER_COLORS = {"SHINHAN": "#2f5bea", "KB": "#c58b00", "HANA": "#009490", "NH": "#1e9e4a",
                 "LOTTE": "#d9333f", "BC": "#e2603b"}

# 금액 입력칸의 기본값 (실제 53개 업종 코드)
TYPICAL_AMOUNT = {"CAFE": 5500, "BAKERY": 8000, "CONVENIENCE": 4800, "RESTAURANT": 13000, "FAST_FOOD": 9000,
                  "HEALTHY_FOOD": 9500, "MART": 60000, "SUPERMARKET": 30000, "FUEL": 60000, "MOVIE": 15000,
                  "BOOKSTORE": 18000, "HNB": 20000, "GENERAL_GOODS": 10000, "DEPARTMENT_STORE": 80000, "OUTLET": 70000,
                  "HOSPITAL": 30000, "PHARMACY": 12000, "EDUCATION": 250000, "STUDY_ROOM": 8000, "STATIONERY": 6000,
                  "PHOTO_BOOTH": 5000, "BEAUTY_SALON": 30000, "FITNESS": 60000, "PARKING": 4000, "EYEWEAR": 80000,
                  "AMUSEMENT_PARK": 55000, "PET": 80000, "GOLF": 200000, "OTHER": 150000, "EV_CHARGING": 20000,
                  "INTERCITY_TRANSIT": 40000, "TAXI": 12000}

# 하루 일정 입력칸의 업종 (최종 카드 DB 업종 코드, 현장 결제만. 평소와 다른 고액 결제를 앞에 둔다)
SCHEDULE_CATEGORIES = [
    ("PET", "동물병원"), ("GOLF", "골프장·골프연습장"), ("OTHER", "차량 정비·기타"), ("FUEL", "주유소"),
    ("EV_CHARGING", "전기차 충전"), ("INTERCITY_TRANSIT", "KTX·고속버스"), ("DEPARTMENT_STORE", "백화점"),
    ("OUTLET", "아울렛"), ("AMUSEMENT_PARK", "놀이공원"), ("EYEWEAR", "안경점"), ("HOSPITAL", "병원"), ("PHARMACY", "약국"),
    ("RESTAURANT", "음식점"), ("FAST_FOOD", "패스트푸드"), ("CAFE", "카페"), ("BAKERY", "베이커리"), ("CONVENIENCE", "편의점"),
    ("MART", "대형마트"), ("SUPERMARKET", "슈퍼마켓"), ("HNB", "올리브영"), ("GENERAL_GOODS", "다이소"), ("MOVIE", "영화관"),
    ("BEAUTY_SALON", "미용실"), ("FITNESS", "운동·레저"), ("BOOKSTORE", "서점"), ("EDUCATION", "학원"), ("PARKING", "주차"),
    ("TAXI", "택시"),
]

# 가맹점 목록에서 자주 쓰는 업종을 먼저 보여 준다
CATEGORY_ORDER = {c: i for i, c in enumerate(
    ["RESTAURANT", "CAFE", "CONVENIENCE", "FAST_FOOD", "BAKERY", "HEALTHY_FOOD", "MART", "SUPERMARKET", "HNB",
     "GENERAL_GOODS", "HOSPITAL", "PHARMACY", "MOVIE", "BOOKSTORE", "DEPARTMENT_STORE", "OUTLET", "STUDY_ROOM",
     "PHOTO_BOOTH", "STATIONERY", "BEAUTY_SALON", "FITNESS", "EYEWEAR", "PARKING", "FUEL", "EDUCATION",
     "AMUSEMENT_PARK", "PET", "GOLF", "OTHER"])}

MODE_LABELS = {
    "schedule": "오늘 일정에 맞춤", "repeat": "평소 이 시간대 소비", "time": "시간대별 소비 확률",
    "forced": "사용자 규칙", "fallback": "AI 응답 없음", "promotion_card": "일정 프로모션",
}

# 실적 채우기 방식 (설계서 v4.1 3단계)
STRATEGY_LABELS = {
    "first_tier": "① 모든 카드의 첫 구간부터", "main_top": "② 주력 카드의 높은 구간부터",
    "value": "③ 예산 안에서 가장 이득인 조합", "none": "④ 실적 채우지 않기", "top_tier": "1번 카드의 최고 구간부터",
}


def user(user_id: int) -> dict:
    return next(u for u in USERS if u["user_id"] == user_id)


def last4(user_card_id: int) -> str:
    """가짜 끝 4자리. 실제 카드번호와 관계없다."""
    return f"{(user_card_id * 7919 + 1234) % 10000:04d}"
