// 실행: node --test utils/__tests__/dayTimelineCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MINUTE, cardChangeDots, minuteOfDay, minuteToRatio, paymentAt, paymentDots, paymentLine, paymentRowText,
  ratioToMinute, scrubbedCard, segmentAt, timeLabel, toDaySegments,
} from '../dayTimelineCore.js';

const wallet = [
  { id: 'SH_DISCOUNT_PLAN', name: '신한카드 Discount Plan' },
  { id: 'KB_ALL', name: 'KB ALL 카드' },
];
const linked = { SH_DISCOUNT_PLAN: 11, KB_ALL: 12 };   // 지갑 카드 id → 서버 userCardId (13 은 지갑에 없음)

const response = {
  day: '2026-11-23',
  segments: [
    { start: '00:00', end: '11:00', user_card_id: 11, message: '지금은 Discount Plan', reason_code: 'HABIT',
      cards: [{ user_card_id: 11, rank: 1 }, { user_card_id: 12, rank: 2 }] },
    { start: '11:00', end: '13:00', user_card_id: 13, message: '없는 카드 문구', reason_code: 'HABIT',
      cards: [{ user_card_id: 13, rank: 1 }, { user_card_id: 12, rank: 2 }] },
    { start: '13:00', end: '24:00', user_card_id: 12, message: 'KB ALL 이 유리해요', reason_code: 'HABIT',
      cards: [{ user_card_id: 12, rank: 1 }] },
  ],
};

const coffee = { paymentId: 9, paidAt: '2026-11-23T08:12:00', merchantName: '스타벅스', amount: 5400,
  benefitAmount: 540, promotionAmount: 0, cardName: '신한 모두의카드' };
const lunch = { paymentId: 10, paidAt: '2026-11-23T12:31:00', merchantName: '김밥천국', amount: 8000,
  benefitAmount: 0, promotionAmount: 0, cardName: '신한카드 Discount Plan' };

test('표시줄 위치를 10분 단위 시각으로 바꾸고 0~23:50 안에 둔다', () => {
  assert.equal(ratioToMinute(-0.2), 0);
  assert.equal(ratioToMinute(1.3), MAX_MINUTE);
  assert.equal(MAX_MINUTE, 1430);
  assert.equal(ratioToMinute(0.5), 720);
  assert.equal(ratioToMinute(0.5034), 720);
  assert.equal(ratioToMinute(0.5035), 730);
  assert.equal(minuteToRatio(720), 0.5);
  assert.equal(minuteOfDay(new Date(2026, 10, 23, 19, 48)), 1188);
  assert.equal(timeLabel(1188), '19:48');
  assert.equal(timeLabel(0), '00:00');
});

test('하루 배치 구간을 지갑 카드로 바꾸고, 1순위가 지갑에 없으면 다음 순위 카드를 쓴다', () => {
  const segments = toDaySegments(response, linked);
  assert.deepEqual(segments.map(s => [s.startMin, s.endMin, s.walletId]),
    [[0, 660, 'SH_DISCOUNT_PLAN'], [660, 780, 'KB_ALL'], [780, 1440, 'KB_ALL']]);
  assert.equal(segments[0].message, '지금은 Discount Plan');
  assert.equal(segments[1].message, '');   // 1순위(13)가 지갑에 없어 2순위 카드를 보이므로 1순위 문구는 쓰지 않는다
  assert.deepEqual(toDaySegments(null, linked), []);
  assert.deepEqual(toDaySegments({ segments: 'x' }, linked), []);
});

test('시각이 속한 구간을 찾는다 (경계는 뒤 구간)', () => {
  const segments = toDaySegments(response, linked);
  assert.equal(segmentAt(segments, 660).startMin, 660);
  assert.equal(segmentAt(segments, 659).startMin, 0);
  assert.equal(segmentAt([], 100), null);
});

