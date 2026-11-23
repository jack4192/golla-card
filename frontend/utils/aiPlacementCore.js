// AI 카드 배치를 지갑에 적용하는 순수 함수들 (서버 호출은 aiPlacement.js).
//
// 지갑 카드와 서버 카드 번호를 잇는 일은 utils/serverCards.js 가 한다. 여기서는 그 결과(linked)를 받아 쓴다.
// 테스트: node --test utils/__tests__/aiPlacementCore.test.mjs

// AI 순위(/api/ai/rank 응답)를 지갑 카드 순서로 바꾼다.
//   linked: { [지갑 카드 id]: 서버 userCardId }
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
