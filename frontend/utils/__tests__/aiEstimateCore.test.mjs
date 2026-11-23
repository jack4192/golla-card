import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCardOf, evaluateRequest, toEstimates } from '../aiEstimateCore.js';

const merchants = [{ merchant_id: 3, name: '스타벅스 강남점', category_code: 'CAFE' }, { merchant_id: 9, name: 'CU 역삼점', category_code: 'CONVENIENCE' }];

test('예시 거래 → AI 계산 요청: 가맹점은 이름으로 찾고, 업종만 있으면 업종으로', () => {
  assert.deepEqual(evaluateRequest({ merchant: '스타벅스', namedMerchant: true, amount: 15000 }, merchants),
    { category_code: 'CAFE', merchant_id: 3, amount: 15000 });
  assert.deepEqual(evaluateRequest({ merchant: '음식점', categoryCode: 'RESTAURANT', amount: 30000 }, merchants),
    { category_code: 'RESTAURANT', amount: 30000 });
  assert.equal(evaluateRequest({ merchant: '없는집', namedMerchant: true, amount: 1000 }, merchants), null);
});

test('일정 예시는 앱 업종을 서버 업종으로 바꿔 보낸다', () => {
  assert.deepEqual(evaluateRequest({ schedule: { category: 'transport' }, amount: 5000 }, merchants),
    { category_code: 'TRANSIT', amount: 5000 });
  assert.equal(evaluateRequest({ schedule: { category: 'pcroom' }, amount: 10000 }, merchants), null);   // 서버에 맞는 업종 없음
});

test('AI 결과 → 지갑 카드별 예상 혜택 (원 단위, 행사 포함 여부 안내)', () => {
  const out = toEstimates({ cards: [{ user_card_id: 11, benefit: 1500, promotion: 500, promotion_label: '스타벅스 이벤트 500원' },
    { user_card_id: 12, benefit: 0, promotion: 0, promotion_label: null }, { user_card_id: 99, benefit: 7, promotion: 0 }] },
  { A: 11, B: 12 });
  assert.deepEqual(Object.keys(out), ['A', 'B']);
  assert.equal(out.A.value, 1500);
  assert.equal(out.A.unit, 'KRW');
  assert.match(out.A.name, /스타벅스 이벤트 500원/);
  assert.equal(out.B.value, 0);
  assert.ok(out.B.reason);
  assert.deepEqual(toEstimates(null, { A: 1 }), {});
});

test('일정 카드: 예상 혜택이 가장 큰 카드, 모두 0원이면 없음', () => {
  assert.deepEqual(bestCardOf({ A: { value: 50 }, B: { value: 170 }, C: { value: 0 } }), { walletId: 'B', value: 170 });
  assert.equal(bestCardOf({ A: { value: 0 } }), null);
  assert.equal(bestCardOf(null), null);
});
