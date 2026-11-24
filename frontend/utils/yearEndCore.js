// 연말 결산 화면의 계산 (2026-11-24, 설계서 2026-11-23-year-end-report-design.md).
// 받은 혜택은 백엔드 /api/payments/year-summary, 놓친 혜택은 AI /api/ai/missed-benefit?thisYear=true.
// 서버가 계산한 금액을 화면 문구로 바꾼다.

export function won(n) {
  return Math.round(Number(n) || 0).toLocaleString('ko-KR') + '원';
}

function monthDay(text) {
  const [, m, d] = String(text).slice(0, 10).split('-').map(Number);
  return `${m}월 ${d}일`;
}

// '1월 1일 ~ 11월 23일 · 결제 1,633건'
export function periodLine(summary) {
  return `${monthDay(summary.from)} ~ ${monthDay(summary.until)} · 결제 ${Number(summary.count || 0).toLocaleString('ko-KR')}건`;
}

// '카드 혜택 X원 · 가맹점 행사 Y원' (행사가 0원이면 카드 혜택만)
export function splitLine(summary) {
  const card = `카드 혜택 ${won(summary.benefit)}`;
  return summary.promotion > 0 ? `${card} · 가맹점 행사 ${won(summary.promotion)}` : card;
}

// '2026-06' → '6월'
export function monthLabel(month) {
  return `${Number(String(month).slice(5, 7))}월`;
}

// 가장 많이 받은 달 (같으면 앞 달). 모두 0원이거나 비었으면 null.
export function peakLine(months) {
  let peak = null;
  for (const m of months || []) {
    if (m.total > 0 && (!peak || m.total > peak.total)) peak = m;
  }
  return peak ? `가장 많이 받은 달은 ${monthLabel(peak.month)}, ${won(peak.total)}이에요` : null;
}

// 막대 높이 비율 (가장 큰 달 = 1). 모두 0원이면 모두 0.
export function barRatios(months) {
  const max = Math.max(0, ...(months || []).map(m => m.total || 0));
  return (months || []).map(m => (max > 0 ? (m.total || 0) / max : 0));
}

// 받은 혜택이 있는 카드만 앞에서 n장 (서버가 큰 순으로 준다).
export function topCards(cards, n = 3) {
  return (cards || []).filter(c => c.total > 0).slice(0, n);
}

// 놓친 혜택 꼬리표: '{카드} 대신' 또는 '지금 카드에 더해서', 연회비가 있으면 기간만큼 뺀 금액.
export function missedTags(item) {
  const tags = [item.basis === 'swap' && item.replaces ? `${item.replaces} 대신` : '지금 카드에 더해서'];
  const fee = Math.round((Number(item.annual_fee) || 0) * (Number(item.months) || 0) / 12);
  if (fee > 0) tags.push(`연회비 ${won(fee)} 빼고 계산`);
  return tags;
}

const usageByTag = {
  대중교통: '대중교통을 자주 타신다면',
  교통: '교통비를 자주 결제하신다면',
  카페: '카페에 자주 가신다면',
  편의점: '편의점을 자주 이용하신다면',
  배달앱: '배달앱을 자주 이용하신다면',
  영화: '영화를 자주 보신다면',
  전기차: '전기차 충전을 자주 하신다면',
  주유: '주유비를 자주 결제하신다면',
  해외: '해외 결제를 자주 하신다면',
  온라인쇼핑: '온라인 쇼핑을 자주 하신다면',
  무실적: '전월 실적을 따로 챙기기 어렵다면',
};

export function missedUsageTip(card) {
  const tag = card?.tags?.find(value => usageByTag[value]);
  return tag
    ? `${usageByTag[tag]} 이 카드를 활용해 보세요!`
    : '평소 자주 결제하는 곳에서 받을 수 있는 혜택을 확인해 보세요!';
}

// AI 응답 → 화면 상태. 배열이 아니면(오류 JSON 등) 실패.
export function missedView(result) {
  if (!Array.isArray(result)) return { state: 'error', items: [] };
  return { state: result.length ? 'ready' : 'empty', items: result };
}

// 카드 이름으로 앱 카드 목록(CARD_CATALOG_40)에서 찾기. 없으면 null.
export function findCatalogCard(catalog, name) {
  const key = typeof name === 'string' ? name.trim() : '';
  if (!key) return null;
  return (catalog || []).find(card => card.name === key) || null;
}
