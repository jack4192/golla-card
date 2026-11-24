# 맞춤 추천 바로잡기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (사용자가 '여기서 바로' 선택). Steps use checkbox (`- [ ]`) syntax.

**Goal:** 맞춤 추천 페이지에서 다음 세 가지를 바꾼다.
- 일정 업종 전용 혜택이 있는 신한카드를 금액과 상관없이 먼저 추천한다.
- 관련 카드가 없을 때만 일반 카드를 '전용 혜택 아님'으로 밝혀 추천한다. 이때 보유 카드도 후보 브랜드에서 비교한다.
- 문구는 정해진 틀로 쓰고(빠르게), 맞는 행사가 없으면 받을 수 있는 행사 1건을 무작위로 보여 준다.

**Architecture:** 엔진(engine/page.py·popup.py·chat/page_copy.py·api.py·params.py)이 고르고 쓴다. 앱은 `aiRecommendCore.toPromotionOffer`가 무작위 행사를 표시한다. 백엔드는 바뀌지 않는다.

**Tech Stack:** Python FastAPI(pytest), Expo(node --test)

**Spec:** `/Users/jinwoo/Desktop/solpay/docs/superpowers/specs/2026-11-24-movie-card-random-promo-design.md`

## Global Constraints
- 테스트 명령:
  - 엔진: `cd ~/Desktop/solpay/solpay-ai && .venv/bin/python -m pytest -q`
  - 앱: `cd ~/Desktop/solpay-final/frontend && node --test utils/__tests__/*.test.mjs`
- 새 설정:
  - `Params.page_related_first = True`: False면 예전 고르기 방식이다(관련 카드 먼저와 보유 카드 브랜드 비교를 둘 다 끈다).
  - `Params.page_random_promotions = 1`
  - 환경 변수 `SOLPAY_PAGE_COPY_LLM=1`일 때만 추천 페이지가 OpenAI를 쓴다.
- 문구(그대로 쓴다):
  - 일반 카드 이유 첫 줄: '{업종 짧은 이름} 전용 혜택은 아니에요'
  - 일반 카드 요약: '오늘 {시}시 {업종} 일정에 쓸 {업종} 전용 혜택은 없지만, {키워드}{을/를} 받을 수 있어요.' (평소 소비면 '평소 {시}시쯤 {업종} 결제에 쓸 …')
  - 조건 금액 줄: '{HH:MM} {업종} {금액}원 이상 결제 시 → {혜택}원 {종류}'
  - 무작위 행사:
    - 제목: '오늘 진행 중인 행사예요'
    - 요약: '오늘 일정에 맞는 행사가 없어 지금 진행 중인 {이름} 행사를 보여드려요.'
    - 금액 줄: '{이벤트|마이샵} {benefit_text}'
    - 이유: [행사 이름, '{M}월 {D}일까지 · {카드}로 결제']
    - 앱 기본 이유: '오늘 진행 중인 행사예요.'
- 커밋·푸시는 사용자가 요청할 때만 한다. 다른 세션 파일은 건드리지 않는다. 사용자 서버(8031·8090·8081)는 끄지 않는다.

## Review Focus
- 일정에 브랜드를 직접 넣었는데(예: '스타벅스') 후보 카드가 다른 브랜드에만 혜택을 주면 관련 카드가 아니다.
- 관련 혜택이 시간·요일 조건 때문에 그 일정 시각에 0원이면 관련 카드가 아니다(일반 혜택으로 바뀌지 않게, 돌려받은 혜택이 전용 혜택일 때만).
- 관련 카드의 1년 계산이 손해면 빠지고, 그다음은 일반 카드 단계다.
- 무작위 행사는 결제 화면 팝업(item_id ≤ 0 제외)에 섞이지 않는다.
- 3일 카드날 규칙(page_card_every_time=False)에서 '행사가 없으면 카드'(FALLBACK)는 무작위 행사가 생겨도 그대로다.

---

### Task 1: 관련 업종 카드 먼저 + 보유 카드 브랜드 비교 (page.py, params.py)
- `CardPickItem.at_least: bool = False`, `CardPick.related: bool = False`.
- `_related_row(state, card, item, usual, owned) -> CardPickItem | None`:
  - 브랜드: item.brand가 있으면 그것만 본다. 없으면 [usual]이 카드가 덮는 브랜드일 때 그것, 아니면 카드가 덮는 브랜드, 그것도 없으면 [None].
  - 금액: max(일정 금액, 그 업종 관련 혜택의 최소 결제 금액).
  - evaluate가 돌려준 혜택이 업종 전용(`benefit_keyword` specific)이고 0원보다 클 때만 쓴다. 혜택이 가장 큰 경우를 고른다.
