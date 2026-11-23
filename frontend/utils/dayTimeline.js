// 홈 시간 표시줄의 하루 배치 불러오기 (서버 모드 전용, 2026-11-23). 계산은 dayTimelineCore.js.
import { SERVER_MODE, api } from './api';
import { walletLinks } from './aiPlacement';
import { toDaySegments } from './dayTimelineCore';

// 반환: [{ startMin, endMin, walletId, message }]. 서버 모드가 아니거나 카드가 없으면 null. 실패하면 예외.
export async function loadDayPlacement(walletCards) {
  if (!SERVER_MODE || !walletCards?.length) return null;
  const [links, response] = await Promise.all([walletLinks(), api.aiDayPlacement()]);
  return toDaySegments(response, links);
}
