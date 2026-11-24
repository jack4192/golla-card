// 실행: node --test utils/__tests__/eventCacheCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { serverCacheEvents } from '../eventCacheCore.js';

test('서버 모드 기기 복사본: 시간이 이상한 일정이 섞여 있어도 전체를 버리지 않는다', () => {
  const cache = [
    { id: '11', date: '2026-11-24', types: [], category: 'cafe', start: '12:00', end: '12:00' },   // 시작=끝
    { id: '12', date: '2026-11-24', types: [], category: 'cafe', start: '18:00', end: '09:00' },   // 밤샘
    { id: '13', date: '2026-11-24', types: ['halfday'] },
  ];
  assert.deepEqual(serverCacheEvents(cache).map(event => event.id), ['11', '12', '13']);
});

test('서버 모드 기기 복사본: 모양이 깨진 줄(번호 없음·객체 아님)만 빼고, 배열이 아니면 빈 목록', () => {
  assert.deepEqual(serverCacheEvents([null, 'x', { date: '2026-11-24' }, { id: 7 }, { id: '8' }]).map(event => event.id), ['8']);
  assert.deepEqual(serverCacheEvents(null), []);
  assert.deepEqual(serverCacheEvents({ id: '1' }), []);
});
