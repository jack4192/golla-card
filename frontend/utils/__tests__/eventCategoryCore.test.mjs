// 일정 → 카드 혜택 업종 (2026-11-24 수정사항 '일정 반영': 일정 추가 창에서 이름을 직접 쓴 일정도 업종을 붙인다)
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCategoryIds } from '../eventCategoryCore.js';

const typed = title => (title.includes('영화') ? ['movie'] : ['custom:' + title]);
const byType = type => ({ hospital: 'medical', team_dinner: 'restaurant' })[type];
const ids = event => eventCategoryIds(event, { typed, byType });

test('장소 일정은 그 업종, 장소의 직접 입력(other)은 이름으로 정한다', () => {
  assert.deepEqual(ids({ category: 'cafe', types: [] }), ['cafe']);
  assert.deepEqual(ids({ category: 'other', title: '영화관', types: [] }), ['movie']);
});

test('일정 추가 창의 직접 입력(상황 일정 종류 other + 이름)도 이름으로 업종을 정한다', () => {
  assert.deepEqual(ids({ types: ['other'], title: '영화관' }), ['movie']);
  assert.deepEqual(ids({ types: ['other'], title: ' 동네 헬스 ' }), ['custom:동네 헬스']);
});

test('이름이 없는 직접 입력은 업종이 없고, 다른 상황 종류는 정해진 업종을 쓴다 (겹치면 한 번만)', () => {
  assert.deepEqual(ids({ types: ['other'], title: '  ' }), []);
  assert.deepEqual(ids({ types: ['other'] }), []);
  assert.deepEqual(ids({ types: ['hospital', 'travel'] }), ['medical']);
  assert.deepEqual(ids({ types: ['team_dinner', 'other'], title: '영화 보기' }), ['restaurant', 'movie']);
  assert.deepEqual(ids({ types: ['hospital', 'hospital'] }), ['medical']);
});
