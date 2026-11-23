import test from 'node:test';
import assert from 'node:assert/strict';
import { barRatios, findCatalogCard, missedTags, missedView, monthLabel, peakLine, periodLine, splitLine, topCards, won } from '../yearEndCore.js';

const summary = { year: 2026, from: '2026-01-01', until: '2026-11-23T14:05:00', count: 1633, benefit: 533440, promotion: 7000, total: 540440 };
const months = [{ month: '2026-05', total: 60140 }, { month: '2026-06', total: 64110 }, { month: '2026-07', total: 64110 }];

test('wonAndPeriod', () => {
  assert.equal(won(540440), '540,440원');
  assert.equal(periodLine(summary), '1월 1일 ~ 11월 23일 · 결제 1,633건');
  assert.equal(monthLabel('2026-06'), '6월');
});

test('splitLineHidesZeroPromotion', () => {
  assert.equal(splitLine(summary), '카드 혜택 533,440원 · 가맹점 행사 7,000원');
  assert.equal(splitLine({ ...summary, promotion: 0 }), '카드 혜택 533,440원');
});

test('peakLinePicksEarliestLargest', () => {
  assert.equal(peakLine(months), '가장 많이 받은 달은 6월, 64,110원이에요');
});

test('peakLineHiddenWhenAllZero', () => {
  assert.equal(peakLine([{ month: '2026-01', total: 0 }, { month: '2026-02', total: 0 }]), null);
  assert.equal(peakLine([]), null);
  assert.deepEqual(barRatios([{ month: '2026-01', total: 0 }]), [0]);
});

test('peakAndBarsWithOneMonth', () => {
  assert.equal(peakLine([{ month: '2026-01', total: 1200 }]), '가장 많이 받은 달은 1월, 1,200원이에요');
  assert.deepEqual(barRatios([{ month: '2026-01', total: 1200 }]), [1]);
  assert.deepEqual(barRatios([{ month: '2026-01', total: 50 }, { month: '2026-02', total: 100 }]), [0.5, 1]);
});

test('topCardsDropsZero', () => {
  const cards = [{ userCardId: 2, total: 900 }, { userCardId: 3, total: 500 }, { userCardId: 4, total: 0 }, { userCardId: 5, total: 100 }, { userCardId: 6, total: 50 }];
  assert.deepEqual(topCards(cards).map(c => c.userCardId), [2, 3, 5]);
});

test('missedTagsSwapAndAdd', () => {
  assert.deepEqual(missedTags({ basis: 'swap', replaces: 'KB ALL 카드', annual_fee: 15000, months: 11 }),
    ['KB ALL 카드 대신', '연회비 13,750원 빼고 계산']);
  assert.deepEqual(missedTags({ basis: 'add', replaces: null, annual_fee: 0, months: 11 }), ['지금 카드에 더해서']);
  assert.deepEqual(missedTags({ basis: 'add', replaces: null, annual_fee: 47000, months: 7 }),
    ['지금 카드에 더해서', '연회비 27,417원 빼고 계산']);
});

test('missedViewNonArrayIsError', () => {
  assert.deepEqual(missedView({ detail: '없는 사용자입니다' }), { state: 'error', items: [] });
  assert.deepEqual(missedView(null), { state: 'error', items: [] });
  assert.deepEqual(missedView([]), { state: 'empty', items: [] });
  assert.equal(missedView([{ card_id: 1 }]).state, 'ready');
});

test('findCatalogCardMissing', () => {
  const catalog = [{ name: '신한카드 Discount Plan', code: 'SH_DISCOUNT_PLAN' }];
  assert.equal(findCatalogCard(catalog, ' 신한카드 Discount Plan ').code, 'SH_DISCOUNT_PLAN');
  assert.equal(findCatalogCard(catalog, '없는 카드'), null);
  assert.equal(findCatalogCard(catalog, undefined), null);
});
