// 실행: node --test utils/__tests__/aiPlacementCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRank, cardsToRegister, chatHistory, matchWalletToServer, normalizeCardName } from '../aiPlacementCore.js';

const wallet = [
  { id: 'SH_DISCOUNT_PLAN', name: '신한카드 Discount Plan' },
  { id: 'KB_ALL', name: 'KB ALL 카드' },
  { id: 'SH_HI_POINT_PLAN', name: '신한카드 Hi-Point Plan' },      // DB 에 없는 카드
];
const server = [
  { userCardId: 11, cardCode: '1', name: '신한카드  discount plan' }, // 띄어쓰기·대소문자가 달라도 같은 카드
  { userCardId: 12, cardCode: '17', name: 'KB ALL 카드' },
  { userCardId: 13, cardCode: '5', name: '신한카드 ECO Plan' },       // 기기 지갑에는 없는 카드
];
const products = [
  { cardCode: '1', name: '신한카드 Discount Plan' },
  { cardCode: '17', name: 'KB ALL 카드' },
  { cardCode: '5', name: '신한카드 ECO Plan' },
];

test('이름은 띄어쓰기와 대소문자를 무시하고 비교한다', () => {
  assert.equal(normalizeCardName(' 신한카드  Discount Plan '), normalizeCardName('신한카드discount plan'));
});

test('기기 지갑 카드를 서버의 내 카드와 이름으로 잇는다', () => {
  assert.deepEqual(matchWalletToServer(wallet, server), { SH_DISCOUNT_PLAN: 11, KB_ALL: 12 });
});

test('서버에 없는 지갑 카드만 등록 대상이고, 카드 상품에 없는 카드는 등록하지 못한다', () => {
  const plan = cardsToRegister(wallet, [server[0]], products);
  assert.deepEqual(plan.register, [{ walletId: 'KB_ALL', cardCode: '17' }]);
  assert.deepEqual(plan.unsupported, ['SH_HI_POINT_PLAN']);
});

test('모두 서버에 있으면 등록할 것이 없다', () => {
  const plan = cardsToRegister(wallet.slice(0, 2), server, products);
  assert.deepEqual(plan.register, []);
  assert.deepEqual(plan.unsupported, []);
});

test('AI 순위대로 지갑 카드를 세우고, 순위에 없는 카드는 뒤에 붙인다', () => {
  const rank = {
    recommendation_id: 70,
    reason_code: 'TIME_BENEFIT',
    cards: [
      { user_card_id: 12, rank: 1, message: '지금은 KB ALL 카드가 유리해요' },
      { user_card_id: 11, rank: 2, message: '' },
    ],
  };
  const result = applyRank(wallet, rank, matchWalletToServer(wallet, server));
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
  const result = applyRank(wallet, rank, matchWalletToServer(wallet, server));
  assert.equal(result.topId, 'SH_DISCOUNT_PLAN');
  assert.equal(result.message, '');
});

test('AI 가 답하지 못해 기본 순서가 온 경우를 구분한다', () => {
  const rank = { recommendation_id: null, reason_code: 'FALLBACK', cards: [{ user_card_id: 11, rank: 1, message: 'AI 응답이 없어 기본 순서로 보여 드려요' }] };
  const result = applyRank(wallet, rank, matchWalletToServer(wallet, server));
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
  assert.deepEqual(matchWalletToServer(wallet, null), {});
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
