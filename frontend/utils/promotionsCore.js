// 행사(카드사 이벤트·마이샵) 목록: 백엔드 /api/promotions 응답 → 혜택 탭·홈 미리보기·오늘의 프로모션에서 쓰는 행 (순수 함수).
// 행사 데이터는 앱에 두지 않는다 (2026-11-23 결정: DB 한 곳, 챗봇·추천과 같은 목록). 데모 모드에는 행사가 없다.
// 테스트: node --test utils/__tests__/promotionsCore.test.mjs

export const PROMO_TEXT = {
  demo: '서버에 연결하면 진행 중인 행사를 볼 수 있어요',
  failed: '행사를 불러오지 못했어요',
  retry: '다시 시도',
  loading: '행사를 불러오는 중이에요',
};

const withBase = (path, baseUrl) => (typeof path === 'string' && path.startsWith('/') ? { uri: (baseUrl || '') + path } : null);

// [{ id, promotionId, type: '이벤트'|'마이샵', merchant, benefit, minimum, cap, start, end, payout, method, note, needsCheck, logo }]
export function toBenefitRows(list, baseUrl) {
  if (!Array.isArray(list)) return [];
  return list.map(item => ({
    id: 'promo-' + item.promotionId,
    promotionId: item.promotionId,
    type: item.kind === 'myshop' ? '마이샵' : '이벤트',
    merchant: item.name || '',
    benefit: item.benefitText || '',
    minimum: item.minAmount ?? null,
    cap: item.maxAmount ?? null,
    start: item.start,
    end: item.end,
    payout: item.payout || '',
    method: item.method || '',
    note: item.note || '',
    needsCheck: Boolean(item.needsCheck),
    logo: withBase(item.logoUrl, baseUrl),
  }));
}

// today: 'YYYY-MM-DD' (한국 날짜)
export function benefitStatus(row, today) {
  if (today < row.start) return '진행 예정';
  if (today > row.end) return '기간 종료';
  return '기간 내';
}

export function activePromotions(rows, today) {
  return rows.filter(row => row.type === '이벤트' && benefitStatus(row, today) === '기간 내');
}

// 오늘의 프로모션: 날짜마다 돌아가며 하나 (예전 data/promotionBrands.js 의 함수 그대로)
export function selectDailyPromotion(items, now = Date.now()) {
  if (!items.length) return null;
  const day = Math.floor((now + 9 * 60 * 60 * 1000) / 86400000);
  const firstDay = Date.UTC(2026, 10, 18) / 86400000;
  const index = ((day - firstDay) % items.length + items.length) % items.length;
  return items[index] ?? null;
}

// 혜택 탭 요약 ('지금 확인할 수 있는 혜택 N건'·'이번 달 혜택 N건'). 다 읽었을 때만 — 데모·읽는 중·실패에 0건을 보이지 않는다
export function benefitSummary(status, rows, today) {
  if (status !== 'ready') return null;
  return { total: rows.length, active: rows.filter(row => benefitStatus(row, today) === '기간 내').length };
}

// 앱 기본 안내 챗봇의 행사 답 (AI 챗봇에 연결하지 못했을 때). active = 진행 중인 이벤트 행
export function promotionAnswer(status, active) {
  if (status === 'off') return PROMO_TEXT.demo;
  if (status === 'failed') return PROMO_TEXT.failed;
  if (status === 'loading') return PROMO_TEXT.loading;
  if (!active.length) return '지금 진행 중인 프로모션이 없어요.';
  const names = [...new Set(active.map(item => item.merchant))].slice(0, 3).join(', ');
  return `지금 진행 중인 프로모션이 ${active.length}개 있어요. 예: ${names}. 혜택 탭에서 각 항목을 누르면 결제 조건과 기간을 볼 수 있어요.`;
}

// 오늘의 프로모션 팝업에 보여 줄 행사가 없을 때의 문구
export function emptyPromotionText(status) {
  if (status === 'off') return PROMO_TEXT.demo;
  if (status === 'failed') return PROMO_TEXT.failed;
  if (status === 'loading') return PROMO_TEXT.loading;
  return '현재 진행 중인 이벤트가 없어요.';
}

// 로고 파일을 못 받은 주소(failed)는 그림 대신 이름을 보이도록 null
export function visibleLogo(logo, failed) {
  return logo && !(failed && failed.has(logo.uri)) ? logo : null;
}
