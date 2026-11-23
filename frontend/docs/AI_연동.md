# 앱 ↔ AI 연동 (결제 화면·일정)

서버 모드(`EXPO_PUBLIC_API_URL` 설정)에서만 동작한다. 데모 모드는 전과 똑같다.
백엔드 쪽 설명은 `backend/docs/AI_연동.md` 에 있다.

## 결제 화면을 열면

1. 서버의 내 카드를 읽는다 (`GET /api/cards/user-cards`).
2. 기기 지갑에만 있는 카드를 **카드 이름으로** 찾아 서버에 등록한다 (`GET /api/card-products`, `POST /api/cards/register`).
   지갑은 기기에 저장되고 카드 코드도 서버와 달라서, 이름으로 잇는다. 서버 카드 상품에 없는 카드는 건너뛴다.
3. 아직 서버에 올리지 못한 일정이 있으면 올린다 (아래 '일정').
4. AI 에 순서를 묻는다 (`POST /api/ai/rank`).
5. AI 가 맨 앞에 둔 카드를 결제 카드로 고르고, 안내 문구를 'AI 추천' 상자에 보여 준다. 내 카드 목록도 AI 순서로 보인다.

사용자는 언제든 다른 카드로 바꿀 수 있다. 바꾼 뒤에는 AI 가 다시 바꾸지 않고, 'AI가 맨 앞에 둔 카드는 ○○예요' 와 '이 카드로 바꾸기' 만 보여 준다.

AI 가 고르지 않는 경우:

| 경우 | 동작 |
|---|---|
| 일정에서 들어온 결제 | 일정에 맞춘 카드를 유지하고 안내만 보여 준다 (일정 시간이 되기 전에 미리 열어 볼 수 있어서) |
| AI 가 답하지 못함 (`reason_code: FALLBACK`) | 지갑에서 고른 카드와 순서를 그대로 둔다 |
| 백엔드에 연결하지 못함 | 지갑 순서 그대로. 'AI 추천을 불러오지 못해…' 안내 |
| 사용자가 ☰ 로 순서를 끌어 옮김 | 그때부터 저장한 순서를 쓴다 |

## 일정

일정은 기기에 저장하는 것이 기준이고, 서버(`/api/schedules`)에 사본을 맞춰 둔다. 백엔드가 장소 일정을 AI 엔진에 넘기므로, 일정 시간에 결제 화면을 열면 그 업종에 맞춰 카드가 배치된다.

- 일정을 저장·수정·삭제할 때마다, 그리고 결제 화면을 열 때 서버와 맞춘다 (`POST`·`PUT`·`DELETE /api/schedules`).
- 새 일정은 오늘 이후 것만 올린다. 기기에서 지운 일정은 서버에서도 지운다.
- 올리지 못해도 기기 저장은 그대로다. 다음에 맞출 때 다시 올린다. 서버가 내용을 거절한 일정(400)은 내용이 바뀔 때까지 다시 보내지 않는다.
- 어떤 기기 일정이 서버의 몇 번 일정인지는 기기의 `solpay_schedule_server_links_v1` 에 기억한다 (일정 내용은 넣지 않는다).

업종은 서버 코드로 바꿔 보낸다.

| 앱 | 서버 | 앱 | 서버 |
|---|---|---|---|
| 커피 | `CAFE` | 택시 | `TAXI` |
| 식사 | `RESTAURANT` | 편의점 | `CONVENIENCE` |
| 버스·지하철 | `TRANSIT` | 배달 | `DELIVERY` |
| 기차, 시외·고속버스 | `INTERCITY_TRANSIT` | 주유·충전 | `FUEL` |
| 여행·숙박 | `TRAVEL_AGENCY` | 쇼핑 | `ONLINE_SHOPPING` |
| 병원·약국 | `HOSPITAL` | PC방, 기타 | `OTHER` |

`OTHER` 와 상황 일정(회식·반차 등)은 서버에는 저장되지만 AI 엔진에는 넘어가지 않는다 (업종을 알 수 없다).
상황 일정의 종류는 앱의 값 그대로(`team_dinner` 등) 보낸다.

**기준 시각 주의**: 백엔드의 `AI_FIXED_AT` 을 켜면 AI 가 그 시각으로 계산하므로, 실제 오늘 날짜로 넣은 일정은 배치에 반영되지 않는다.

## 카드 도우미 챗봇

질문을 AI 챗봇에 보낸다 (`POST /api/ai/chat`, 최근 대화 4개와 추천 번호를 함께). 연결하지 못하면 앱 안의 기본 안내로 답한다.
챗봇이 규칙 초안을 만들면 '저장'·'취소' 버튼이 나온다 (`/api/ai/rules/drafts/{id}/confirm`, `/cancel`).

화면의 '이 거래의 예상 혜택' 숫자는 앱이 자체 계산한 예시라, AI 답변의 숫자와 다를 수 있다.

## 파일

| 파일 | 내용 |
|---|---|
| `utils/api.js` | 카드·AI API 호출 추가 (`myCards`, `cardProducts`, `registerCard`, `aiRank`, `aiChat`, …) |
| `utils/aiPlacementCore.js` | 이름으로 카드 잇기, AI 순위를 지갑 순서로 바꾸기 (순수 함수) |
| `utils/aiPlacement.js` | 위 1~4단계를 차례로 부르는 `loadPlacement` |
| `utils/scheduleSyncCore.js` | 일정을 서버 형식으로 바꾸기, 올릴·고칠·지울 일정 정하기 (순수 함수) |
| `utils/scheduleSync.js` | 서버와 맞추는 `requestScheduleSync` |
| `utils/routineData.js` | 일정 저장·삭제 뒤 `requestScheduleSync` 호출 |
| `screens/PaymentScreen.js` | AI 추천 상자, 자동 선택 |
| `components/PaymentCardOrder.js` | `aiOrder` 로 받은 순서 표시 |
| `components/PaymentBenefitChat.js` | AI 챗봇 연결, 규칙 초안 버튼 |

## 테스트

```bash
node --test utils/__tests__/aiPlacementCore.test.mjs utils/__tests__/scheduleSyncCore.test.mjs
```

## 아직 안 한 것

- 기기에서 뺀 카드는 서버에 남는다 (백엔드에 카드 삭제 API 가 없다).
- 서버 일정을 기기로 내려받지는 않는다 (기기 → 서버 한 방향). 새 기기에서 로그인하면 일정이 비어 보인다.
- 평소 일과(루틴)는 서버에 올리지 않는다.
- 맞춤 추천·월간 리포트·연말정산 화면은 붙이지 않았다.
