// 실행: node --test utils/__tests__/homeChat.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor, toChatHistory, withJosa } from '../homeChat.js';

const cards = [{ name: 'KB ALL 카드' }, { name: '신한카드 SOL트래블 체크' }, { name: '신한카드 Discount Plan' }];

test('조사는 받침에 맞추고, 영어로 끝나 알 수 없으면 둘 다 적는다', () => {
  assert.equal(withJosa('KB ALL 카드', '로'), 'KB ALL 카드로');
  assert.equal(withJosa('신한카드 SOL트래블 체크', '는'), '신한카드 SOL트래블 체크는');
  assert.equal(withJosa('신한 모두의카드', '은'), '신한 모두의카드는');
  assert.equal(withJosa('신한카드 국민행복(체크)', '로'), '신한카드 국민행복(체크)로');
  assert.equal(withJosa('신한카드 처음 체크 우편', '로'), '신한카드 처음 체크 우편으로');
  assert.equal(withJosa('신한카드 처음 체크 통장', '로'), '신한카드 처음 체크 통장으로');
  assert.equal(withJosa('신한카드 처음 체크 지갑', '로'), '신한카드 처음 체크 지갑으로');
  assert.equal(withJosa('신한카드 처음 체크 서울', '로'), '신한카드 처음 체크 서울로');  // ㄹ 받침은 '로'
  assert.equal(withJosa('신한카드 Discount Plan', '로'), '신한카드 Discount Plan으로');   // 영어도 끝소리로 (2026-11-25)
  assert.equal(withJosa('신한카드 Discount Plan', '는'), '신한카드 Discount Plan은');
});

test('탭마다 8개 안팎이고, 겹치지 않으며, 내 카드 이름이 들어간다', () => {
  for (const tab of ['home', 'schedule', 'benefits', 'cards']) {
    const list = suggestionsFor(tab, cards);
    assert.ok(list.length >= 7 && list.length <= 9, tab + ' ' + list.length);
    assert.equal(new Set(list).size, list.length, tab);
    assert.ok(!list.some(q => /\{|\}|undefined|null/.test(q)), tab);
  }
  const all = ['home', 'schedule', 'benefits', 'cards'].flatMap(tab => suggestionsFor(tab, cards)).join('\n');
  assert.match(all, /신한카드 SOL트래블 체크로 내면 얼마 손해야\?/);   // 2순위 카드로 가정 계산
  assert.match(all, /KB ALL 카드 혜택 알려줘/);
  assert.match(all, /지금 결제하기 좋은 카드 알려줘/);                 // 2026-11-23 결정: '오늘 일정에 맞는 카드' 대신
  assert.doesNotMatch(all, /오늘 일정에 맞는 카드/);
  assert.match(all, /진행 중인 프로모션 알려줘/);
  assert.match(all, /일정은 어떻게 추가해\?/);
  assert.match(all, /카드 등록은 어떻게 해\?/);
});

test('카드가 없거나 한 장이면 카드 이름이 필요한 질문은 빼고, 모르는 탭은 홈 질문을 쓴다', () => {
  const none = suggestionsFor('home', []);
  assert.ok(none.length >= 5 && !none.some(q => /카드로 내면|카드 혜택 알려줘/.test(q)));
  const one = suggestionsFor('home', [{ name: 'KB ALL 카드' }]);
  assert.ok(!one.some(q => q.includes('로 내면 얼마 손해야')));          // 비교할 2순위 카드가 없다
  assert.deepEqual(suggestionsFor('payment', cards), suggestionsFor('home', cards));
});

test('챗봇에 보낼 이전 대화: 인사말·준비 중·연결 실패 답은 빼고 최근 것만', () => {
  const messages = [
    { role: 'bot', text: '안녕하세요', greeting: true },
    { role: 'user', text: 'q1' }, { role: 'bot', text: 'a1' },
    { role: 'user', text: 'q2' }, { role: 'bot', text: '기본 안내', offline: true },
    { role: 'user', text: 'q3' }, { role: 'bot', text: 'a3' },
    { role: 'user', text: 'q4' }, { role: 'bot', text: '답변을 준비하고 있어요…', pending: true },
  ];
  assert.deepEqual(toChatHistory(messages, 2), [
    { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' },
    { role: 'user', text: 'q3' }, { role: 'assistant', text: 'a3' },
  ]);
  assert.deepEqual(toChatHistory(messages, 1), [{ role: 'user', text: 'q3' }, { role: 'assistant', text: 'a3' }]);
  assert.deepEqual(toChatHistory([], 4), []);
});
