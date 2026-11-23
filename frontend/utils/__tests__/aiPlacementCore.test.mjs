// 실행: node --test utils/__tests__/aiPlacementCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRank, chatHistory } from '../aiPlacementCore.js';

const wallet = [
  { id: 'SH_DISCOUNT_PLAN', name: '신한카드 Discount Plan' },
  { id: 'KB_ALL', name: 'KB ALL 카드' },
  { id: 'SH_HI_POINT_PLAN', name: '신한카드 Hi-Point Plan' },      // DB 에 없는 카드
];
// 지갑 카드 id → 서버 userCardId (utils/serverCards.js 의 serverCardLinks 가 주는 모양). 13번은 지갑에 없는 서버 카드
const linked = { SH_DISCOUNT_PLAN: 11, KB_ALL: 12 };

test('AI 순위대로 지갑 카드를 세우고, 순위에 없는 카드는 뒤에 붙인다', () => {
  const rank = {
    recommendation_id: 70,
    reason_code: 'TIME_BENEFIT',
    cards: [
      { user_card_id: 12, rank: 1, message: '지금은 KB ALL 카드가 유리해요' },
      { user_card_id: 11, rank: 2, message: '' },
    ],
  };
  const result = applyRank(wallet, rank, linked);
  assert.deepEqual(result.order, ['KB_ALL', 'SH_DISCOUNT_PLAN', 'SH_HI_POINT_PLAN']);
  assert.equal(result.topId, 'KB_ALL');
  assert.equal(result.message, '지금은 KB ALL 카드가 유리해요');
  assert.equal(result.reasonCode, 'TIME_BENEFIT');
  assert.equal(result.recommendationId, 70);
  assert.equal(result.fallback, false);
  assert.deepEqual(result.unranked, ['SH_HI_POINT_PLAN']);
});

test('순위가 뒤섞여 와도 rank 값으로 정렬한다', () => {
  const rank = { reason_code: 'HABIT', cards: [{ user_card_id: 11, rank: 2, message: '' }, { user_card_id: 12, rank: 1, message: 'm' }] };
  assert.deepEqual(applyRank(wallet, rank, { SH_DISCOUNT_PLAN: 11, KB_ALL: 12 }).order.slice(0, 2), ['KB_ALL', 'SH_DISCOUNT_PLAN']);
});

test('AI 1순위가 기기 지갑에 없는 카드면 그 문구는 쓰지 않는다', () => {
  const rank = {
    reason_code: 'PERFORMANCE',
    cards: [
      { user_card_id: 13, rank: 1, message: 'ECO Plan 실적을 채워 보세요' },   // 서버에만 있는 카드
      { user_card_id: 11, rank: 2, message: '' },
    ],
  };
  const result = applyRank(wallet, rank, linked);
  assert.equal(result.topId, 'SH_DISCOUNT_PLAN');
  assert.equal(result.message, '');
});

test('AI 가 답하지 못해 기본 순서가 온 경우를 구분한다', () => {
  const rank = { recommendation_id: null, reason_code: 'FALLBACK', cards: [{ user_card_id: 11, rank: 1, message: 'AI 응답이 없어 기본 순서로 보여 드려요' }] };
  const result = applyRank(wallet, rank, linked);
  assert.equal(result.fallback, true);
  assert.equal(result.recommendationId, null);
  assert.equal(result.topId, 'SH_DISCOUNT_PLAN');
});

test('순위를 매길 카드가 하나도 없으면 지갑 순서 그대로', () => {
  const result = applyRank(wallet, { reason_code: 'NO_CARD', cards: [] }, {});
  assert.deepEqual(result.order, ['SH_DISCOUNT_PLAN', 'KB_ALL', 'SH_HI_POINT_PLAN']);
  assert.equal(result.topId, null);
  assert.equal(result.message, '');
});

test('응답 모양이 이상해도 죽지 않는다', () => {
  assert.deepEqual(applyRank(wallet, null, {}).order, ['SH_DISCOUNT_PLAN', 'KB_ALL', 'SH_HI_POINT_PLAN']);
  assert.deepEqual(applyRank(wallet, { cards: [{ user_card_id: 11, rank: 1 }] }, null).topId, null);
});

test('챗봇에 보낼 이전 대화: 끝난 문답만, 최근 것부터 정해진 개수까지', () => {
  const messages = [
    { question: 'q1', text: 'a1' },
    { question: 'q2', text: 'a2' },
    { question: 'q3', text: '답변을 준비하고 있어요…', pending: true },
  ];
  assert.deepEqual(chatHistory(messages, 1), [{ role: 'user', text: 'q2' }, { role: 'assistant', text: 'a2' }]);
  assert.equal(chatHistory(messages, 5).length, 4);
});

test('AI 1순위가 지갑에 있으면 예시 거래를 넘기고, 없거나 기본 순서면 null', () => {
  const rank = { cards: [{ user_card_id: 9, rank: 1, message: 'm' }], reason_code: 'PROMOTION', example: { category_code: 'CAFE', amount: 6000 } };
  assert.deepEqual(applyRank([{ id: 'a' }], rank, { a: 9 }).example, rank.example);
  assert.equal(applyRank([{ id: 'a' }], rank, { a: 8 }).example, null);
  assert.equal(applyRank([{ id: 'a' }], { ...rank, example: undefined, reason_code: 'FALLBACK' }, { a: 9 }).example, null);
});
