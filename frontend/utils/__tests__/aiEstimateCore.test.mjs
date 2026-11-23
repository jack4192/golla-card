import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCardOf, chooseEstimateScenario, evaluateRequest, exampleBasisLine, exampleNote, exampleScenario, toEstimates } from '../aiEstimateCore.js';

test('상자 아래 줄은 예시를 고른 근거에 맞게 말한다', () => {
  assert.equal(exampleBasisLine('promotion'), 'AI 추천 문구가 말하는 거래로 계산했어요. ');
  assert.equal(exampleBasisLine('benefit'), 'AI 추천 문구가 말하는 거래로 계산했어요. ');
  assert.equal(exampleBasisLine('likely'), '지금 시간대에 결제할 가능성이 가장 높은 거래로 계산했어요. ');
  assert.equal(exampleBasisLine('schedule'), '오늘 일정에 맞춘 거래로 계산했어요. ');
  assert.equal(exampleBasisLine(undefined), '');
});

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

// 2026-11-23: 예상 혜택 거래를 AI 배치 문구 속 거래(rank.example)로
test('예시 거래 → 계산 요청: 가맹점이 있으면 함께, 없으면 업종만', () => {
  const ex = { basis: 'promotion', category_code: 'DEPARTMENT_STORE', merchant_id: 67, name: '현대백화점', amount: 77200, prob: 0.041 };
  assert.deepEqual(evaluateRequest(exampleScenario(ex)), { category_code: 'DEPARTMENT_STORE', merchant_id: 67, amount: 77200 });
  assert.deepEqual(evaluateRequest(exampleScenario({ ...ex, merchant_id: null })), { category_code: 'DEPARTMENT_STORE', amount: 77200 });
  assert.equal(exampleScenario({ name: 'x' }), null);
  assert.equal(exampleScenario(null), null);
  assert.equal(exampleScenario(ex).merchant, '현대백화점');
});

test('예시 계산이 오기 전·실패하면 고정 예시, 일정 결제는 늘 일정', () => {
  const fixed = { id: 'coffee' }, sched = { id: 's' }, ex = exampleScenario({ category_code: 'CAFE', amount: 4900 });
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: null, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: {}, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: { a: {} }, fixed }), ex);
  assert.equal(chooseEstimateScenario({ example: null, exampleRows: { a: {} }, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ scheduleScenario: sched, example: ex, exampleRows: { a: {} }, fixed }), sched);
});

test('안내 줄은 행사 문구이고 가능성이 0~1 사이일 때만', () => {
  // 문구의 '약 N원'은 이 시간대 행사 혜택 전체의 기대 금액이라(현대백화점 + 올리브영 …) 한 가게 × 가능성과 같지 않다
  const ex = { basis: 'promotion', name: '현대백화점', prob: 0.025 };
  assert.equal(exampleNote(ex, '현대백화점 마이샵 15%로 약 480원을 더 받을 수 있어요!'),
    "AI 문구의 '약 480원'은 이 시간대에 결제할 만한 곳의 행사 혜택을 가능성만큼 더한 금액이에요. 현대백화점에서 결제할 가능성은 약 3%예요.");
  assert.match(exampleNote({ ...ex, prob: 0.004 }, '약 30원'), /1% 미만/);
  assert.equal(exampleNote({ ...ex, prob: 1 }, '약 480원'), '');
  assert.equal(exampleNote({ ...ex, prob: 0 }, '약 480원'), '');
  assert.equal(exampleNote({ ...ex, basis: 'benefit' }, '약 480원'), '');
  assert.equal(exampleNote(ex, '금액 없는 문구'), '');
  assert.equal(exampleNote(null, '약 480원'), '');
});
