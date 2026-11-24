// 서버 모드에서 기기에 복사해 둔 일정 목록(EVENTS_KEY) 읽기 (2026-11-24 점검 문제 4).
// 서버 모드의 원본은 서버이고 기기 목록은 화면 계산용 복사본이라, 시간이 이상한 일정 하나 때문에 전체를 '형식 오류'로 버리지 않는다.
// 번호(id 글자)가 있는 객체만 남긴다. 데모 모드(기기가 원본)는 routineData.readLocalEvents 의 엄격한 검사를 그대로 쓴다.
// 테스트: node --test utils/__tests__/eventCacheCore.test.mjs

export function serverCacheEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(event => event !== null && typeof event === 'object' && typeof event.id === 'string');
}
