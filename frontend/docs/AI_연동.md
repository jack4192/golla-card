# 앱 ↔ AI 연동 (결제 화면)

서버 모드(`EXPO_PUBLIC_API_URL` 설정)에서만 동작한다. 데모 모드는 전과 똑같다.
백엔드 쪽 설명은 `backend/docs/AI_연동.md` 에 있다.

## 어디에 붙어 있나

AI 카드 배치는 **전체 결제 화면**(`screens/PaymentScreen.js`)에 붙어 있다.
하단 '결제' 탭이나 '이 카드로 결제'로 여는 QR 결제 시트(`components/QuickPaySheet.js`)에는 붙이지 않았다 (2026-11-23 결정).
시트에서 '혜택 자세히 보기'를 누르면 전체 결제 화면이 열리고, 거기서 AI 추천이 보인다.

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

## 카드 도우미 챗봇

전체 결제 화면의 챗봇은 질문을 AI 챗봇에 보낸다 (`POST /api/ai/chat`, 최근 대화 4개와 추천 번호를 함께). 연결하지 못하면 앱 안의 기본 안내로 답한다.
챗봇이 규칙 초안을 만들면 '저장'·'취소' 버튼이 나온다 (`/api/ai/rules/drafts/{id}/confirm`, `/cancel`).

화면의 '이 거래의 예상 혜택' 숫자는 앱이 자체 계산한 예시라, AI 답변의 숫자와 다를 수 있다.

## 파일

| 파일 | 내용 |
|---|---|
| `utils/api.js` | AI 호출 (`aiRank`, `aiChat`, `aiConfirmRuleDraft`, `aiCancelRuleDraft`) |
| `utils/aiPlacementCore.js` | AI 순위를 지갑 순서로 바꾸기, 챗봇에 보낼 이전 대화 (순수 함수) |
| `utils/aiPlacement.js` | 순서를 묻고 지갑에 맞추는 `loadPlacement` |
| `utils/serverCards.js` | `serverCardLinks` 한 함수 추가 (지갑 카드 ↔ 서버 카드 번호) |
| `utils/scheduleCategory.js` | 앱 업종 ↔ 서버 업종 코드 |
| `utils/routineData.js` | 일정을 서버 형식으로 바꿀 때 `scheduleCategory.js` 를 쓰도록 수정 |
| `screens/PaymentScreen.js` | AI 추천 상자, 자동 선택 |
| `components/PaymentCardOrder.js` | `aiOrder` 로 받은 순서 표시 |
| `components/PaymentBenefitChat.js` | AI 챗봇 연결, 규칙 초안 버튼 |

## 테스트

```bash
node --test utils/__tests__/aiPlacementCore.test.mjs utils/__tests__/scheduleCategory.test.mjs
```

## 아직 안 한 것

- QR 결제 시트에는 AI 배치가 없다.
- 맞춤 추천·월간 리포트 화면은 붙이지 않았다. '올해 카드 결산'(`components/YearEndReport.js`)은 앱 자체 계산이고 AI 의 연말정산 API(`/api/ai/missed-benefit`)를 쓰지 않는다.
- 평소 일과(루틴)는 서버에 올리지 않는다.
