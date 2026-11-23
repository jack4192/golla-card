// 실행: node --test utils/__tests__/paymentHistoryCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { countLabel, periodLabel, rowsInPeriod, totalLabel } from '../paymentHistoryCore.js';

const summary = { from: '2026-10-24', until: '2026-11-24T01:12:30', count: 53, amount: 682790 };

test('카드이용내역 머리: 기간·합계·건수 (신한 화면 글자 모양)', () => {
  assert.equal(periodLabel(summary), '2026.10.24 ~ 11.24');
  assert.equal(periodLabel({ from: '2025-12-24', until: '2026-01-24T09:00:00' }), '2025.12.24 ~ 2026.01.24');
  assert.equal(totalLabel(summary), '682,790원');
  assert.equal(countLabel(summary), '총 53건');
  assert.equal(periodLabel(null), '');
  assert.equal(totalLabel(null), '');
  assert.equal(countLabel(undefined), '');
});

test('목록은 기간 안 결제만: 기간 시작보다 오래된 결제가 나오면 거기서 끝', () => {
  const page = [
    { paymentId: 9, paidAt: '2026-10-25T08:00:00' },
    { paymentId: 8, paidAt: '2026-10-24T00:00:00' },
    { paymentId: 7, paidAt: '2026-10-23T23:59:59' },
    { paymentId: 6, paidAt: '2026-10-22T10:00:00' },
  ];
  assert.deepEqual(rowsInPeriod(page, '2026-10-24'), { rows: page.slice(0, 2), ended: true });
  assert.deepEqual(rowsInPeriod(page.slice(0, 2), '2026-10-24'), { rows: page.slice(0, 2), ended: false });
  assert.deepEqual(rowsInPeriod(page, null), { rows: page, ended: false });   // 기간을 못 받았으면 거르지 않는다
});
