// PDF 141쪽 중 실제 상품 이미지와 혜택을 대조한 8종
export const CARD_CATALOG = {
  focus: {
    name: 'FOCUS 신한카드 체크',
    image: require('../assets/card-images/focus_check.png'),
    source: '통합.pdf 5~6쪽',
  },
  gsall: {
    name: 'GS ALL 신한카드 체크',
    image: require('../assets/card-images/gs_all_check.png'),
    source: '통합.pdf 9~10쪽',
  },
  solmate: {
    name: 'SOL메이트 신한카드 SOL Plan 체크',
    image: require('../assets/card-images/sol_mate_plan.png'),
    source: '통합.pdf 23~24쪽',
  },
  naver: {
    name: '네이버페이 신한카드 체크 S2',
    image: require('../assets/card-images/naverpay_s2.png'),
    source: '통합.pdf 31~32쪽',
  },
  starbucks: {
    name: '스타벅스 신한카드 체크',
    image: require('../assets/card-images/starbucks_check.png'),
    source: '통합.pdf 53~54쪽',
  },
  yogi: {
    name: '요기패스 신한카드 체크',
    image: require('../assets/card-images/yogipass_check.png'),
    source: '통합.pdf 115~116쪽',
  },
  chunsik: {
    name: '카카오페이 신한 춘식이 체크',
    image: require('../assets/card-images/kakao_chunsik.png'),
    source: '통합.pdf 132~133쪽',
  },
  ryan: {
    name: '카카오페이 신한 라이언 체크',
    image: require('../assets/card-images/kakao_ryan.png'),
    source: '통합.pdf 132~133쪽',
  },
};

// 기존 데모 지갑 3종은 유지. PDF에 대응하는 혜택 자료가 없어 계산에서는 '확인 불가'.
const ORIGINAL_DEMO_CARDS = [
  {
    id: 'shinhan',
    name: '신한 생활 신용카드',
    number: '•••• 1234',
    color: '#1459F5',
    textColor: '#FFFFFF',
    issuer: '신한카드',
    reason: '기존 시연용 카드입니다. 정확한 상품 안내서가 없어 혜택을 임의로 계산하지 않아요.',
    category: '기존 시연 카드',
    isOwned: true,
    isDemoOwned: true,
  },
  {
    id: 'kb',
    name: 'KB국민 카페·뷰티',
    number: '•••• 5678',
    color: '#FFCA4B',
    textColor: '#263041',
    issuer: 'KB국민카드',
    reason: '기존 시연용 카드입니다. 정확한 상품 안내서가 없어 혜택을 임의로 계산하지 않아요.',
    category: '기존 시연 카드',
    isOwned: true,
    isDemoOwned: true,
  },
  {
    id: 'kpass',
    name: '신한 K-패스 신용',
    number: '•••• 9012',
    color: '#087B69',
    textColor: '#FFFFFF',
    issuer: '신한카드',
    reason: '기존 시연용 카드입니다. 정확한 상품 안내서가 없어 혜택을 임의로 계산하지 않아요.',
    category: '기존 시연 카드',
    isOwned: true,
    isDemoOwned: true,
  },
];

// 진짜 발급/연동한 카드가 아님! PDF 혜택 비교를 위한 가상 보유 카드.
// 이전 세 장은 제거하지 않고 카드 탭/결제 탭에서 사용할 수 있도록 이어 붙임.
const PDF_DEMO_META = [
  ['focus', '#103E93', '#FFFFFF', '•••• 2001'],
  ['gsall', '#275A44', '#FFFFFF', '•••• 2002'],
  ['solmate', '#265AD4', '#FFFFFF', '•••• 2003'],
  ['naver', '#13A46E', '#FFFFFF', '•••• 2004'],
  ['starbucks', '#204C35', '#FFFFFF', '•••• 2005'],
  ['yogi', '#F3B347', '#263041', '•••• 2006'],
  ['chunsik', '#FFDE6D', '#263041', '•••• 2007'],
  ['ryan', '#E5B45D', '#263041', '•••• 2008'],
];

export const PDF_DEMO_OWNED_CARDS = PDF_DEMO_META.map(
  ([id, color, textColor, number]) => ({
    ...CARD_CATALOG[id],
    id,
    issuer: '신한카드',
    number,
    color,
    textColor,
    category: 'PDF 기반 가상 보유 카드',
    reason: '실제 보유 카드가 아닌 시연용 데이터입니다. 혜택은 통합.pdf 상품 설명을 참고합니다.',
    isOwned: true,
    isDemoOwned: true,
    pdfVerified: true,
  })
);

export const DEMO_WALLET_CARDS = [
  ...ORIGINAL_DEMO_CARDS,
  ...PDF_DEMO_OWNED_CARDS,
];

// 추천 화면의 '카드 선택'은 카드 발급/보유 인증을 뜻하지 않음.
export const createRecommendedWalletCard = (selection) => {
  const catalogCard = selection && CARD_CATALOG[selection.cardId];
  if (!catalogCard) return null;

  const benefit = selection.benefitText ? ` ${selection.benefitText}` : '';
  const eligibility = selection.eligible === false
    ? ' 현재 가정한 전월실적은 해당 혜택 조건에 부족해요.'
    : '';

  return {
    ...catalogCard,
    id: selection.cardId,
    issuer: '신한카드',
    number: '추천 후보',
    color: '#1459F5',
    textColor: '#FFFFFF',
    category: selection.scenarioLabel
      ? `${selection.scenarioLabel} 관심 카드`
      : 'AI 추천 관심 카드',
    reason: (selection.reason || '추천 화면에서 선택한 카드예요.') + benefit + eligibility,
    isOwned: false,
    isRecommendedOnly: true,
  };
};

// 이미 가상 보유 카드로 등록된 상품을 추천에서 다시 골라도 보유 상태를 덮어쓰지 않음.
export const upsertWalletCard = (cards, selectedCard) => {
  if (!selectedCard) return cards;
  const existing = cards.find((item) => item.id === selectedCard.id);
  const safeCard = existing?.isOwned
    ? { ...existing, reason: selectedCard.reason || existing.reason }
    : selectedCard;
  return [safeCard, ...cards.filter((item) => item.id !== safeCard.id)];
};

export const getActiveWalletCard = (cards, activeCardId) =>
  cards.find((item) => item.id === activeCardId) ||
  cards[0] ||
  DEMO_WALLET_CARDS[0];
