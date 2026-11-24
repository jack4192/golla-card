// 일정 → 카드 혜택 업종 (순수 함수). routineData.eventBenefitCategories 가 쓴다.
// 테스트: node --test utils/__tests__/eventCategoryCore.test.mjs
//
// typed(이름) → 업종 id 목록 (routineData.typedCategoryIds), byType(상황 종류) → 업종 id 또는 없음.
// 2026-11-24 수정사항 '일정 반영': 일정 추가 창에서 이름을 직접 쓴 일정(상황 일정 종류 other + 이름, 예: 영화관)은
// 업종이 붙지 않아 오늘의 일정·홈 표시줄에서 카드가 바뀌지 않았다. 백엔드(ScheduleAiSync)처럼 이름으로 업종을 정한다.
export function eventCategoryIds(event, { typed, byType }) {
  const title = String(event?.title || '').trim();
  if (event?.category === 'other') return title ? typed(title) : [];
  if (event?.category) return [event.category];
  const ids = (Array.isArray(event?.types) ? event.types : [])
    .flatMap(type => (type === 'other' ? (title ? typed(title) : []) : [byType(type)]))
    .filter(Boolean);
  return [...new Set(ids)];
}
