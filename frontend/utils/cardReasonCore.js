// 결제 창(QuickPaySheet) '선정 이유' 한 줄 (2026-11-24 팀 결정 '맞을 때만 보이기', PR #12 보완).
// 맞는 말일 때만 보이고, 아니면 빈 문자열(칸을 숨김). 'AI가 …했어요' 문장은 쓰지 않는다 (수정사항2 결정 5).
export const AI_TOP_REASON = '지금 결제에 맞는 카드를 맨 앞에 뒀어요';
export const AUTO_OFF_REASON = '자동 배치가 꺼져 있어 1순위 카드로 결제해요';
export const PICKED_REASON = '직접 고른 카드예요';

const escapeRegex = ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// AI 설명 앞의 카드 이름을 뗀다 (2026-11-25 팀 피드백: 홈 카드 뒷면처럼 카드가 함께 보이는 곳).
// 엔진의 실적·구간 문장이 '신한카드 Discount Plan+ 120만 원 구간까지 …'처럼 카드 이름으로 시작한다.
// 띄어쓰기와 앱 이름의 '(가칭)'은 무시하고, 이름 뒤에 띄어쓰기가 있을 때만 뗀다(이름만 있거나 다른 카드면 그대로).
export function dropCardName(message, cardName) {
  const text = String(message || '');
  const name = String(cardName || '').replace(/\(가칭\)/g, '').replace(/\s+/g, '');
  if (!text || !name) return text;
  const pattern = new RegExp('^\\s*' + [...name].map(escapeRegex).join('\\s*') + '\\s+');
  const rest = text.replace(pattern, '');
  return rest === text || !rest.trim() ? text : rest;
}

// selectedId: 결제 카드, ai: 배치 미리보기 결과({ topId, message, fallback }) 또는 null,
// autoOn: 자동 배치, pickedHere: 이 결제 창에서 카드를 바꿨는지, fromSchedule: 일정에서 연 결제 창,
// benefit: AI 가 계산한 예시 거래의 혜택 문구 (없으면 ''), cardName: 결제 카드 이름 (AI 설명 앞에서 뗀다)
export function cardReason({ selectedId, ai = null, autoOn = true, pickedHere = false, fromSchedule = false, benefit = '', cardName = '' }) {
  if (selectedId == null || fromSchedule) return '';
  if (pickedHere) return PICKED_REASON;
  if (autoOn === false) return AUTO_OFF_REASON;
  if (!ai || ai.fallback || ai.topId == null || String(ai.topId) !== String(selectedId)) return '';
  const message = dropCardName(String(ai.message || '').trim(), cardName).replace(/!$/, '');
  if (message) return message;
  return AI_TOP_REASON + (benefit ? ' · ' + benefit : '');
}
