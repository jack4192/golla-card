// 홈 '내 지갑' 시간 표시줄(0~24시)의 순수 함수들 (2026-11-23 설계서 home-day-timeline).
// 서버 호출은 dayTimeline.js·payments.js 가 한다.
// 테스트: node --test utils/__tests__/dayTimelineCore.test.mjs

export const DAY_MINUTES = 1440;
export const STEP_MINUTES = 10;
export const MAX_MINUTE = DAY_MINUTES - STEP_MINUTES;   // 23:50 까지
export const NO_AI_CARD = '이 시각 카드를 불러오지 못했어요';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pad = value => String(value).padStart(2, '0');
const won = value => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';

// 표시줄 위치(0~1) → 10분 단위 분 (0~1430)
export function ratioToMinute(ratio) {
  const minute = Math.round((Number(ratio) || 0) * DAY_MINUTES / STEP_MINUTES) * STEP_MINUTES;
  return clamp(minute, 0, MAX_MINUTE);
}

export const minuteToRatio = minute => minute / DAY_MINUTES;

export const minuteOfDay = date => date.getHours() * 60 + date.getMinutes();

export const timeLabel = minute => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

// "HH:MM" → 분 ("24:00" 은 1440)
function hhmmToMinute(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// 결제 시각 글자 'yyyy-MM-ddTHH:mm:ss' 의 분 (기기 시간대와 상관없이 서울 시각 글자 그대로 읽는다)
function paidMinute(payment) {
  const match = /T(\d{2}):(\d{2})/.exec(String(payment?.paidAt || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// AI 하루 배치 응답 → [{ startMin, endMin, walletId, message }]
//   walletId: 구간의 카드 순위 중 기기 지갑에 있는 첫 카드 (1순위가 지갑에 없으면 다음 순위)
//   message: 그 카드가 AI 1순위일 때만 (아니면 다른 카드 이야기라 쓰지 않는다)
//   linked: { [지갑 카드 id]: 서버 userCardId } (utils/serverCards.js)
export function toDaySegments(response, linked) {
  const segments = response?.segments;
  if (!Array.isArray(segments)) return [];
  const walletIdOf = new Map(Object.entries(linked || {}).map(([walletId, userCardId]) => [String(userCardId), walletId]));
  return segments.map(segment => {
    const ranked = [...(Array.isArray(segment.cards) ? segment.cards : [])].sort((a, b) => a.rank - b.rank);
    const first = ranked.find(card => walletIdOf.has(String(card.user_card_id)));
    const walletId = first ? walletIdOf.get(String(first.user_card_id)) : null;
    const isTop = Boolean(first) && String(first.user_card_id) === String(segment.user_card_id);
    return {
      startMin: hhmmToMinute(segment.start),
      endMin: hhmmToMinute(segment.end),
      walletId,
      message: isTop ? String(segment.message || '') : '',
    };
  }).filter(segment => segment.startMin != null && segment.endMin != null);
}

export function segmentAt(segments, minute) {
  return (segments || []).find(segment => segment.startMin <= minute && minute < segment.endMin) || null;
}

// 동그라미를 옮긴 시각의 큰 카드. 하루 배치가 없거나 그 카드가 지갑에 없으면 결제 카드와 안내 문구.
export function scrubbedCard({ segments, minute, walletCards, fallbackCard }) {
  const segment = segmentAt(segments, minute);
  const card = segment?.walletId != null ? (walletCards || []).find(item => item.id === segment.walletId) : null;
  return card ? { card, note: segment.message } : { card: fallbackCard, note: NO_AI_CARD };
}

// 카드가 바뀌는 시각(표시줄 노란 점, 2026-11-24 사용자 요청): 후보 경계(하루 배치 구간·일정의 시작·끝)마다
// 그 시각의 큰 카드와 1분 전 큰 카드가 다르면 점을 찍는다. cardIdAt(분) → 그 시각 큰 카드 id. 0시·24시와 겹친 경계는 뺀다.
export function cardChangeDots(boundaries, cardIdAt) {
  const minutes = [...new Set((boundaries || []).filter(minute => Number.isFinite(minute) && minute > 0 && minute < DAY_MINUTES))]
    .sort((a, b) => a - b);
  return minutes.filter(minute => cardIdAt(minute) !== cardIdAt(minute - 1))
    .map(minute => ({ key: 'change-' + minute, ratio: minuteToRatio(minute), minute }));
}

// 오늘 결제 점: 기준 시각(nowMinute) 뒤 결제는 뺀다
export function paymentDots(payments, nowMinute) {
  return (payments || []).map(payment => ({ payment, minute: paidMinute(payment) }))
    .filter(dot => dot.minute != null && dot.minute <= nowMinute)
    .map(dot => ({ key: String(dot.payment.paymentId), ratio: minuteToRatio(dot.minute), minute: dot.minute, payment: dot.payment }));
}

// 옮긴 시각과 10분 안쪽에서 가장 가까운 결제
export function paymentAt(payments, minute) {
  let best = null;
  let bestGap = STEP_MINUTES;
  for (const payment of payments || []) {
    const paid = paidMinute(payment);
    if (paid == null) continue;
    const gap = Math.abs(paid - minute);
    if (gap < bestGap) {
      best = payment;
      bestGap = gap;
    }
  }
  return best;
}

// 가상 데이터의 업종 대표 가맹점 이름 '동네 카페'·'동네 대중교통' 에서 '동네 '를 떼고 보여 준다 (2026-11-25 점검: 어색함).
//   DB 이름은 그대로 (AI·백엔드 계산과 맞춰야 해서 화면에서만)
export const displayMerchant = name => String(name || '').replace(/^동네\s+/, '');

// 결제 한 줄 (홈 '최근 이용내역'·카드이용내역 화면, 2026-11-24 '실제 신한처럼'): 날짜는 늘 'yyyy.MM.dd HH:mm',
// 혜택(카드 혜택+가맹점 행사)은 금액 아래 'N원 할인'
export function paymentRowText(payment) {
  const [date = '', time = ''] = String(payment?.paidAt || '').split('T');
  const benefit = (Number(payment?.benefitAmount) || 0) + (Number(payment?.promotionAmount) || 0);
  return {
    when: `${date.replace(/-/g, '.')} ${time.slice(0, 5)}`.trim(),
    merchant: displayMerchant(payment?.merchantName),
    amount: won(Number(payment?.amount) || 0),
    card: String(payment?.cardName || '').replace(/^신한카드\s+/, ''),     // 한 줄에 들어가게 '신한카드 ' 머리는 뗀다
    benefit: benefit > 0 ? won(benefit) + ' 할인' : '',
  };
}

export function paymentLine(payment) {
  const row = paymentRowText(payment);
  return `이 시각 결제: ${row.merchant} ${row.amount} · ${row.card}`;
}
