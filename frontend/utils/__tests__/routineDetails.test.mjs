// 실행: node --test utils/__tests__/routineDetails.test.mjs
// 2026-11-24: 장소 일정 빠른 선택·카드 추천 업종에 '야구' (LG트윈스 신한카드 체크의 홈경기 입장권·구단 매장 혜택)
import test from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_CATEGORIES, INDUSTRIES, INDUSTRY_ICONS } from '../routineDetails.js';

test('장소 일정 빠른 선택에 야구가 있고, 기타는 맨 뒤', () => {
  const ids = INDUSTRIES.map(([id]) => id);
  assert.ok(ids.includes('baseball'));
  assert.equal(INDUSTRIES.find(([id]) => id === 'baseball')[1], '야구');
  assert.equal(ids[ids.length - 1], 'other');
  assert.ok(INDUSTRY_ICONS.baseball);
});

test('야구 업종으로 LG트윈스 카드 혜택을 찾을 말', () => {
  const { label, words } = DETAIL_CATEGORIES.baseball;
  assert.equal(label, '야구');
  for (const word of ['야구', 'LG트윈스', '홈경기', '입장권']) assert.ok(words.includes(word), word);
});
