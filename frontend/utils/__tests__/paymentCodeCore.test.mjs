// 실행: node --test utils/__tests__/paymentCodeCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeFromServer, declineMessage, receiptFromPayment, receiptFromRecent, serverCategoryOf, shouldPoll } from '../paymentCodeCore.js';

const NOW = 1_000_000;

test('발급 응답 → 결제 창 코드: 18자리 바코드 숫자, 만료는 기기 시각 + 남은 초', () => {
  const code = codeFromServer({ paymentTokenId: 7, barcodeNumber: '123456789012345678', qrPayload: 'PAYMATE:123456789012345678', expiresInSeconds: 60 }, 'w1', NOW);
  assert.deepEqual(code, { value: '123456789012345678', tokenId: 7, cardId: 'w1', expiresAt: NOW + 60_000, server: true });
  assert.equal(codeFromServer({ paymentTokenId: 7, barcodeNumber: '123456789012345678' }, 'w1', NOW).expiresAt, NOW + 60_000);
});

test('발급 응답이 이상하면(숫자 18자리가 아님·번호 없음) 오류', () => {
  assert.throws(() => codeFromServer({ paymentTokenId: 7, barcodeNumber: '12345' }, 'w1', NOW), /결제 코드를 받지 못했어요/);
  assert.throws(() => codeFromServer({ barcodeNumber: '123456789012345678' }, 'w1', NOW));
  assert.throws(() => codeFromServer(null, 'w1', NOW));
});

test('앱 결제 응답 → 결과: 승인이면 금액·혜택·승인번호, 거절이면 null', () => {
  const receipt = receiptFromPayment({ approved: true, paymentId: 11, approvalNo: 'A0534768', merchantName: '스타벅스', amount: 5300,
    benefitName: '카페 10%', benefitAmount: 530, promotionName: '행사', promotionAmount: 200, totalDiscount: 730, paidAt: '2026-11-24T11:00:00+09:00' });
  assert.equal(receipt.merchantName, '스타벅스');
  assert.equal(receipt.totalDiscount, 730);
  assert.equal(receipt.approvalNo, 'A0534768');
  assert.equal(receiptFromPayment({ approved: false, declineReason: 'EXPIRED' }), null);
  assert.equal(receiptFromPayment(null), null);
});

test('가상 POS 결제: 최근 결제에서 그 번호를 찾고, 없으면 번호만', () => {
  const list = [{ paymentId: 12, merchantName: 'CU', amount: 3700, benefitAmount: 100, promotionAmount: 50 }, { paymentId: 11 }];
  assert.deepEqual([receiptFromRecent(list, 12).merchantName, receiptFromRecent(list, 12).totalDiscount], ['CU', 150]);
  assert.equal(receiptFromRecent({ items: list }, '12').amount, 3700);
  assert.deepEqual(receiptFromRecent(list, 99), { paymentId: 99, merchantName: null, amount: null, benefitAmount: 0, promotionAmount: 0, totalDiscount: 0 });
});

test('거절 사유 문구', () => {
  assert.match(declineMessage('EXPIRED'), /시간이 지난/);
  assert.match(declineMessage('ALREADY_USED'), /이미 결제/);
  assert.match(declineMessage('뭔가'), /승인되지 않았어요/);
});

test('일정 업종 → 서버 업종 코드: 앱 업종은 표로, 서버 코드는 그대로, 기타·모름은 null', () => {
  assert.equal(serverCategoryOf('cafe'), 'CAFE');
  assert.equal(serverCategoryOf('shopping'), 'ONLINE_SHOPPING');
  assert.equal(serverCategoryOf('CAFE'), 'CAFE');
  assert.equal(serverCategoryOf('other'), null);
  assert.equal(serverCategoryOf('pcroom'), null);
  assert.equal(serverCategoryOf('custom:헬스'), null);
  assert.equal(serverCategoryOf(undefined), null);
});

test('상태 확인은 서버 코드가 있고 결과가 없고 만료 전일 때만', () => {
  const code = { server: true, tokenId: 7, expiresAt: NOW + 1000 };
  assert.equal(shouldPoll(code, null, NOW), true);
  assert.equal(shouldPoll(code, { paymentId: 1 }, NOW), false);
  assert.equal(shouldPoll(code, null, NOW + 1000), false);
  assert.equal(shouldPoll({ ...code, server: false }, null, NOW), false);
  assert.equal(shouldPoll(null, null, NOW), false);
});
