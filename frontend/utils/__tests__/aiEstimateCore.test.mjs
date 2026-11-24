import test from 'node:test';
import assert from 'node:assert/strict';
import { bestCardOf, chooseEstimateScenario, evaluateRequest, exampleBasisLine, exampleNote, exampleScenario, matchPlace, toEstimates } from '../aiEstimateCore.js';

test('상자 아래 줄은 예시를 고른 근거에 맞게 말한다', () => {
  assert.equal(exampleBasisLine('promotion'), '추천 문구가 말하는 거래로 계산했어요. ');
  assert.equal(exampleBasisLine('benefit'), '추천 문구가 말하는 거래로 계산했어요. ');
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

test('예시 계산이 오기 전·실패하면 일정이나 고정 예시, 계산이 온 예시가 먼저', () => {
  // 일정 결제에는 AI 가 그 일정을 보고 정했을 때만 예시가 넘어온다 (2026-11-23 홈 일정 카드 설계서)
  const fixed = { id: 'coffee' }, sched = { id: 's' }, ex = exampleScenario({ category_code: 'CAFE', amount: 4900 });
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: null, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: {}, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ example: ex, exampleRows: { a: {} }, fixed }), ex);
  assert.equal(chooseEstimateScenario({ example: null, exampleRows: { a: {} }, fixed }), fixed);
  assert.equal(chooseEstimateScenario({ scheduleScenario: sched, example: ex, exampleRows: { a: {} }, fixed }), ex);
  assert.equal(chooseEstimateScenario({ scheduleScenario: sched, example: ex, exampleRows: null, fixed }), sched);
  assert.equal(chooseEstimateScenario({ scheduleScenario: sched, example: null, exampleRows: { a: {} }, fixed }), sched);
});

test('안내 줄은 행사 문구이고 가능성이 0~1 사이일 때만', () => {
  // 문구의 '약 N원'은 이 시간대 행사 혜택 전체의 기대 금액이라(현대백화점 + 올리브영 …) 한 가게 × 가능성과 같지 않다
  const ex = { basis: 'promotion', name: '현대백화점', prob: 0.025 };
  assert.equal(exampleNote(ex, '현대백화점 마이샵 15%로 약 480원을 더 받을 수 있어요!'),
    "추천 문구의 '약 480원'은 이 시간대에 결제할 만한 곳의 행사 혜택을 가능성만큼 더한 금액이에요. 현대백화점에서 결제할 가능성은 약 3%예요.");
  assert.match(exampleNote({ ...ex, prob: 0.004 }, '약 30원'), /1% 미만/);
  assert.equal(exampleNote({ ...ex, prob: 1 }, '약 480원'), '');
  assert.equal(exampleNote({ ...ex, prob: 0 }, '약 480원'), '');
  assert.equal(exampleNote({ ...ex, basis: 'benefit' }, '약 480원'), '');
  assert.equal(exampleNote(ex, '금액 없는 문구'), '');
  assert.equal(exampleNote(null, '약 480원'), '');
});

test('실제 혜택 계산기 입력: 이름·브랜드가 같으면 가맹점, 업종 말은 업종, 앞부분은 브랜드가 하나뿐일 때만 (PR #11 검토)', () => {
  // AI 가맹점 목록처럼 지점이 붙은 이름
  const merchants = [
    { merchant_id: 1, name: '카페베네 역삼점', category_code: 'CAFE' },
    { merchant_id: 2, name: '스타벅스 강남역점', category_code: 'CAFE' },
    { merchant_id: 3, name: '스타벅스 판교점', category_code: 'CAFE' },
    { merchant_id: 4, name: '이디야 성수점', category_code: 'CAFE' },
    { merchant_id: 5, name: '이마트24 역삼점', category_code: 'CONVENIENCE' },
    { merchant_id: 6, name: '이마트 에브리데이 강남점', category_code: 'SUPERMARKET' },
    { merchant_id: 7, name: '이마트 성수점', category_code: 'MART' },
    { merchant_id: 8, name: '배달의민족', category_code: 'DELIVERY' },
    { merchant_id: 9, name: 'GS25 역삼점', category_code: 'CONVENIENCE' },
  ];
  // 업종 말은 그 말로 시작하는 브랜드(카페베네·배달의민족)가 아니라 업종으로
  assert.deepEqual(matchPlace('카페', merchants, 'cafe'), { category: 'cafe' });
  assert.deepEqual(matchPlace('배달', merchants, 'delivery'), { category: 'delivery' });
  // 브랜드 이름이 같으면 업종 분류보다 가맹점이 먼저 (지점은 떼고, 띄어쓰기·대소문자 무시)
  assert.deepEqual(matchPlace('스타벅스', merchants, 'cafe'), { merchant: merchants[1], brand: '스타벅스' });
  assert.equal(matchPlace('이마트', merchants, 'shopping').merchant.merchant_id, 7);
  assert.equal(matchPlace(' gs 25 ', merchants, 'convenience').merchant.merchant_id, 9);
  assert.equal(matchPlace('배달의 민족', merchants, null).merchant.merchant_id, 8);
  // 지점까지 적으면 그 지점
  assert.equal(matchPlace('스타벅스 판교점', merchants, 'cafe').merchant.merchant_id, 3);
  // 앞부분: 브랜드가 하나뿐이면(지점 여럿이어도) 그 가맹점, 여럿이면 모른다
  assert.equal(matchPlace('스타', merchants, null).brand, '스타벅스');
  assert.equal(matchPlace('이마', merchants, null), null);
  // 한 글자, 아무것도 아닌 말, 빈 말
  assert.equal(matchPlace('이', merchants, null), null);
  assert.equal(matchPlace('동네 꽃집', merchants, null), null);
  assert.equal(matchPlace('  ', merchants, 'cafe'), null);
  // 가맹점 목록이 없으면(데모 모드·못 읽음) 업종만
  assert.deepEqual(matchPlace('주유소', [], 'fuel'), { category: 'fuel' });
  assert.equal(matchPlace('스타벅스', undefined, null), null);
});
