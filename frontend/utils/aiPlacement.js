// 결제 화면의 AI 카드 배치 (서버 모드 전용).
//
// 서버 모드에서는 지갑이 서버의 내 카드와 맞춰져 있다 (utils/serverCards.js, utils/wallet.js).
// 여기서는 AI 에 순서를 묻고(/api/ai/rank), 서버 카드 번호로 온 순위를 지갑 카드 순서로 바꾼다.
import { SERVER_MODE, api } from './api';
import { applyRank } from './aiPlacementCore';
import { fetchServerWallet, serverCardLinks } from './serverCards';

// 지갑 카드 id → 서버 userCardId. 아직 서버 목록을 읽은 적이 없으면 한 번 읽는다.
export async function walletLinks() {
  let links = serverCardLinks();
  if (!Object.keys(links).length) {
    await fetchServerWallet();
    links = serverCardLinks();
  }
  return links;
}

// 반환: { order, topId, message, reasonCode, recommendationId, fallback, version, unranked, example } (aiPlacementCore.applyRank)
// 서버 모드가 아니면 null. 실패하면 예외를 던진다 (화면은 지갑 순서 그대로 보여 주면 된다).
export function loadPlacement(walletCards) {
  return place(walletCards, () => api.aiRank());
}

// 홈 일정 카드용 미리보기: 결과 모양은 loadPlacement 와 같고, AI 가 추천 기록을 남기지 않는다 (2026-11-23).
export function loadPlacementPreview(walletCards) {
  return place(walletCards, () => api.aiRankPreview());
}

async function place(walletCards, ask) {
  if (!SERVER_MODE || !walletCards?.length) return null;
  const [links, rank] = await Promise.all([walletLinks(), ask()]);
  return applyRank(walletCards, rank, links);
}
