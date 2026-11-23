// '일정 맞춤 추천' 화면(카드 추천 / 프로모션 추천)을 AI 맞춤 추천 페이지(/api/ai/recommendation-page)로 채우는 순수 함수들.
// 테스트: node --test utils/__tests__/aiRecommendCore.test.mjs
//
// 2026-11-23 결정: 탭은 AI 규칙을 따른다 (카드날에만 카드 탭, 행사가 없으면 카드 탭만).
//                  AI 가 카드를 주지 못하면(결제 내역이 없는 새 가입자 등) 앱의 설문 기반 계산을 쓴다.

const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();
const hhmm = value => (typeof value === 'string' && value.length >= 16 ? value.slice(11, 16) : '');

// AI 카드 탭 → 화면이 쓰는 추천 { card, matches, owned, ai, reasons }. card 는 앱 40장 상품(이미지·코드)이다.
export function toCardRecommendation(page, products = []) {
  const ai = page?.card;
  if (!ai?.card_name) return null;
  const product = products.find(item => norm(item.name) === norm(ai.card_name));
  if (!product) return null;
  const copy = ai.copy || {};
  const reason = copy.summary || copy.title || (ai.keyword ? ai.keyword + ' 혜택이 있어요' : '');
  const item = Array.isArray(ai.items) ? ai.items[0] : null;
  return {
    // 화면은 annualFee 칸을 읽는데 40장 데이터는 annualFeeDomestic 이라 AI 값(없으면 40장 값)으로 채운다
    card: { ...product, annualFee: ai.annual_fee ?? product.annualFeeDomestic ?? 0 },
    owned: false,
    ai: true,
    title: copy.title || '',
    reasons: Array.isArray(copy.reasons) ? copy.reasons : [],
    matches: [{
      status: 'ok', weight: 1, category: item?.category || null, reasons: [reason].filter(Boolean),
      // 화면의 혜택 배지·상세가 쓰는 칸 (benefitText 는 label 을 그대로 보여 준다)
      benefit: {
        name: copy.title || ai.keyword || product.name,
        label: ai.keyword || copy.title || '혜택 확인',
        minPrevSpend: item?.min_prev ?? null,
        note: (Array.isArray(copy.reasons) ? copy.reasons : []).join('\n'),
      },
    }],
  };
}

// AI 가맹점 탭의 첫 행사 → PromotionOffer 가 그리는 { merchant, benefit, method, minimum, note, start, end, logo }
// merchant 는 화면 이름(display_name, 없으면 brand), logo 는 AI 가 준 logo_url 에 서버 주소를 붙인 것 (2026-11-23)
export function toPromotionOffer(page, baseUrl = '') {
  const offer = page?.merchant?.offers?.[0];
  if (!offer?.brand) return null;
  const copy = offer.copy || {};
  return {
    offer: {
      id: 'ai:' + offer.promotion_id,
      merchant: offer.display_name || offer.brand,
      benefit: copy.amount_label || (offer.total ? offer.total.toLocaleString('ko-KR') + '원 혜택' : offer.title),
      method: offer.kind === 'myshop' ? '마이샵 (앱에서 그 가맹점을 켜야 받아요)' : 'SOL페이 결제',
      minimum: null,
      note: [offer.title, offer.card_name ? offer.card_name + '로 결제' : ''].filter(Boolean).join(' · '),
      start: hhmm(offer.window_from) || hhmm(offer.start),
      end: hhmm(offer.window_to) || hhmm(offer.end),
      logo: typeof offer.logo_url === 'string' && offer.logo_url.startsWith('/') ? { uri: baseUrl + offer.logo_url } : null,
    },
    reason: copy.reasons?.[0] || '오늘 일정에 맞는 행사예요.',
  };
}

// 보여 줄 탭 번호 (0 카드 추천, 1 프로모션 추천). AI 결과가 없으면 둘 다.
export function visibleTabs(page) {
  if (!Array.isArray(page?.tabs)) return [0, 1];
  const tabs = [0, 1].filter(i => page.tabs.includes(i === 0 ? 'card' : 'merchant'));
  return tabs.length ? tabs : [0, 1];
}
