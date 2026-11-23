// 결제 화면의 AI 카드 배치 (서버 모드 전용).
//
// 지갑은 기기에 저장되어 있어, 서버에 없는 카드를 먼저 등록한 뒤 AI 에 순서를 묻는다.
//   1) 서버의 내 카드를 읽는다
//   2) 기기 지갑에만 있는 카드를 이름으로 찾아 서버에 등록한다 (서버 카드 상품에 없는 카드는 건너뛴다)
//   3) 아직 올리지 못한 기기 일정을 서버에 올린다 (scheduleSync.js)
//   4) /api/ai/rank 로 순서를 받아 지갑 카드 순서로 바꾼다
import { SERVER_MODE, api } from './api';
import { applyRank, cardsToRegister, matchWalletToServer } from './aiPlacementCore';
import { dateKey, readEvents } from './routineData';
import { requestScheduleSync, waitForScheduleSync } from './scheduleSync';

async function ensureServerCards(walletCards) {
  let serverCards = await api.myCards();
  const linked = matchWalletToServer(walletCards, serverCards);
  if (walletCards.every(card => linked[card.id] != null)) return serverCards;

  const { register } = cardsToRegister(walletCards, serverCards, await api.cardProducts());
  if (!register.length) return serverCards;
  for (const { cardCode } of register) {
    try {
      await api.registerCard(cardCode);
    } catch (problem) {
      // 다른 기기에서 이미 등록한 카드(409)는 문제없다. 그 밖의 실패는 그 카드만 순위에서 빠진다.
      if (problem?.status !== 409) console.warn('카드를 서버에 등록하지 못했어요:', cardCode, problem?.message);
    }
  }
  serverCards = await api.myCards();
  return serverCards;
}

// 반환: { order, topId, message, reasonCode, recommendationId, fallback, unranked } (aiPlacementCore.applyRank)
// 서버 모드가 아니면 null. 실패하면 예외를 던진다 (화면은 지갑 순서 그대로 보여 주면 된다).
export async function loadPlacement(walletCards) {
  if (!SERVER_MODE || !walletCards?.length) return null;
  // 아직 서버에 올리지 못한 일정이 있으면 먼저 올린다 (AI 가 일정 시간에 맞춰 배치한다). 오래 걸리면 기다리지 않는다.
  requestScheduleSync(readEvents, dateKey());
  const [serverCards] = await Promise.all([ensureServerCards(walletCards), waitForScheduleSync()]);
  const rank = await api.aiRank();
  return applyRank(walletCards, rank, matchWalletToServer(walletCards, serverCards));
}