test('옮긴 시각의 큰 카드: 구간 카드, 없으면 결제 카드와 실패 문구', () => {
  const segments = toDaySegments(response, linked);
  const fallbackCard = wallet[0];
  assert.deepEqual(scrubbedCard({ segments, minute: 800, walletCards: wallet, fallbackCard }),
    { card: wallet[1], note: 'KB ALL 이 유리해요' });
  assert.deepEqual(scrubbedCard({ segments: [], minute: 800, walletCards: wallet, fallbackCard }),
    { card: fallbackCard, note: '이 시각 AI 카드를 불러오지 못했어요' });
  assert.deepEqual(scrubbedCard({ segments: null, minute: 800, walletCards: wallet, fallbackCard }),
    { card: fallbackCard, note: '이 시각 AI 카드를 불러오지 못했어요' });
});

test('결제 점: 기준 시각 이후 결제는 빼고 위치를 하루 비율로', () => {
  const dots = paymentDots([coffee, lunch], 600);
  assert.equal(dots.length, 1);
  assert.equal(dots[0].minute, 492);
  assert.equal(dots[0].ratio, 492 / 1440);
  assert.equal(dots[0].payment, coffee);
  assert.equal(paymentDots([coffee, lunch], 1000).length, 2);
});

test('옮긴 시각과 10분 안쪽의 가장 가까운 결제를 고른다', () => {
  assert.equal(paymentAt([coffee, lunch], 490), coffee);
  assert.equal(paymentAt([coffee, lunch], 510), null);
  assert.equal(paymentAt([coffee, lunch], 750), lunch);
});

test('결제 한 줄 문구', () => {
  assert.deepEqual(paymentRowText(coffee, '2026-11-23'),
    { when: '08:12', merchant: '스타벅스', amount: '5,400원', card: '신한 모두의카드', benefit: '-540원' });
  const older = { ...lunch, paidAt: '2026-11-04T18:01:36' };
  assert.equal(paymentRowText(older, '2026-11-23').when, '11/4 18:01');
  assert.equal(paymentRowText(lunch, '2026-11-23').benefit, '');
  assert.equal(paymentLine(coffee), '이 시각 결제: 스타벅스 5,400원 · 신한 모두의카드');
});

test('카드가 바뀌는 시각(노란 점): 경계마다 앞뒤 카드가 다를 때만, 0·24시와 겹친 경계는 뺀다', () => {
  const segments = toDaySegments(response, linked);
  const fallbackCard = { id: 'FALLBACK' };
  const cardIdAt = minute => scrubbedCard({ segments, minute, walletCards: wallet, fallbackCard }).card.id;
  // 11:00 에 Discount Plan → KB ALL(1순위가 지갑에 없어 2순위), 13:00 은 KB ALL 그대로라 점이 없다
  const dots = cardChangeDots([780, 0, 660, 660, 1440, ...segments.map(segment => segment.startMin)], cardIdAt);
  assert.deepEqual(dots, [{ key: 'change-660', ratio: minuteToRatio(660), minute: 660 }]);
});

test('카드가 바뀌는 시각: 구간 카드가 없어 결제 카드로 돌아가는 곳도 점, 경계가 없으면 점도 없다', () => {
  const segments = [
    { startMin: 0, endMin: 720, walletId: 'A' },
    { startMin: 720, endMin: 795, walletId: null },        // 지갑에 없는 카드 → 결제 카드
    { startMin: 795, endMin: 1440, walletId: 'A' },
  ];
  const walletCards = [{ id: 'A' }, { id: 'B' }];
  const cardIdAt = minute => scrubbedCard({ segments, minute, walletCards, fallbackCard: { id: 'B' } }).card.id;
  assert.deepEqual(cardChangeDots(segments.map(segment => segment.startMin), cardIdAt).map(dot => dot.minute), [720, 795]);
  assert.deepEqual(cardChangeDots([], cardIdAt), []);
  assert.deepEqual(cardChangeDots(undefined, cardIdAt), []);
});
