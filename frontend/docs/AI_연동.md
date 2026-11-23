# 앱 ↔ AI 연동 (결제 화면·챗봇·추천)

서버 모드(`EXPO_PUBLIC_API_URL` 설정)에서만 동작한다. 데모 모드는 전과 똑같다.
백엔드 쪽 설명은 `backend/docs/AI_연동.md` 에 있다.

## 어디에 붙어 있나

AI 카드 배치는 **전체 결제 화면**(`screens/PaymentScreen.js`, 화면 제목 '혜택 자세히 보기')에 붙어 있다.
하단 '결제' 탭이나 '이 카드로 결제'로 여는 QR 결제 시트(`components/QuickPaySheet.js`)에는 붙이지 않았다 (2026-11-23 결정).
시트에서 '혜택 자세히 보기'를 누르면 전체 결제 화면이 열리고, 거기서 AI 추천이 보인다.

2026-11-23 팀원 PR(jack4192/golla-card#3)을 합치면서 바뀐 것:
- 전체 결제 화면에는 QR·바코드가 없다. QR·바코드 발급과 화면 캡처 차단은 QR 결제 시트에서만 한다.
- 'AI 추천' 상자, '이 거래의 예상 혜택' 상자, '내 카드' 목록(AI 순서)은 그대로 둔다 (PR 은 지웠지만 사용자 결정으로 살림).
- '카드 선정 이유'와 '카드 상세 혜택'은 한 줄(업종·혜택) + '상세 내역 보기'로 펼치는 방식이다.
- 홈에서 카드가 있으면 '다른 카드로 변경' 대신 내 카드 목록(`PaymentCardOrder`, 누르면 결제 카드 변경, ☰ 로 순서 변경)이 보인다.

그 밖에 AI 를 쓰는 곳은 결제 화면의 '이 거래의 예상 혜택', 일정 맞춤 추천, 가입 직후 일과 맞춤 카드 추천, 홈 '오늘의 일정'의 일정별 카드다.
자세한 내용은 아래 '카드 데이터를 서버로 옮기기'의 3단계에 있다.

## 전체 결제 화면을 열면

1. AI 에 순서를 묻는다 (`POST /api/ai/rank`).
2. 서버 카드 번호로 온 순위를 지갑 카드에 맞춘다. 지갑 카드와 서버 카드 번호의 짝은 `utils/serverCards.js` 가 갖고 있다 (`serverCardLinks`).
3. AI 가 맨 앞에 둔 카드를 결제 카드로 고르고, 안내 문구를 'AI 추천' 상자에 보여 준다. 내 카드 목록도 AI 순서로 보인다.

사용자는 언제든 다른 카드로 바꿀 수 있다. 바꾼 뒤에는 AI 가 다시 바꾸지 않고, 'AI가 맨 앞에 둔 카드는 ○○예요' 와 '이 카드로 바꾸기' 만 보여 준다.

AI 가 고르지 않는 경우:

| 경우 | 동작 |
|---|---|
| 일정에서 들어온 결제 | 일정에 맞춘 카드를 유지하고 안내만 보여 준다 (일정 시간이 되기 전에 미리 열어 볼 수 있어서) |
| AI 가 답하지 못함 (`reason_code: FALLBACK`) | 지갑에서 고른 카드와 순서를 그대로 둔다 |
| 백엔드에 연결하지 못함 | 지갑 순서 그대로. 'AI 추천을 불러오지 못해…' 안내 |
| 사용자가 ☰ 로 순서를 끌어 옮김 | 그때부터 저장한 순서를 쓴다 |

## 일정이 배치에 반영되는 길

일정을 저장하면 `utils/routineData.js` 가 서버(`/api/schedules`)에 올리고, 백엔드가 장소 일정을 AI 엔진에 넘긴다.
그래서 일정 시간에 전체 결제 화면을 열면 그 업종에 맞춰 카드가 배치된다.

장소 일정의 업종은 서버 코드로 바꿔 보낸다 (`utils/scheduleCategory.js`). 앱 업종 id 를 대문자로만 바꾸면
서버에 없는 코드가 되어(버스·지하철 `transport` → `TRANSPORT`, 서버는 `TRANSIT`) 서버가 400 으로 거절하기 때문이다.

| 앱 | 서버 | 앱 | 서버 |
|---|---|---|---|
| 커피 | `CAFE` | 택시 | `TAXI` |
| 식사 | `RESTAURANT` | 편의점 | `CONVENIENCE` |
| 버스·지하철 | `TRANSIT` | 배달 | `DELIVERY` |
| 기차, 시외·고속버스 | `INTERCITY_TRANSIT` | 주유·충전 | `FUEL` |
| 여행·숙박 | `TRAVEL_AGENCY` | 쇼핑 | `ONLINE_SHOPPING` |
| 병원·약국 | `HOSPITAL` | PC방, 기타 | `OTHER` |

- 기차와 PC방은 서버에서 다른 업종과 합쳐지므로, 다시 읽을 때 구분할 수 있게 일정 이름(`기차`, `PC방`)을 함께 보낸다.
- `OTHER` 와 상황 일정(회식·반차 등)은 서버에는 저장되지만 AI 엔진에는 넘어가지 않는다 (업종을 알 수 없다).

**기준 시각 주의**: 백엔드의 `AI_FIXED_AT` 을 켜면 AI 가 그 시각으로 계산하므로, 실제 오늘 날짜로 넣은 일정은 배치에 반영되지 않는다.

## 홈 챗봇 (SOL 카드 도우미)

홈·혜택·오늘의 일정·카드 탭 오른쪽 아래 캐릭터 버튼으로 여는 챗봇이다 (`screens/MainScreen.js`).
서버 모드에서는 질문을 AI 챗봇에 보낸다 (`POST /api/ai/chat`, `screen.name` 에 지금 탭 이름, 최근 대화 4쌍).
데모 모드이거나 연결하지 못하면 앱 안의 기본 안내로 답하고 'AI 챗봇에 연결하지 못해 기본 안내로 답했어요'를 붙인다.

- AI 챗봇은 카드 혜택·결제 카드 선택 외에 **앱 사용법**과 **진행 중인 프로모션**도 답한다 (2026-11-23 결정).
  앱 사용법은 AI 엔진의 프롬프트(`solpay-ai/engine/chat/prompts.py` 의 `[앱 사용 안내]`)에 적혀 있어서,
  **앱 화면·버튼 이름을 바꾸면 그 안내도 함께 고쳐야 한다.**
- 추천 질문은 탭마다 8개 안팎이고, AI 챗봇 평가 질문에서 골라 내 카드 이름을 넣는다 (`utils/homeChat.js`).
  카드가 한 장이면 '두 번째 카드로 내면 얼마 손해야?' 같은 질문은 빠진다.
- 규칙 초안이 오면 '저장'·'취소' 버튼이 나온다. 새 답이 오면 자동으로 맨 아래로 내려간다.

## 결제 화면 카드 도우미 챗봇

전체 결제 화면의 챗봇은 질문을 AI 챗봇에 보낸다 (`POST /api/ai/chat`, 최근 대화 4개와 추천 번호를 함께). 연결하지 못하면 앱 안의 기본 안내로 답한다.
챗봇이 규칙 초안을 만들면 '저장'·'취소' 버튼이 나온다 (`/api/ai/rules/drafts/{id}/confirm`, `/cancel`).

화면의 '이 거래의 예상 혜택' 숫자는 서버 모드에서 AI 계산(`POST /api/ai/payments/evaluate`)을 쓴다.
AI 가 답하지 못하거나 데모 모드면 앱 자체 계산으로 보여 주므로, 그때는 AI 답변의 숫자와 다를 수 있다.

'이 거래의 예상 혜택'의 거래는 AI 추천 문구가 가리키는 거래다 (2026-11-23).
AI 카드 배치 응답의 `example`(업종·가게·금액·가능성)로 계산해서, 'AI 추천' 상자와 같은 가게·같은 카드를 말하게 한다.
예: "현대백화점 마이샵 15%로 약 480원…" → 상자 `현대백화점 · 77,200원`, Discount Plan 11,580원 / KB ALL 770원.

| 경우 | 상자의 거래 |
|---|---|
| AI 가 답하고 그 거래의 계산도 옴 | AI 예시 거래 (`example`) |
| 일정에서 들어온 결제 | 일정 거래 (지금처럼) |
| AI 가 기본 순서로 답함·꺼짐·데모 모드, 예시 계산 실패, 1순위 카드가 기기 지갑에 없음 | 고정 예시 '스타벅스 · 15,000원' (지금처럼) |

- 행사 문구일 때만 상자 아래에 한 줄을 붙인다: "AI 문구의 '약 480원'은 이 시간대에 결제할 만한 곳의 행사 혜택을 가능성만큼 더한 금액이에요. 현대백화점에서 결제할 가능성은 약 3%예요."
  AI 문구의 금액은 이 시간대 행사 혜택 전체(현대백화점 + 올리브영 …)의 기대 금액이라 상자 금액(그 거래 한 건)과 다르다.
- 실적을 채우려고 고른 카드면, 예시 거래에서 다른 카드가 더 유리하다고 보일 수 있다. 그때는 AI 문구("실적 달성까지 …")가 이유를 말한다.
- 상자 맨 아래 줄은 예시를 고른 근거(`example.basis`)에 따라 말한다: 행사·혜택 문구면 "AI 추천 문구가 말하는 거래로", 실적·구간 지키기처럼 문구가 거래를 말하지 않으면 "지금 시간대에 결제할 가능성이 가장 높은 거래로", 일정 프로모션 카드면 "오늘 일정에 맞춘 거래로" (`exampleBasisLine`).
- 일정 프로모션 카드 화면(일정 팝업에서 추천한 행사)은 앱 일정에 브랜드가 없어도 추천한 행사 가게로 계산한다.

## 파일

| 파일 | 내용 |
|---|---|
| `utils/api.js` | AI 호출 (`aiRank`, `aiChat`, `aiEvaluate`, `aiMerchants`, `aiRecommendationPage`, `aiConfirmRuleDraft`, `aiCancelRuleDraft`) |
| `utils/aiPlacementCore.js` | AI 순위를 지갑 순서로 바꾸기, 1순위 카드의 예시 거래(`example`), 챗봇에 보낼 이전 대화 (순수 함수) |
| `utils/aiPlacement.js` | 순서를 묻고 지갑에 맞추는 `loadPlacement` |
| `utils/aiEstimate.js`, `aiEstimateCore.js` | 예상 혜택을 AI 에 묻고 지갑 카드별 값으로 바꾸기 (결제 화면, 홈 '오늘의 일정'). 예시 거래 → 계산 요청(`exampleScenario`), 상자 거래 고르기(`chooseEstimateScenario`), 안내 줄(`exampleNote`) |
| `utils/aiRecommendCore.js` | AI 맞춤 추천 응답 → 카드 추천·프로모션 추천·보일 탭 (순수 함수) |
| `utils/serverCards.js` | 지갑 카드 ↔ 서버 카드 번호 짝 (`serverCardLinks`). 22장에 없는 카드는 40장 데이터로 짝짓는다 |
| `utils/serverCatalog.js`, `serverCatalogCore.js` | 카드 탭 상품 목록·상세를 서버에서 읽고 앱 모양으로 바꾸기, 서버 이미지 주소 |
| `utils/wallet.js` | 지갑 카드 상품: 22장에 없으면 40장 데이터(`walletProduct`) |
| `utils/scheduleCategory.js` | 앱 업종 ↔ 서버 업종 코드 |
| `utils/routineData.js` | 일정을 서버 형식으로 바꿀 때 `scheduleCategory.js` 를 쓰도록 수정 |
| `screens/PaymentScreen.js` | AI 추천 상자, 자동 선택, AI 예상 혜택 |
| `screens/RoutineRecommendationScreen.js` | 일정 맞춤 추천(카드·프로모션 탭)을 AI 맞춤 추천으로 |
| `screens/RoutinePatternRecommendationScreen.js` | 가입 직후 일과 맞춤 카드 추천: AI 카드를 맨 앞에 |
| `components/TodaySchedulePanel.js` | 홈 '오늘의 일정'의 일정별 카드를 업종별 AI 계산으로 |
| `components/PaymentCardOrder.js` | `aiOrder` 로 받은 순서 표시 |
| `components/PaymentBenefitChat.js` | 결제 화면 챗봇의 AI 연결, 규칙 초안 버튼 |
| `utils/homeChat.js` | 홈 챗봇 추천 질문(탭별), AI 에 보낼 이전 대화 (순수 함수) |
| `screens/MainScreen.js` | 홈 챗봇의 AI 연결, 규칙 초안 버튼, 자동 스크롤, 카드 탭 상품을 서버 데이터로 |

## 테스트

`frontend` 폴더에서 실행한다 (파일 6개, 32개).

```bash
node --test utils/__tests__/*.test.mjs
```

## 아직 안 한 것

- QR 결제 시트에는 AI 배치가 없다.
- 지갑은 혜택 계산용 22장(`data/cardCatalogCsv.js`)에 없는 카드를 서버 DB 와 같은 40장(`data/cardCatalog40.json`)으로 보여 준다 (2026-11-23). 이 18장은 앱 자체의 '예상 혜택' 계산 데이터가 없어 '조건 확인 필요'로 보이고, AI 배치·챗봇은 그대로 계산한다.
- 월간 리포트·연말정산 화면은 AI 에 붙이지 않았다. '올해 카드 결산'(`components/YearEndReport.js`)은 앱 자체 계산이고 AI 의 연말정산 API(`/api/ai/missed-benefit`)를 쓰지 않는다. 맞춤 추천은 붙였다 (아래 3단계).
- 평소 일과(루틴)는 서버에 올리지 않는다.

## 카드 데이터를 서버로 옮기기 (2026-11-23 진행 중)

앱 안의 카드 데이터를 없애고 서버 데이터만 쓰기로 했다. 단계: 1) 표시를 서버 데이터로 2) 이미지를 서버로 3) 앱 자체 혜택 계산을 AI 엔진으로 4) 앱 카드 데이터 삭제.

