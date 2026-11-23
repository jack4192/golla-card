// 실행: node --test utils/__tests__/scheduleAiCore.test.mjs
// 홈 일정 카드·일정 결제 화면을 AI 배치(일정 모드)에 맞추는 순수 함수 (2026-11-23 설계서 home-schedule-ai)
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiWindowKey, inAiWindow, scheduleAiExample, scheduleAiLabel, scheduleAiMatch, scheduleAiPaymentExample } from '../scheduleAiCore.js';

const t = hm => new Date('2026-11-23T' + hm + ':00');
const row = { key: 'special:22', cats: ['cafe'], startDate: t('17:00'), endDate: t('18:30') };
const ex = { basis: 'schedule', category_code: 'CAFE', merchant_id: 12, name: '메가MGC커피', amount: 4900 };
const result = { version: 'schedule', fallback: false, topId: 'w1', example: ex };
const cards = [{ id: 'w1', name: '신한카드 Discount Plan' }, { id: 'w2', name: 'KB ALL 카드' }];
const estimates = { w1: { value: 500 }, w2: { value: 40 } };

test('일정 창은 시작 30분 전부터 끝 30분 후까지', () => {
  assert.equal(inAiWindow(row, t('16:30')), true);
  assert.equal(inAiWindow(row, t('16:29')), false);
  assert.equal(inAiWindow(row, t('19:00')), true);
  assert.equal(inAiWindow(row, t('19:01')), false);
  assert.equal(inAiWindow({ ...row, startDate: null }, t('17:10')), false);
});

test('창 열쇠는 창 안에 AI 업종 일정이 있을 때만 생기고 1분마다 바뀌지 않는다', () => {
  assert.notEqual(aiWindowKey([row], t('17:02'), ['w1', 'w2']), '');
  assert.equal(aiWindowKey([row], t('17:02'), ['w1', 'w2']), aiWindowKey([row], t('17:40'), ['w1', 'w2']));
  assert.equal(aiWindowKey([row], t('20:00'), ['w1', 'w2']), '');
  assert.equal(aiWindowKey([{ ...row, cats: ['other'] }], t('17:02'), ['w1']), '');
  assert.equal(aiWindowKey([{ ...row, cats: ['pcroom'] }], t('17:02'), ['w1']), '');
  assert.notEqual(aiWindowKey([row], t('17:02'), ['w1']), aiWindowKey([row], t('17:02'), ['w1', 'w2']));
});

test('결제 카드를 바꿔 지갑 순서만 달라지면 창 열쇠는 그대로다 (다시 묻지 않는다)', () => {
  // 홈 패널의 카드 목록은 지금 고른 카드가 늘 맨 앞이다 ('이 카드로 결제'가 결제 카드를 바꾼다, 리뷰 Important 1)
  assert.equal(aiWindowKey([row], t('17:02'), ['w2', 'w1']), aiWindowKey([row], t('17:02'), ['w1', 'w2']));
});

test('일정 모드이고 업종이 같을 때만 AI 예시를 쓴다', () => {
  assert.equal(scheduleAiExample(result, ['cafe']), ex);
  assert.equal(scheduleAiExample({ ...result, version: 'pattern' }, ['cafe']), null);
  assert.equal(scheduleAiExample({ ...result, fallback: true }, ['cafe']), null);
  assert.equal(scheduleAiExample({ ...result, example: null }, ['cafe']), null);
  assert.equal(scheduleAiExample(result, ['restaurant']), null);
  assert.equal(scheduleAiExample(null, ['cafe']), null);
});

test('홈 문구', () => {
  assert.equal(scheduleAiLabel(ex, 500), '메가MGC커피 · 4,900원 · 500원 예상 혜택 · AI 계산');
  assert.equal(scheduleAiLabel(ex, 0), '메가MGC커피 · 4,900원 · AI 추천');
  assert.equal(scheduleAiLabel({ ...ex, name: null, category_name: '카페' }, 40), '카페 · 4,900원 · 40원 예상 혜택 · AI 계산');
});

test('창 안 같은 업종 일정에만 AI 1순위 카드를 붙인다', () => {
  const label = '메가MGC커피 · 4,900원 · 500원 예상 혜택 · AI 계산';
  assert.deepEqual(scheduleAiMatch({ row, clock: t('17:02'), preview: { result, estimates }, cards }),
    { card: cards[0], label, benefitName: label, category: 'cafe', ai: true });
  assert.equal(scheduleAiMatch({ row, clock: t('20:00'), preview: { result, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row: { ...row, cats: ['restaurant'] }, clock: t('17:02'), preview: { result, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: { result, estimates: null }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: { result: { ...result, topId: 'w9' }, estimates }, cards }), null);
  assert.equal(scheduleAiMatch({ row, clock: t('17:02'), preview: null, cards }), null);
});

test('일정 결제는 홈이 AI 카드로 보낸 일정(ai: true)일 때만 AI 를 따른다', () => {
  // 같은 업종이어도 창 밖 일정(21시 카페 등)이나 홈 미리보기가 실패한 일정은 일정 거래 그대로 (리뷰 Important 2)
  assert.equal(scheduleAiPaymentExample(result, { category: 'cafe', ai: true }), ex);
  assert.equal(scheduleAiPaymentExample(result, { category: 'cafe' }), null);
  assert.equal(scheduleAiPaymentExample(result, { category: 'restaurant', ai: true }), null);
  assert.equal(scheduleAiPaymentExample({ ...result, version: 'pattern' }, { category: 'cafe', ai: true }), null);
  assert.equal(scheduleAiPaymentExample(result, null), null);
});
