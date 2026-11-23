// 앱의 장소 일정 업종 ↔ 서버 업종 코드(DB categories).
//
// 앱 업종 id 를 대문자로만 바꾸면 서버에 없는 코드가 된다 (transport → TRANSPORT, 서버는 TRANSIT).
// 서버는 없는 업종을 400(존재하지 않는 업종)으로 거절하므로, 여기 표로 바꿔 보낸다.
// 테스트: node --test utils/__tests__/scheduleCategory.test.mjs

// 앱 업종(routineDetails.INDUSTRIES) → 서버 업종. 서버에 맞는 업종이 없는 PC방은 OTHER 로 보낸다.
export const SERVER_CATEGORY = {
  cafe: 'CAFE',
  restaurant: 'RESTAURANT',
  pcroom: 'OTHER',
  travel: 'TRAVEL_AGENCY',
  train: 'INTERCITY_TRANSIT',
  intercity: 'INTERCITY_TRANSIT',
  transport: 'TRANSIT',
  taxi: 'TAXI',
  convenience: 'CONVENIENCE',
  delivery: 'DELIVERY',
  fuel: 'FUEL',
  shopping: 'ONLINE_SHOPPING',
  medical: 'HOSPITAL',
  other: 'OTHER',
};

// 서버에서는 한 업종으로 합쳐지는 앱 업종. 다시 읽을 때 구분할 수 있게 일정 이름을 정해 보낸다.
const MARKER_TITLE = { train: '기차', pcroom: 'PC방' };

// 서버 업종 → 앱 업종 (이름으로 구분하는 것과 OTHER 는 fromServerCategory 에서 따로 본다)
const APP_CATEGORY = {
  CAFE: 'cafe',
  RESTAURANT: 'restaurant',
  TRAVEL_AGENCY: 'travel',
  INTERCITY_TRANSIT: 'intercity',
  TRANSIT: 'transport',
  TAXI: 'taxi',
  CONVENIENCE: 'convenience',
  DELIVERY: 'delivery',
  FUEL: 'fuel',
  ONLINE_SHOPPING: 'shopping',
  HOSPITAL: 'medical',
};

// 기기 장소 일정 → 서버에 보낼 { category, title }
export function toServerCategory(event) {
  const id = String(event?.category || '');
  const category = SERVER_CATEGORY[id] ?? id.toUpperCase();
  const title = MARKER_TITLE[id] ?? (String(event?.title || '').trim() || null);
  return { category, title };
}

// 서버 장소 일정 → 앱에서 쓸 { category, title }. 앱에 없는 업종은 '기타'로 보여 주고 업종 이름을 일정 이름으로 쓴다.
export function fromServerCategory(item) {
  const code = String(item?.category || '').toUpperCase();
  const title = String(item?.title || '').trim();
  const marked = Object.keys(MARKER_TITLE).find(id => SERVER_CATEGORY[id] === code && MARKER_TITLE[id] === title);
  if (marked) return { category: marked, title: '' };
  if (code !== 'OTHER' && APP_CATEGORY[code]) return { category: APP_CATEGORY[code], title: '' };
  return { category: 'other', title: title || String(item?.categoryName || '').trim() || '일정' };
}
