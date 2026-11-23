// 실행: node --test utils/__tests__/scheduleCategory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_CATEGORY, fromServerCategory, toServerCategory } from '../scheduleCategory.js';

const APP_CATEGORIES = ['cafe', 'restaurant', 'pcroom', 'travel', 'train', 'intercity', 'transport', 'taxi', 'convenience', 'delivery', 'fuel', 'shopping', 'medical', 'other'];
// 서버(DB categories)에 실제로 있는 업종 코드 중 앱이 쓰는 것
const SERVER_CODES = ['CAFE', 'RESTAURANT', 'OTHER', 'TRAVEL_AGENCY', 'INTERCITY_TRANSIT', 'TRANSIT', 'TAXI', 'CONVENIENCE', 'DELIVERY', 'FUEL', 'ONLINE_SHOPPING', 'HOSPITAL'];

test('앱의 모든 장소 업종이 서버에 있는 업종 코드로 바뀐다', () => {
  for (const id of APP_CATEGORIES) {
    const { category } = toServerCategory({ category: id, title: id === 'other' ? '동창 모임' : '' });
    assert.ok(SERVER_CODES.includes(category), id + ' → ' + category);
  }
  assert.equal(SERVER_CATEGORY.transport, 'TRANSIT');          // 그냥 대문자로 바꾸면 TRANSPORT 라서 서버가 거절한다
  assert.equal(SERVER_CATEGORY.shopping, 'ONLINE_SHOPPING');   // 2026-11-23 결정: 쇼핑은 온라인쇼핑
  assert.equal(SERVER_CATEGORY.medical, 'HOSPITAL');
  assert.equal(SERVER_CATEGORY.travel, 'TRAVEL_AGENCY');
});

test('서버로 보냈다가 다시 읽어도 같은 앱 업종으로 돌아온다', () => {
  for (const id of APP_CATEGORIES) {
    const event = { category: id, title: id === 'other' ? '동창 모임' : '' };
    const sent = toServerCategory(event);
    const back = fromServerCategory({ category: sent.category, title: sent.title, categoryName: '서버 업종 이름' });
    assert.equal(back.category, id, id);
    assert.equal(back.title, event.title, id);
  }
});

test('서버 업종이 하나로 합쳐지는 것은 이름으로 구분한다 (기차, PC방)', () => {
  assert.deepEqual(toServerCategory({ category: 'train' }), { category: 'INTERCITY_TRANSIT', title: '기차' });
  assert.deepEqual(toServerCategory({ category: 'intercity' }), { category: 'INTERCITY_TRANSIT', title: null });
  assert.deepEqual(toServerCategory({ category: 'pcroom' }), { category: 'OTHER', title: 'PC방' });
  assert.deepEqual(fromServerCategory({ category: 'INTERCITY_TRANSIT', title: null }), { category: 'intercity', title: '' });
});

test('직접 입력(기타)은 이름을 그대로 주고받는다', () => {
  assert.deepEqual(toServerCategory({ category: 'other', title: '동창 모임' }), { category: 'OTHER', title: '동창 모임' });
  assert.deepEqual(fromServerCategory({ category: 'OTHER', title: '동창 모임' }), { category: 'other', title: '동창 모임' });
});

test('앱에 없는 서버 업종은 기타로 보여 주고 업종 이름을 일정 이름으로 쓴다', () => {
  assert.deepEqual(fromServerCategory({ category: 'MART', title: null, categoryName: '대형마트' }), { category: 'other', title: '대형마트' });
  assert.deepEqual(fromServerCategory({ category: 'MART', title: '장보기', categoryName: '대형마트' }), { category: 'other', title: '장보기' });
  assert.deepEqual(fromServerCategory({ category: null }), { category: 'other', title: '일정' });
});

test('일반 업종에 붙은 이름은 그대로 보낸다', () => {
  assert.deepEqual(toServerCategory({ category: 'cafe', title: '' }), { category: 'CAFE', title: null });
  assert.deepEqual(toServerCategory({ category: 'cafe', title: '스타벅스 강남' }), { category: 'CAFE', title: '스타벅스 강남' });
});