- `pick_card`: page_related_first면 관련 카드를 모으고, 1년 이득 > 0 필터 → (1년 이득 큰 순, 혜택 합 큰 순, card_id)로 고른다. 1년 계산이 없으면 (혜택 합 큰 순, 연회비, card_id). 남는 카드가 없으면 예전 방식으로 간다. 예전 방식에서 브랜드가 없으면 보유 카드 브랜드도 합친다.
- `to_dict`:
  - card에 related를, items에 at_least를 싣는다.
  - show_amount는 related면 대표 항목 value, 아니면 gain으로 정한다.
- 테스트(test_recommendation_page.py, 영화 카탈로그 픽스처):
  - `test_관련_업종_카드는_금액_조건과_보유_카드에_상관없이_추천한다`: 10,500원 → 카드 10, amount 12,000, at_least, value 5,000, related
  - `test_관련_카드가_없으면_보유_카드가_후보_브랜드에서_더_주는_일반_카드는_뺀다`: 새 방식은 None, page_related_first=False면 일반 카드 12
  - `test_직접_넣은_브랜드에_혜택이_없으면_관련_카드가_아니다`
  - `test_관련_카드도_1년_손해면_뺀다`(yearly_gains를 monkeypatch)

### Task 2: 정해진 틀 문구 + 일반 카드 밝히기 + '이상' 줄 (page_copy.py, api.py)
- api lifespan: `page_writer = PageCopyWriter(...)` if `SOLPAY_PAGE_COPY_LLM == "1"` else None.
- facts_of:
  - card에 `general`(대표 항목 specific 아님)과 `category_short`를 싣는다.
  - items에 `at_least`를 싣는다.
  - extra·extra_today는 0원보다 클 때만 넣는다.
- amount_line은 at_least를 반영한다. fixed_reasons는 general이면 첫 줄을 넣는다(4줄 유지, 조건 줄은 남김). template_copy의 요약은 general이면 바꾼다.
- 테스트:
  - `test_일반_카드는_업종_전용_혜택이_아니라고_밝힌다`
  - `test_조건_금액으로_계산한_항목은_이상으로_쓴다`
  - `test_추천_페이지_문구는_기본이_정해진_틀이다`(FakeClient가 있어도 template)
  - 기존 `test_추천_페이지_API`는 env를 켜고 그대로 둔다.

### Task 3: 무작위 행사 1건 (popup.py, page.py, service.py, page_copy.py)
- `PromotionOffer`에 `related: bool = True`, `benefit_text: str = ""`, `until: date | None = None`를 더한다. to_dict는 related False면 window_from/to를 None으로, until을 iso로 쓴다.
- `random_offer(state, promotions, at, params, excluded) -> PromotionOffer | None`:
  - 후보 조건: 신한카드(제외 규칙 밖), shown, needs_check 아님, 아는 가맹점, 금액 max(min_amount, 10,000)에서 promo.value > 0
  - 고르기: (promotion_id 순) `random.Random(f"{user_id}:{date}")`.choice
  - item_id 0, start=end=at
- build_page: 카드를 먼저 정한 뒤 offers가 비었으면 무작위 1건을 넣는다.
- service: writer가 있고 무작위 행사면 LLM에는 merchant=None 사실만 보내고, merchant 문구는 template으로 붙인다.
- facts_of의 merchant offers에 related·benefit_text·until을 싣는다. template_copy는 무작위 문구를 쓴다.
- 테스트:
  - `test_맞는_행사가_없으면_받을_수_있는_행사_1건을_무작위로`
  - `test_무작위_행사는_같은_날_같은_행사`
  - `test_무작위_행사는_받을_수_없거나_확인이_필요한_행사를_뺀다`
  - `test_일정_행사가_있으면_무작위를_섞지_않는다`
  - `test_무작위_행사_문구는_정해진_틀`
  - `test_무작위_행사는_결제_화면에_쓰지_않는다`
  - `test_카드날_규칙에서_행사가_없으면_카드는_그대로`

### Task 4: 앱 표시 (aiRecommendCore.js)
- `toPromotionOffer`: related === false면 start/end null, note에 '{M}월 {D}일까지', 기본 이유 '오늘 진행 중인 행사예요.'
- 테스트: aiRecommendCore.test.mjs `무작위 행사는 시간 없이 끝 날짜를 보여준다`.

### Task 5: 표본·시간·화면 확인
- category_audit(같은 65명 × 44업종)으로 새 방식과 예전 방식(page_related_first False)을 비교한다: 카드 탭 수, 일반 카드 비율, 관련 카드 비율.
- 정해진 틀로 추천 페이지 시간을 잰다(test3·test1).
- 확인용 포트(8041·8099·19016)에서 test3 영화관 화면을 본다. 확인 뒤 끈다.

### Task 6: 전체 검토(새 검토자) → 고치기
