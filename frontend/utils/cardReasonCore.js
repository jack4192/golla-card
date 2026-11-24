// 결제 창(QuickPaySheet) '선정 이유' 한 줄 (2026-11-24 사용자 결정 '맞을 때만 보이기', PR #12 보완).
// 맞는 말일 때만 보이고, 아니면 빈 문자열(칸을 숨김). 'AI가 …했어요' 문장은 쓰지 않는다 (수정사항2 결정 5).
export const AI_TOP_REASON = '지금 결제에 맞는 카드를 맨 앞에 뒀어요';
export const AUTO_OFF_REASON = '자동 배치가 꺼져 있어 1순위 카드로 결제해요';
export const PICKED_REASON = '직접 고른 카드예요';

// selectedId: 결제 카드, ai: 배치 미리보기 결과({ topId, message, fallback }) 또는 null,
// autoOn: 자동 배치, pickedHere: 이 결제 창에서 카드를 바꿨는지, fromSchedule: 일정에서 연 결제 창,
// benefit: AI 가 계산한 예시 거래의 혜택 문구 (없으면 '')
export function cardReason({ selectedId, ai = null, autoOn = true, pickedHere = false, fromSchedule = false, benefit = '' }) {
  if (selectedId == null || fromSchedule) return '';
  if (pickedHere) return PICKED_REASON;
  if (autoOn === false) return AUTO_OFF_REASON;
  if (!ai || ai.fallback || ai.topId == null || String(ai.topId) !== String(selectedId)) return '';
  const message = String(ai.message || '').trim().replace(/!$/, '');
  if (message) return message;
  return AI_TOP_REASON + (benefit ? ' · ' + benefit : '');
}