- 1단계(완료): 카드 탭 상품 목록·검색·상세 혜택을 `/api/card-products`(목록)와 `/api/card-products/{번호}`(상세)에서 읽는다 (`utils/serverCatalog.js`, 변환은 `utils/serverCatalogCore.js`).
  데모 모드이거나 서버에서 못 읽으면 앱 데이터(`data/cardCatalog40.json`)를 쓴다. 이미지는 2단계부터 서버가 준 주소를 쓰고, 없을 때만 앱 안의 것을 카드 이름으로 찾아 쓴다.
- 2단계(완료): 카드 이미지 40장을 백엔드가 직접 제공한다 (`backend/src/main/resources/static/card-images/{카드번호}.webp`, 주소 `/card-images/{카드번호}.webp`, 로그인 없이 받음).
  카드사 사이트에서 내려받아 둔 앱 안의 이미지를 옮긴 것이라 카드사 주소에 기대지 않는다. DB 의 `image_url` 이 있으면 그것이 먼저다 (지금은 비어 있어 DB 는 고치지 않았다).
  카드 상품 목록·상세·내 카드 응답의 `imageUrl` 에 이 주소가 들어가고, 앱은 서버 주소를 붙여 쓴다.
- 3단계(진행): 앱 자체 혜택 계산을 AI 엔진으로.
  - 결제 화면 '이 거래의 예상 혜택': `/api/ai/payments/evaluate` (실적·한도·행사 반영, `utils/aiEstimate.js`·`aiEstimateCore.js`). 예시 거래 '일반 가맹점'은 음식점 30,000원으로 바꿈.
  - '일정 맞춤 추천'(카드 추천·프로모션 추천): `/api/ai/recommendation-page`. 탭은 AI 규칙(카드날에만 카드 탭, 행사 없으면 카드 탭만)을 따른다 (`utils/aiRecommendCore.js`). AI 추천은 연말 결산 기록에 남기지 않는다.
  - 가입 직후 '일과 맞춤 카드 추천': AI 맞춤 추천에 카드가 있으면 맨 앞에, 없으면(결제 내역 없는 새 가입자) 설문 기반 앱 계산.
  - 홈 '오늘의 일정'의 일정별 카드(`components/TodaySchedulePanel.js`): 일정 업종마다 AI 계산(예시 금액)으로 가장 많이 주는 내 카드. 직접 입력 업종처럼 AI 업종이 없거나 AI 가 답하지 못하면 앱 계산.
  - 데모 모드와 AI 가 답하지 못할 때의 대체 계산은 아직 앱 데이터를 쓴다 (4단계에서 정리).


