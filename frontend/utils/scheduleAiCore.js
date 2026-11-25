// 홈 일정 카드·일정 결제 화면을 AI 카드 배치(일정 모드)에 맞추는 순수 함수 (2026-11-23 설계서 home-schedule-ai).
//
// 팀 결정: 'AI 가 그 일정을 보고 정했으면 행사가 있든 없든 AI 1순위 카드와 그 거래를 쓴다'(일정 중엔 늘 AI),
// 홈은 추천 기록을 남기지 않는 미리보기(/api/ai/rank?record=false)로 묻는다.
// 'AI 가 그 일정을 보고 정함' = 배치 응답이 fallback 아님 · version === 'schedule' · example 있음 ·
//   example.category_code === SERVER_CATEGORY[일정 업종] (· 1순위 카드가 지갑에 있음은 scheduleAiMatch 가 본다).
// 테스트: node --test utils/__tests__/scheduleAiCore.test.mjs
import { SERVER_CATEGORY } from './scheduleCategory.js';

// AI 엔진이 일정을 보는 창 (엔진 params.schedule_lead_min / schedule_tail_min 과 같다)
export const AI_SCHEDULE_WINDOW_MIN = 30;
const WINDOW_MS = AI_SCHEDULE_WINDOW_MIN * 60 * 1000;

// AI 가 아는 업종인지 (서버 업종이 없거나 OTHER 인 PC방·직접 입력은 AI 일정으로 넘어가지 않는다)
const aiCategory = category => {
  const code = SERVER_CATEGORY[category];
  return code && code !== 'OTHER' ? code : null;
};

/** 지금(clock)이 그 일정의 시작 30분 전 ~ 끝 30분 후 안인지 (양끝 포함) */
export function inAiWindow(row, clock) {
  if (!(row?.startDate instanceof Date) || !(row?.endDate instanceof Date)) return false;
  const now = clock.getTime();
  return row.startDate.getTime() - WINDOW_MS <= now && now <= row.endDate.getTime() + WINDOW_MS;
}

/**
 * 홈이 AI 에 다시 물을지 정하는 열쇠. 창 안에 AI 업종 일정이 없으면 ''. 1분마다 바뀌지 않는다.
 * walletIds 는 정렬해서 쓴다: 홈 카드 목록은 지금 고른 카드가 맨 앞이라 결제 카드만 바꿔도 순서가 바뀌는데,
 * AI 결과(1순위·예시)는 지갑 순서와 무관하다 (2026-11-23 리뷰).
 */
export function aiWindowKey(rows, clock, walletIds) {
  const open = (rows || []).filter(row => inAiWindow(row, clock) && (row.cats || []).some(aiCategory));
  if (!open.length) return '';
  return open.map(row => `${row.key}:${(row.cats || []).join('+')}:${row.startDate.getTime()}-${row.endDate.getTime()}`)
    .join('|') + '#' + [...(walletIds || [])].sort().join(',');
}

/** 배치 결과(applyRank)가 이 일정 업종들을 보고 정한 것이면 그 예시 거래, 아니면 null */
export function scheduleAiExample(result, appCategories) {
  const example = result?.example;
  if (!result || result.fallback || result.version !== 'schedule' || !example) return null;
  return (appCategories || []).some(category => aiCategory(category) === example.category_code) ? example : null;
}

/** 홈 일정 카드 문구. 1순위 카드가 받는 금액이 0 이하면 금액 없이 (2026-11-24: 'AI 계산·AI 추천' 꼬리말은 뺀다) */
export function scheduleAiLabel(example, value) {
  const head = `${example.name || example.category_name} · ${Number(example.amount).toLocaleString('ko-KR')}원`;
  return value > 0 ? `${head} · ${value.toLocaleString('ko-KR')}원 예상 혜택` : head;
}

/**
 * 홈 타임라인 한 줄에 붙일 AI 카드. preview = { result: applyRank 결과, estimates: 예시 거래의 AI 계산 }.
 * 창 밖·예시 없음·계산 없음·1순위 카드가 지갑에 없음이면 null (지금처럼 업종 계산을 쓴다).
 */
export function scheduleAiMatch({ row, clock, preview, cards }) {
  if (!preview || !inAiWindow(row, clock)) return null;
  const example = scheduleAiExample(preview.result, row.cats);
  if (!example || !preview.estimates) return null;
  const card = (cards || []).find(item => item.id === preview.result.topId);
  if (!card) return null;
  const label = scheduleAiLabel(example, preview.estimates[card.id]?.value ?? 0);
  const category = row.cats.find(item => aiCategory(item) === example.category_code);
  // ai: 결제 시트·결제 화면에 '홈이 AI 판단으로 보낸 일정'임을 알린다 (scheduleAiPaymentExample 이 본다)
  return { card, label, benefitName: label, category, ai: true };
}

/**
 * 일정에서 들어온 결제 화면이 따를 AI 예시 거래. 홈이 AI 카드로 보낸 일정(schedule.ai)일 때만 따른다:
 * 같은 업종이어도 창 밖 일정(오늘의 일정 탭의 21시 카페 등)이나 홈 미리보기가 실패한 일정은 일정 거래 그대로라
 * 홈 카드와 결제 화면 카드가 갈리지 않는다 (2026-11-23 리뷰).
 */
export function scheduleAiPaymentExample(result, schedule) {
  return schedule?.ai ? scheduleAiExample(result, [schedule.category]) : null;
}
