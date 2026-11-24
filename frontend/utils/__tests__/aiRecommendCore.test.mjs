import test from 'node:test';
import assert from 'node:assert/strict';
import { cardSource, toCardRecommendation, toPromotionOffer, visibleTabs } from '../aiRecommendCore.js';

const products = [{ code: 'SH_MODU', name: '신한 모두의카드', type: '신용' }];
const page = {
  tabs: ['card', 'merchant'],
  card: { card_name: '신한 모두의카드', annual_fee: 7000, keyword: '대중교통 10% 할인', items: [{ category: 'TRANSIT' }],
    copy: { title: '점심엔 대중교통 10% 할인', summary: '대중교통에서 10% 할인을 받을 수 있어요.', reasons: ['지난 1년 소비라면 26,260원 더'] } },
  merchant: { offers: [{ promotion_id: 1, brand: '메가MGC커피', title: '메가커피 행사', kind: 'event', card_name: '신한카드 SOL트래블 체크',
    total: 500, window_from: '2026-11-23T14:30:00+09:00', window_to: '2026-11-23T16:30:00+09:00', copy: { amount_label: 'SOL페이 행사 500원', reasons: ['메가커피 마실 땐 SOL페이!'] } }] },
};

test('AI 카드 탭 → 앱 40장 상품으로 카드 추천', () => {
  const rec = toCardRecommendation(page, products);
  assert.equal(rec.card.code, 'SH_MODU');
  assert.equal(rec.card.annualFee, 7000);
  assert.equal(rec.owned, false);
  assert.equal(rec.matches[0].reasons[0], '대중교통에서 10% 할인을 받을 수 있어요.');
  assert.equal(rec.matches[0].category, 'TRANSIT');
  assert.deepEqual(rec.reasons, ['지난 1년 소비라면 26,260원 더']);
  assert.equal(rec.matches[0].benefit.label, '대중교통 10% 할인');
  assert.equal(rec.matches[0].benefit.note, '지난 1년 소비라면 26,260원 더');
  assert.equal(toCardRecommendation({ card: null }, products), null);           // 새 가입자 등 → 앱 계산
  assert.equal(toCardRecommendation({ card: { card_name: '없는 카드' } }, products), null);
});

test('AI 가맹점 탭 → 프로모션 카드', () => {
  const { offer, reason } = toPromotionOffer(page);
  assert.equal(offer.merchant, '메가MGC커피');
  assert.equal(offer.benefit, 'SOL페이 행사 500원');
  assert.equal(offer.start, '14:30');
  assert.equal(offer.end, '16:30');
  assert.match(offer.note, /신한카드 SOL트래블 체크로 결제/);
  assert.equal(reason, '메가커피 마실 땐 SOL페이!');
  assert.match(toPromotionOffer({ merchant: { offers: [{ ...page.merchant.offers[0], kind: 'myshop' }] } }).offer.method, /마이샵/);
  assert.equal(toPromotionOffer({ merchant: { offers: [] } }), null);
});

test('AI 가맹점 탭 → 화면 이름과 로고 (2026-11-23 행사 DB 이전)', () => {
  const named = { merchant: { offers: [{ ...page.merchant.offers[0], brand: '다이소몰', display_name: '온라인 다이소몰', logo_url: '/brand-logos/daiso.png' }] } };
  const { offer } = toPromotionOffer(named, 'http://x:8090');
  assert.equal(offer.merchant, '온라인 다이소몰');
  assert.deepEqual(offer.logo, { uri: 'http://x:8090/brand-logos/daiso.png' });
  const plain = toPromotionOffer(page, 'http://x:8090').offer;
  assert.equal(plain.merchant, '메가MGC커피');          // 화면 이름이 없으면 brand
  assert.equal(plain.logo, null);
});

test('탭은 AI 규칙을 따른다', () => {
  assert.deepEqual(visibleTabs(page), [0, 1]);
  assert.deepEqual(visibleTabs({ tabs: ['merchant'] }), [1]);
  assert.deepEqual(visibleTabs({ tabs: ['card'] }), [0]);
  assert.deepEqual(visibleTabs(null), [0, 1]);
  assert.deepEqual(visibleTabs({ tabs: [] }), [0, 1]);
});

