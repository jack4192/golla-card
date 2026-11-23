// 실행: node --test utils/__tests__/promotionsCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROMO_TEXT, activePromotions, benefitStatus, selectDailyPromotion, toBenefitRows } from '../promotionsCore.js';

const MEGA = { promotionId: 1, kind: 'event', name: '메가MGC커피', benefitType: 'point', benefitText: '500 마이신한포인트 적립',
  minAmount: null, maxAmount: null, start: '2026-11-01', end: '2026-11-30', payout: '2026-12-13',
  method: '신한 슈퍼SOL/SOL페이 바코드 결제', note: '키오스크에서 바코드 스캔 필요', needsCheck: false, logoUrl: '/brand-logos/mega.png' };
const ELEVEN = { promotionId: 8, kind: 'myshop', name: '11번가', benefitType: 'cashback', benefitText: '3,000원 캐시백',
  minAmount: 50000, maxAmount: null, start: '2026-11-01', end: '2026-11-30', payout: '결제일에 따라 다름',
  method: '마이샵 혜택 ON 설정 후 신한카드 결제', note: null, needsCheck: false, logoUrl: null };

test('서버 행사를 혜택 탭 행으로 바꾸고 로고에 서버 주소를 붙인다', () => {
  const [mega, eleven] = toBenefitRows([MEGA, ELEVEN], 'http://x:8090');
  assert.deepEqual(mega, { id: 'promo-1', promotionId: 1, type: '이벤트', merchant: '메가MGC커피', benefit: '500 마이신한포인트 적립',
    minimum: null, cap: null, start: '2026-11-01', end: '2026-11-30', payout: '2026-12-13',
    method: '신한 슈퍼SOL/SOL페이 바코드 결제', note: '키오스크에서 바코드 스캔 필요', needsCheck: false,
    logo: { uri: 'http://x:8090/brand-logos/mega.png' } });
  assert.equal(eleven.type, '마이샵');
  assert.equal(eleven.minimum, 50000);
  assert.equal(eleven.note, '');
  assert.equal(eleven.logo, null);
});

test('배열이 아니면 빈 목록', () => {
  assert.deepEqual(toBenefitRows(null, 'http://x'), []);
  assert.deepEqual(toBenefitRows({ error: 'x' }, 'http://x'), []);
});

test('기간 상태: 진행 예정 · 기간 내 · 기간 종료', () => {
  const row = { start: '2026-11-16', end: '2026-11-30' };
  assert.equal(benefitStatus(row, '2026-11-10'), '진행 예정');
  assert.equal(benefitStatus(row, '2026-11-16'), '기간 내');
  assert.equal(benefitStatus(row, '2026-12-01'), '기간 종료');
});

test('진행 중인 이벤트만 (마이샵·기간 밖은 뺀다)', () => {
  const rows = toBenefitRows([MEGA, ELEVEN, { ...MEGA, promotionId: 3, start: '2026-11-16' }], '');
  assert.deepEqual(activePromotions(rows, '2026-11-10').map(r => r.promotionId), [1]);
  assert.deepEqual(activePromotions(rows, '2026-11-20').map(r => r.promotionId), [1, 3]);
});

test('오늘의 프로모션은 날짜마다 돌아가며 고른다 (예전 함수와 같은 순서)', () => {
  const items = ['a', 'b', 'c'];
  const day = Date.UTC(2026, 10, 18) - 9 * 60 * 60 * 1000;      // 2026-11-18 0시 KST
  assert.equal(selectDailyPromotion(items, day), 'a');
  assert.equal(selectDailyPromotion(items, day + 86400000), 'b');
  assert.equal(selectDailyPromotion([], day), null);
});

test('데모 모드·실패 문구', () => {
  assert.equal(PROMO_TEXT.demo, '서버에 연결하면 진행 중인 행사를 볼 수 있어요');
  assert.equal(PROMO_TEXT.failed, '행사를 불러오지 못했어요');
  assert.equal(PROMO_TEXT.retry, '다시 시도');
});

// ---------- 최종 검토 반영: 행사를 못 읽은 상태를 '0건'·'행사 없음'으로 말하지 않기, 로고 파일이 없으면 이름만 ----------
import { benefitSummary, emptyPromotionText, promotionAnswer, visibleLogo } from '../promotionsCore.js';

test('혜택 요약은 다 읽었을 때만 (데모·읽는 중·실패에는 0건을 보이지 않는다)', () => {
  const rows = toBenefitRows([MEGA, ELEVEN, { ...MEGA, promotionId: 9, start: '2026-11-01', end: '2026-11-15' }], '');
  assert.equal(benefitSummary('off', [], '2026-11-23'), null);
  assert.equal(benefitSummary('loading', [], '2026-11-23'), null);
  assert.equal(benefitSummary('failed', [], '2026-11-23'), null);
  assert.deepEqual(benefitSummary('ready', rows, '2026-11-23'), { total: 3, active: 2 });
});

test('기본 안내 답과 오늘의 프로모션 빈 문구는 상태에 맞게', () => {
  assert.equal(promotionAnswer('off', []), PROMO_TEXT.demo);
  assert.equal(promotionAnswer('failed', []), PROMO_TEXT.failed);
  assert.equal(promotionAnswer('loading', []), PROMO_TEXT.loading);
  assert.equal(promotionAnswer('ready', []), '지금 진행 중인 프로모션이 없어요.');
  const active = toBenefitRows([MEGA], '');
  assert.match(promotionAnswer('ready', active), /^지금 진행 중인 프로모션이 1개 있어요\. 예: 메가MGC커피\./);
  assert.equal(emptyPromotionText('off'), PROMO_TEXT.demo);
  assert.equal(emptyPromotionText('failed'), PROMO_TEXT.failed);
  assert.equal(emptyPromotionText('ready'), '현재 진행 중인 이벤트가 없어요.');
});

test('로고 파일을 못 받으면 그림 대신 이름 (그 주소만)', () => {
  const logo = { uri: 'http://x/brand-logos/mega.png' };
  assert.equal(visibleLogo(logo, new Set()), logo);
  assert.equal(visibleLogo(logo, new Set(['http://x/brand-logos/mega.png'])), null);
  assert.equal(visibleLogo(null, new Set()), null);
});
