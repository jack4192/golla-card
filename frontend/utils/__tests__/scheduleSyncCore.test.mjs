// 실행: node --test utils/__tests__/scheduleSyncCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_CATEGORY, planSync, signatureOf, toServerSchedule } from '../scheduleSyncCore.js';

const place = (over = {}) => ({ id: 'e1', date: '2026-11-23', types: [], category: 'cafe', start: '12:00', end: '13:00', title: '', memo: '', ...over });
const situation = (over = {}) => ({ id: 's1', date: '2026-11-23', types: ['team_dinner'], memo: '', ...over });

test('앱의 모든 장소 업종에 서버 업종이 정해져 있다', () => {
  const appCategories = ['cafe', 'restaurant', 'pcroom', 'travel', 'train', 'intercity', 'transport', 'taxi', 'convenience', 'delivery', 'fuel', 'shopping', 'medical', 'other'];
  for (const id of appCategories) assert.ok(SERVER_CATEGORY[id], id);
  assert.equal(SERVER_CATEGORY.cafe, 'CAFE');
  assert.equal(SERVER_CATEGORY.shopping, 'ONLINE_SHOPPING');   // 2026-11-23 결정: 쇼핑은 온라인쇼핑
  assert.equal(SERVER_CATEGORY.train, 'INTERCITY_TRANSIT');
  assert.equal(SERVER_CATEGORY.intercity, 'INTERCITY_TRANSIT');
  assert.equal(SERVER_CATEGORY.medical, 'HOSPITAL');
});

test('장소 일정: 업종 코드를 서버 것으로 바꾸고 시간은 그대로', () => {
  assert.deepEqual(toServerSchedule(place()), { date: '2026-11-23', category: 'CAFE', start: '12:00', end: '13:00' });
  assert.deepEqual(toServerSchedule(place({ end: '24:00', memo: ' 친구랑 ' })),
    { date: '2026-11-23', category: 'CAFE', start: '12:00', end: '24:00', memo: '친구랑' });
});

test('서버에 맞는 업종이 없는 PC방·기타는 기타(OTHER)로, 이름을 함께 보낸다', () => {
  assert.deepEqual(toServerSchedule(place({ category: 'pcroom' })),
    { date: '2026-11-23', category: 'OTHER', title: 'PC방', start: '12:00', end: '13:00' });
  assert.deepEqual(toServerSchedule(place({ category: 'other', title: '동창 모임' })),
    { date: '2026-11-23', category: 'OTHER', title: '동창 모임', start: '12:00', end: '13:00' });
});

test('상황 일정: 종류를 그대로 보내고, 시간은 있을 때만', () => {
  assert.deepEqual(toServerSchedule(situation()), { date: '2026-11-23', types: ['team_dinner'] });
  assert.deepEqual(toServerSchedule(situation({ start: '19:00', end: '21:00', memo: '강남' })),
    { date: '2026-11-23', types: ['team_dinner'], start: '19:00', end: '21:00', memo: '강남' });
});

test('상황 일정의 직접 입력 이름은 서버에 둘 곳이 없어 메모로 보낸다', () => {
  assert.deepEqual(toServerSchedule(situation({ types: ['other'], title: '이사' })),
    { date: '2026-11-23', types: ['other'], memo: '이사' });
  assert.deepEqual(toServerSchedule(situation({ types: ['other'], title: '이사', memo: '오전' })),
    { date: '2026-11-23', types: ['other'], memo: '오전' });
});

test('서버로 보낼 수 없는 일정은 null', () => {
  assert.equal(toServerSchedule(place({ category: 'unknown' })), null);
  assert.equal(toServerSchedule(situation({ types: [] })), null);
  assert.equal(toServerSchedule(null), null);
});

test('계획: 오늘 이후의 새 일정은 올리고, 지난 일정은 올리지 않는다', () => {
  const events = [place({ id: 'today' }), place({ id: 'past', date: '2026-11-22' }), place({ id: 'later', date: '2026-12-01' })];
  const plan = planSync(events, {}, '2026-11-23');
  assert.deepEqual(plan.create.map(item => item.id), ['today', 'later']);
  assert.deepEqual(plan.update, []);
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.create[0].body.category, 'CAFE');
  assert.equal(typeof plan.create[0].signature, 'string');
});

test('계획: 이미 올린 일정은 내용이 바뀌었을 때만 고친다', () => {
  const event = place({ id: 'a' });
  const first = planSync([event], {}, '2026-11-23').create[0];
  const links = { a: { serverId: 7, signature: first.signature } };

  assert.deepEqual(planSync([event], links, '2026-11-23'), { create: [], update: [], remove: [] });

  const changed = planSync([{ ...event, start: '14:00', end: '15:00' }], links, '2026-11-23');
  assert.equal(changed.update.length, 1);
  assert.equal(changed.update[0].serverId, 7);
  assert.equal(changed.update[0].body.start, '14:00');
});

test('계획: 기기에서 지운 일정은 서버에서도 지운다 (지난 일정이어도)', () => {
  const links = { gone: { serverId: 9, signature: 'x' }, pastGone: { serverId: 10, signature: 'y' } };
  const plan = planSync([], links, '2026-11-23');
  assert.deepEqual(plan.remove, [{ id: 'gone', serverId: 9 }, { id: 'pastGone', serverId: 10 }]);
});

test('계획: 서버가 거절한 일정은 내용이 바뀌기 전까지 다시 보내지 않는다', () => {
  const event = place({ id: 'r' });
  const signature = planSync([event], {}, '2026-11-23').create[0].signature;
  const links = { r: { serverId: null, rejected: signature } };

  assert.deepEqual(planSync([event], links, '2026-11-23').create, []);
  assert.equal(planSync([{ ...event, end: '13:30' }], links, '2026-11-23').create.length, 1);
  // 거절된 채 기기에서 지웠으면 서버에는 지울 것이 없다
  assert.deepEqual(planSync([], links, '2026-11-23').remove, []);
});

test('계획: 날짜를 지난 날로 옮긴 일정도 서버에 반영한다', () => {
  const event = place({ id: 'm' });
  const signature = planSync([event], {}, '2026-11-23').create[0].signature;
  const plan = planSync([{ ...event, date: '2026-11-20' }], { m: { serverId: 3, signature } }, '2026-11-23');
  assert.equal(plan.update.length, 1);
  assert.equal(plan.update[0].body.date, '2026-11-20');
});

test('비교값(signature)에는 일정 내용이 그대로 들어가지 않고, 내용이 다르면 값도 다르다', () => {
  const a = signatureOf(toServerSchedule(place({ memo: '비밀 약속' })));
  const b = signatureOf(toServerSchedule(place({ memo: '다른 약속' })));
  assert.notEqual(a, b);
  assert.ok(!a.includes('비밀'));
  assert.equal(a, signatureOf(toServerSchedule(place({ memo: '비밀 약속' }))));
});

test('계획: 고치기를 서버가 거절했으면 같은 내용으로 다시 고치지 않는다', () => {
  const event = place({ id: 'u' });
  const signature = planSync([event], {}, '2026-11-23').create[0].signature;
  const changed = { ...event, start: '14:00', end: '15:00' };
  const rejected = planSync([changed], { u: { serverId: 4, signature } }, '2026-11-23').update[0].signature;

  assert.deepEqual(planSync([changed], { u: { serverId: 4, signature, rejected } }, '2026-11-23').update, []);
  // 지우면 서버에서도 지운다
  assert.deepEqual(planSync([], { u: { serverId: 4, signature, rejected } }, '2026-11-23').remove, [{ id: 'u', serverId: 4 }]);
});