test('카드 추천 탭: AI 를 묻는 동안은 불러오는 중, 답이 오면 AI 카드, 실패·카드 없음·데모·다른 날은 앱 계산', () => {
  // 앱 계산 카드를 먼저 보이다가 AI 카드로 바뀌지 않게 (2026-11-23 사용자 결정)
  assert.equal(cardSource({ asksAi: true, aiState: 'loading', aiCard: null }), 'loading');
  assert.equal(cardSource({ asksAi: true, aiState: 'ready', aiCard: { card: {} } }), 'ai');
  assert.equal(cardSource({ asksAi: true, aiState: 'ready', aiCard: null }), 'local');
  assert.equal(cardSource({ asksAi: true, aiState: 'failed', aiCard: null }), 'local');
  assert.equal(cardSource({ asksAi: false, aiState: 'loading', aiCard: null }), 'local');
});

// 2026-11-24: 일정과 맞는 행사가 없을 때 무작위로 띄운 행사 (related: false)
test('무작위 행사는 시간 없이 끝 날짜와 일정 무관 안내를 보여준다', () => {
  const offerRow = { promotion_id: 1, brand: '메가MGC커피', title: '메가커피 500원 할인', kind: 'event', card_name: '신한카드 SOL트래블 체크',
    total: 1500, related: false, until: '2026-11-30', window_from: null, window_to: null,
    start: '2026-11-24T11:00:00+09:00', end: '2026-11-24T11:00:00+09:00',
    copy: { amount_label: '이벤트 500원', reasons: ['메가커피 500원 할인', '11월 30일까지 · 신한카드 SOL트래블 체크로 결제'] } };
  const summary = '오늘 일정에 맞는 행사가 없어 지금 진행 중인 메가MGC커피 행사를 보여드려요.';
  const { offer, reason } = toPromotionOffer({ merchant: { copy: { title: '오늘 진행 중인 행사예요', summary }, offers: [offerRow] } });
  assert.equal(offer.start, null);
  assert.equal(offer.end, null);
  assert.equal(offer.benefit, '이벤트 500원');
  assert.equal(offer.note, '메가커피 500원 할인 · 신한카드 SOL트래블 체크로 결제 · 11월 30일까지');
  assert.equal(reason, summary);
  const bare = toPromotionOffer({ merchant: { offers: [{ ...offerRow, copy: undefined }] } });
  assert.equal(bare.reason, '오늘 진행 중인 행사예요.');
});

// 2026-11-24: 일정 금액을 혜택의 최소 결제 금액으로 올려 계산한 카드는 '○원 이상 결제 시' 줄을 혜택 아래에 보여 준다
test('조건 금액 카드는 혜택 아래 줄에 이상 결제 조건을 보여준다', () => {
  const page = { tabs: ['card'], card: { card_name: '신한 모두의카드', annual_fee: 7000, keyword: 'CGV 5,000원 할인',
    items: [{ category: 'MOVIE', at_least: true, min_prev: 400000 }],
    copy: { title: '점심엔 CGV 5,000원 할인', summary: '오늘 12시 일정에 CGV 5,000원 할인을 받을 수 있어요.',
      amount_label: '12:00 영화 12,000원 이상 결제 시 → 5,000원 할인', reasons: ['연회비 7,000원'] } } };
  const rec = toCardRecommendation(page, products);
  assert.equal(rec.matches[0].benefit.name, '12:00 영화 12,000원 이상 결제 시 → 5,000원 할인');
  assert.equal(rec.matches[0].benefit.label, 'CGV 5,000원 할인');
  const plain = toCardRecommendation({ ...page, card: { ...page.card, items: [{ category: 'MOVIE' }] } }, products);
  assert.equal(plain.matches[0].benefit.name, '점심엔 CGV 5,000원 할인');
});

test('무작위 행사는 최소 결제 금액을 화면 칸에 넘긴다', () => {
  const row = { promotion_id: 7, brand: '11번가', title: '마이샵 혜택', kind: 'myshop', related: false, until: '2026-11-30', min_amount: 50000,
    copy: { amount_label: '마이샵 3,000원', reasons: ['마이샵 혜택', '50,000원 이상 결제 시', '11월 30일까지 · 신한카드 Simple Plan로 결제'] } };
  assert.equal(toPromotionOffer({ merchant: { offers: [row] } }).offer.minimum, 50000);
  assert.equal(toPromotionOffer({ merchant: { offers: [{ ...row, min_amount: 0 }] } }).offer.minimum, null);
});
