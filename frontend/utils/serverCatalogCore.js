// 서버 카드 상품(/api/card-products) → 앱 카드 탭이 쓰는 모양 (data/cardCatalog40.js 의 CARD_CATALOG_40 과 같은 칸).
// 테스트: node --test utils/__tests__/serverCatalogCore.test.mjs
//
// 카드 코드(code)는 앱 데이터의 코드(예: SH_DISCOUNT_PLAN)를 이름으로 찾아 쓴다. 지갑 등록·이미지가 이 코드를 쓰기 때문이다.
// 이미지는 서버 imageUrl(백엔드가 제공하는 /card-images/...)을 쓰고, 없으면 앱 안의 이미지를 쓴다.

const TYPE = { CREDIT: '신용', CHECK: '체크' };
const KIND = { DISCOUNT: '할인', CASHBACK: '캐시백', POINT: '적립', MILEAGE: '마일리지' };
const won = value => Number(value).toLocaleString('ko-KR') + '원';
const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

// 서버 이미지 주소가 '/card-images/1.webp' 처럼 서버 기준 경로면 서버 주소(baseUrl)를 붙인다.
export function imageSource(imageUrl, baseUrl = '') {
  if (!imageUrl) return null;
  return { uri: imageUrl.startsWith('/') ? String(baseUrl).replace(/\/+$/, '') + imageUrl : imageUrl };
}

export function toCatalogCard(summary, localCards = [], baseUrl = '') {
  const local = localCards.find(card => norm(card.name) === norm(summary.name));
  return {
    code: local?.code ?? 'DB_' + summary.cardCode,
    serverCode: String(summary.cardCode),
    registryCardId: Number(summary.cardCode),
    name: summary.name,
    issuer: summary.issuer,
    type: TYPE[summary.type] || summary.type,
    description: summary.description || '',
    annualFeeDomestic: summary.annualFee ?? 0,
    annualFeeOverseas: summary.annualFeeOverseas ?? summary.annualFee ?? 0,
    tags: Array.isArray(summary.tags) ? summary.tags : [],
    image: imageSource(summary.imageUrl, baseUrl) ?? local?.image,
    sourcePage: local?.sourcePage,
    benefits: [],
    tiers: [],
  };
}

function tierLine(tier) {
  const parts = [tier.minPrevSpend ? `전월 ${won(tier.minPrevSpend)} 이상` : '전월 실적 없음', tier.displayValue];
  if (tier.perPaymentLimit != null) parts.push('건당 한도 ' + won(tier.perPaymentLimit));
  if (tier.monthlyCap != null) parts.push('월 혜택 한도 ' + won(tier.monthlyCap));
  if (tier.groupMonthlyCap != null) parts.push('통합 월 한도 ' + won(tier.groupMonthlyCap));
  if (tier.monthlyCount != null) parts.push(`월 ${tier.monthlyCount}회`);
  return parts.filter(Boolean).join(' · ');
}

// 상세 응답의 혜택 → 카드 탭 상세 창이 그리는 { benefitId, name, type, note }
export function toCatalogBenefits(detail) {
  return (Array.isArray(detail?.benefits) ? detail.benefits : []).map(benefit => {
    const lines = [];
    if (benefit.note) lines.push(benefit.note);
    if (benefit.groupName) lines.push('혜택 그룹 ' + benefit.groupName);
    if (benefit.merchants?.length) lines.push('대상 ' + benefit.merchants.join(', '));
    else if (benefit.categories?.length) lines.push('업종 ' + benefit.categories.join(', '));
    for (const tier of benefit.tiers || []) lines.push(tierLine(tier));
    return { benefitId: String(benefit.benefitId), name: benefit.name, type: KIND[benefit.type] || benefit.type, note: lines.join('\n') };
  });
}