## 행사(카드사 이벤트·마이샵) 목록 — 서버 전용 (2026-11-23)

- 혜택 탭 목록·검색·필터, 홈 '프로모션·혜택', 오늘의 프로모션 팝업, 아침 행사 알림은 백엔드 `GET /api/promotions` 를 쓴다
  (`utils/promotions.js` 가 한 번 읽어 기억, 변환은 `utils/promotionsCore.js`). AI 챗봇·추천·카드 배치도 같은 DB `promotions` 표를 읽는다.
- 로고는 백엔드가 준다 (`/brand-logos/*.png`, 서버 주소를 붙여 그림). 맞춤 추천 가맹점 탭은 AI 가 준 `display_name`·`logo_url` 을 쓴다.
- 데모 모드(서버 주소 없음)에는 행사가 없다: 혜택 탭에 '서버에 연결하면 진행 중인 행사를 볼 수 있어요'. 서버에서 못 읽으면 '행사를 불러오지 못했어요' + '다시 시도'.
- 앱에서 지운 것: `data/promotions.js`, `data/promotionBrands.js`, `data/myshopLogos.js`, `MainScreen.js` 의 `MYSHOP_ROWS`, `assets/promotion-logos/`, `assets/myshop-logos/`.
- 행사 문구·기간을 바꿀 때는 AI 저장소 `data/config/promotions.yml` 을 고치고 `generate.promotions --sql` 로 만든 SQL 을 DB 에 실행한다.
