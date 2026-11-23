import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSource, toCatalogBenefits, toCatalogCard } from '../serverCatalogCore.js';

const local = [{ code: 'SH_DISCOUNT_PLAN', name: '신한카드 Discount Plan', image: 7, sourcePage: 'https://x' }];
const summary = { cardCode: '1', name: '신한카드  Discount Plan', issuer: '신한', type: 'CREDIT', annualFee: 15000, annualFeeOverseas: 15000, tags: ['카페'], imageUrl: null, description: '설명' };

test('서버 카드 → 카드 탭 모양: 코드·이미지는 앱 데이터에서 이름으로 찾는다', () => {
  const card = toCatalogCard(summary, local);
  assert.equal(card.code, 'SH_DISCOUNT_PLAN');
  assert.equal(card.serverCode, '1');
  assert.equal(card.registryCardId, 1);
  assert.equal(card.type, '신용');
  assert.equal(card.image, 7);
  assert.equal(card.annualFeeDomestic, 15000);
  assert.deepEqual(card.benefits, []);
});

test('서버 이미지가 있으면 그것을 쓰고, 앱 데이터에 없는 카드도 빠지지 않는다', () => {
  assert.deepEqual(toCatalogCard({ ...summary, imageUrl: 'https://img/1.webp' }, local).image, { uri: 'https://img/1.webp' });
  const other = toCatalogCard({ ...summary, cardCode: '99', name: '새 카드', type: 'CHECK' }, local);
  assert.equal(other.code, 'DB_99');
  assert.equal(other.type, '체크');
  assert.equal(other.image, undefined);
});

test('상세 혜택 → 이름·종류·안내 줄 (대상, 실적 구간별 값·한도)', () => {
  const [b] = toCatalogBenefits({ benefits: [{ benefitId: 1, name: 'DAY 카페 10% 할인', type: 'DISCOUNT', groupName: 'Time Plan',
    categories: ['카페'], merchants: ['스타벅스', '이디야'], note: '07:00~15:00',
    tiers: [{ minPrevSpend: 400000, displayValue: '10%', perPaymentLimit: 1000, monthlyCap: null, groupMonthlyCap: 5000, monthlyCount: null }] }] });
  assert.equal(b.type, '할인');
  assert.equal(b.note, '07:00~15:00\n혜택 그룹 Time Plan\n대상 스타벅스, 이디야\n전월 400,000원 이상 · 10% · 건당 한도 1,000원 · 통합 월 한도 5,000원');
  assert.deepEqual(toCatalogBenefits(null), []);
});

test('서버 기준 이미지 경로에는 서버 주소를 붙이고, 전체 주소는 그대로 쓴다', () => {
  assert.deepEqual(imageSource('/card-images/1.webp', 'http://localhost:8090/'), { uri: 'http://localhost:8090/card-images/1.webp' });
  assert.deepEqual(imageSource('https://cdn/x.webp', 'http://a'), { uri: 'https://cdn/x.webp' });
  assert.equal(imageSource(null, 'http://a'), null);
  assert.deepEqual(toCatalogCard({ ...summary, imageUrl: '/card-images/1.webp' }, local, 'http://h').image, { uri: 'http://h/card-images/1.webp' });
});
