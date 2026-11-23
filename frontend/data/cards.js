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
  null;
