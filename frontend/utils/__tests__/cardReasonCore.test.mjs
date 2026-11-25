// 실행: node --test utils/__tests__/cardReasonCore.test.mjs
// 결제 창 '선정 이유' (2026-11-24 팀 결정 '맞을 때만 보이기')
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_TOP_REASON, AUTO_OFF_REASON, PICKED_REASON, cardReason, dropCardName } from '../cardReasonCore.js';

const ai = { topId: 7, message: '스타벅스 갈 시간이라 300원 더 받아요!', fallback: false };

test('AI 가 맨 앞에 둔 카드면 AI 설명을 보여 준다 (끝의 ! 는 뺀다)', () => {
  assert.equal(cardReason({ selectedId: 7, ai }), '스타벅스 갈 시간이라 300원 더 받아요');
});

test('AI 설명이 없으면 정해진 문장에, AI 가 계산한 혜택이 있을 때만 붙인다', () => {
  const quiet = { ...ai, message: '' };
  assert.equal(cardReason({ selectedId: 7, ai: quiet }), AI_TOP_REASON);
  assert.equal(cardReason({ selectedId: 7, ai: quiet, benefit: '스타벅스에서 300원 혜택' }),
    AI_TOP_REASON + ' · 스타벅스에서 300원 혜택');
});

test('카드 번호가 문자열이어도 같은 카드로 본다', () => {
  assert.equal(cardReason({ selectedId: '7', ai }), '스타벅스 갈 시간이라 300원 더 받아요');
});

test('AI 가 다른 카드를 골랐거나, 기본 순서(fallback)거나, 답이 없으면 칸을 숨긴다', () => {
  assert.equal(cardReason({ selectedId: 3, ai }), '');
  assert.equal(cardReason({ selectedId: 7, ai: { ...ai, fallback: true } }), '');
  assert.equal(cardReason({ selectedId: 7, ai: null }), '');
  assert.equal(cardReason({ selectedId: 7, ai: { message: 'x' } }), '');
});

test('자동 배치가 꺼져 있으면 1순위 카드 안내 (AI 가 같은 카드를 골랐어도)', () => {
  assert.equal(cardReason({ selectedId: 7, ai, autoOn: false }), AUTO_OFF_REASON);
  assert.equal(cardReason({ selectedId: 3, ai: null, autoOn: false }), AUTO_OFF_REASON);
});

test('이 창에서 카드를 바꿨으면 직접 고른 카드 (자동 배치가 꺼져 있어도)', () => {
  assert.equal(cardReason({ selectedId: 3, ai, pickedHere: true }), PICKED_REASON);
  assert.equal(cardReason({ selectedId: 3, ai: null, pickedHere: true, autoOn: false }), PICKED_REASON);
});

test('일정에서 연 결제 창이거나 카드가 없으면 칸을 숨긴다', () => {
  assert.equal(cardReason({ selectedId: 7, ai, fromSchedule: true }), '');
  assert.equal(cardReason({ selectedId: 3, ai, pickedHere: true, fromSchedule: true }), '');
  assert.equal(cardReason({ selectedId: 7, ai, autoOn: false, fromSchedule: true }), '');
  assert.equal(cardReason({ selectedId: null, ai }), '');
});

test("정해진 문장에는 'AI가' 가 없다 (수정사항2 결정 5)", () => {
  for (const text of [AI_TOP_REASON, AUTO_OFF_REASON, PICKED_REASON]) assert.ok(!text.includes('AI'), text);
  assert.equal(AUTO_OFF_REASON, '자동 배치가 꺼져 있어 1순위 카드로 결제해요');   // 홈 일정 패널과 같은 문장
});

// 카드가 함께 보이는 곳(홈 카드 뒷면·결제 창)에서는 AI 설명 앞의 카드 이름을 뗀다 (2026-11-25 팀 피드백)
const HOLD = '신한카드 Discount Plan+ 120만 원 구간까지 188,210원 남았어요. 채우면 다음 달에도 지금 혜택을 받아요';

test('AI 설명이 카드 이름으로 시작하면 이름을 뗀다', () => {
  assert.equal(dropCardName(HOLD, '신한카드 Discount Plan+'), '120만 원 구간까지 188,210원 남았어요. 채우면 다음 달에도 지금 혜택을 받아요');
  assert.equal(dropCardName('KB ALL 카드 실적 달성까지 3,000원 남았어요!', 'KB ALL 카드'), '실적 달성까지 3,000원 남았어요!');
  assert.equal(dropCardName('KB ALL 카드 실적을 이미 채웠어요! (어제까지 기준)', 'KB ALL 카드'), '실적을 이미 채웠어요! (어제까지 기준)');
});

test('띄어쓰기가 달라도, 앱 이름에 (가칭)이 있어도 뗀다', () => {
  assert.equal(dropCardName(HOLD, '신한카드  DiscountPlan+'), '120만 원 구간까지 188,210원 남았어요. 채우면 다음 달에도 지금 혜택을 받아요');
  assert.equal(dropCardName('모두의카드 실적 달성까지 1원 남았어요!', '모두의카드(가칭)'), '실적 달성까지 1원 남았어요!');
});

test('카드 이름으로 시작하지 않거나 이름만 있으면 그대로', () => {
  assert.equal(dropCardName('카페에서 결제하면 10% 할인을 받을 수 있어요!', 'KB ALL 카드'), '카페에서 결제하면 10% 할인을 받을 수 있어요!');
  assert.equal(dropCardName('KB ALL 카드', 'KB ALL 카드'), 'KB ALL 카드');
  assert.equal(dropCardName('신한카드 Discount Plan+ 120만 원…', '신한카드 Discount Plan'), '신한카드 Discount Plan+ 120만 원…');
  assert.equal(dropCardName('', 'KB ALL 카드'), '');
  assert.equal(dropCardName(HOLD, ''), HOLD);
});

test('결제 창 선정 이유도 카드 이름을 뗀다', () => {
  const hold = { topId: 7, message: HOLD, fallback: false };
  assert.equal(cardReason({ selectedId: 7, ai: hold, cardName: '신한카드 Discount Plan+' }),
    '120만 원 구간까지 188,210원 남았어요. 채우면 다음 달에도 지금 혜택을 받아요');
});
