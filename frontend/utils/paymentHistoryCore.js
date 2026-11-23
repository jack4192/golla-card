// 카드이용내역 화면(홈 '최근 이용내역 >' 전체 화면, 2026-11-24 '실제 신한처럼')의 순수 함수들.
// 서버 호출은 payments.js. 테스트: node --test utils/__tests__/paymentHistoryCore.test.mjs

const won = value => String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
const dotted = date => String(date || '').slice(0, 10).replace(/-/g, '.');

// 기간: '2026.10.24 ~ 11.24' (해가 다르면 끝도 연도를 붙인다). summary 는 GET /api/payments/month-summary 응답
export function periodLabel(summary) {
  if (!summary?.from || !summary?.until) return '';
  const from = dotted(summary.from);
  const until = dotted(summary.until);
  return `${from} ~ ${from.slice(0, 4) === until.slice(0, 4) ? until.slice(5) : until}`;
}

export const totalLabel = summary => (summary ? won(summary.amount) : '');

export const countLabel = summary => (summary ? `총 ${Number(summary.count) || 0}건` : '');

// 최근순 결제 한 쪽에서 기간(from 'yyyy-MM-dd') 안의 결제만. 기간보다 오래된 결제가 나오면 ended(더 읽지 않음).
// 결제 시각은 서울 시각 글자 'yyyy-MM-ddTHH:mm:ss' 라 글자 비교로 충분하다. from 이 없으면 거르지 않는다.
export function rowsInPeriod(rows, from) {
  const list = Array.isArray(rows) ? rows : [];
  if (!from) return { rows: list, ended: false };
  const inside = list.filter(row => String(row?.paidAt || '').slice(0, 10) >= from);
  return { rows: inside, ended: inside.length < list.length };
}
