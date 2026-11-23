// AI 카드 배치를 기기 지갑에 적용하는 순수 함수들 (서버 호출은 aiPlacement.js).
//
// 기기 지갑의 카드 코드(예: SH_DISCOUNT_PLAN)와 서버의 카드 번호가 달라서 카드 이름으로 잇는다.
// 테스트: node --test utils/__tests__/aiPlacementCore.test.mjs

export const normalizeCardName = name => String(name || '').replace(/\s+/g, '').toLowerCase();

// 기기 지갑 카드 → 서버의 내 카드 번호(userCardId). 반환: { [walletId]: userCardId }
export function matchWalletToServer(walletCards, serverCards) {
  const byName = new Map((serverCards || []).map(card => [normalizeCardName(card.name), card.userCardId]));
  const linked = {};
  for (const card of walletCards || []) {
    const userCardId = byName.get(normalizeCardName(card.name));
    if (userCardId != null) linked[card.id] = userCardId;
  }
  return linked;
}

// 서버에 아직 없는 지갑 카드를 등록할 계획.
//   register: 카드 상품에 있어 등록할 수 있는 것 [{ walletId, cardCode }]
//   unsupported: 서버 카드 상품에 없는 카드 (AI 가 순위를 매길 수 없다)
export function cardsToRegister(walletCards, serverCards, products) {
  const linked = matchWalletToServer(walletCards, serverCards);
  const codeByName = new Map((products || []).map(product => [normalizeCardName(product.name), product.cardCode]));
  const register = [];
  const unsupported = [];
  for (const card of walletCards || []) {
    if (linked[card.id] != null) continue;
    const cardCode = codeByName.get(normalizeCardName(card.name));
    if (cardCode != null) register.push({ walletId: card.id, cardCode });
    else unsupported.push(card.id);
  }
  return { register, unsupported };
}

// AI 순위(/api/ai/rank 응답)를 지갑 카드 순서로 바꾼다.
//   order: 지갑 카드 id 를 AI 순위대로 (순위에 없는 카드는 원래 순서로 뒤에)
//   topId: 맨 앞 카드 (순위를 매길 카드가 없으면 null)
//   message: 안내 문구. AI 1순위 카드가 기기 지갑에 없으면 다른 카드 이야기이므로 쓰지 않는다
export function applyRank(walletCards, rank, linked) {
  const cards = walletCards || [];
  const walletIdOf = new Map(Object.entries(linked || {}).map(([walletId, userCardId]) => [String(userCardId), walletId]));
  const ranked = [...(Array.isArray(rank?.cards) ? rank.cards : [])].sort((a, b) => a.rank - b.rank);
  const order = [];
  for (const item of ranked) {
    const walletId = walletIdOf.get(String(item.user_card_id));
    if (walletId != null && !order.includes(walletId)) order.push(walletId);
  }
  const unranked = cards.map(card => card.id).filter(id => !order.includes(id));
  const first = ranked[0];
  const firstInWallet = first && walletIdOf.get(String(first.user_card_id)) === order[0];
  return {
    order: [...order, ...unranked],
    topId: order[0] ?? null,
    message: firstInWallet ? String(first.message || '') : '',
    reasonCode: rank?.reason_code ?? null,
    recommendationId: rank?.recommendation_id ?? null,
    fallback: rank?.reason_code === 'FALLBACK',
    unranked,
  };
}

// 챗봇에 함께 보낼 이전 대화. 답이 끝난 문답만, 최근 turns 개까지.
export function chatHistory(messages, turns = 4) {
  return (messages || [])
    .filter(message => !message.pending && message.question && message.text)
    .slice(-turns)
    .flatMap(message => [
      { role: 'user', text: message.question },
      { role: 'assistant', text: message.text },
    ]);
}
