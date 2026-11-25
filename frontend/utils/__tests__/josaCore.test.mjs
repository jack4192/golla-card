// 실행: node --test utils/__tests__/josaCore.test.mjs
// 카드 이름 뒤 조사 (2026-11-25 팀 결정 '이름에 맞게 자동', PR #13 보완)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withParticle } from '../josaCore.js';

// [이름, 와/과, 로/으로]
const SPECIAL = [
  ['신한카드 Discount Plan', '과', '으로'],
  ['신한카드 Discount Plan+', '와', '로'],      // 플러스
  ['신한카드 Simple Plan', '과', '으로'],
  ['신한카드 Simple Plan+', '와', '로'],
  ['신한카드 ECO Plan', '과', '으로'],
  ['신한카드 EVerywhere', '와', '로'],
  ['신한카드 국민행복(신용)', '과', '으로'],      // 괄호 앞 '용'
  ['신한카드 국민행복(체크)', '와', '로'],
  ['NH농협 zgm 할인', '과', '으로'],
  ['NH농협 올원더풀 (할인 PACK)', '과', '으로'],   // 팩
  ['NH농협 올원더풀 (적립 PACK)', '과', '으로'],
  ['LOCA LIKIT', '과', '으로'],                  // 리킷
  ['디지로카 Las Vegas', '와', '로'],            // 베가스
  ['신한카드 The PET', '과', '으로'],            // 펫
  ['신한카드 Deep Oil', '과', '로'],             // 오일: ㄹ 뒤에는 '로'
];

test('받침·영어·괄호로 끝나는 카드 이름', () => {
  for (const [name, wa, ro] of SPECIAL) {
    assert.equal(withParticle(name, '와'), name + wa, name);
    assert.equal(withParticle(name, '로'), name + ro, name);
  }
});

test('한글로 끝나는 카드 이름은 받침을 본다', () => {
  assert.equal(withParticle('KB ALL 카드', '와'), 'KB ALL 카드와');
  assert.equal(withParticle('KB ALL 카드', '로'), 'KB ALL 카드로');
  assert.equal(withParticle('MOVING카드 ALLDAY모드', '로'), 'MOVING카드 ALLDAY모드로');
  assert.equal(withParticle('통장', '로'), '통장으로');
  assert.equal(withParticle('지하철', '로'), '지하철로');
  assert.equal(withParticle('지하철', '와'), '지하철과');
});

test('이/가: 실제 혜택 계산 화면의 "…이(가) 더 많이 줘요"', () => {
  assert.equal(withParticle('KB ALL 카드', '이'), 'KB ALL 카드가');
  assert.equal(withParticle('NH농협 zgm 할인', '가'), 'NH농협 zgm 할인이');
  assert.equal(withParticle('신한카드 Deep Oil', '이'), '신한카드 Deep Oil이');
});

test('혜택 금액: 원은 받침, 포인트(P)는 글자 이름 피', () => {
  assert.equal(withParticle('300원', '로'), '300원으로');
  assert.equal(withParticle('1,200P', '로'), '1,200P로');
});

test('숫자로 끝나면 읽는 소리로 (영·삼·육 받침, 일·칠·팔 ㄹ)', () => {
  assert.equal(withParticle('노리2', '와'), '노리2와');
  assert.equal(withParticle('카드3', '와'), '카드3과');
  assert.equal(withParticle('카드7', '로'), '카드7로');
  assert.equal(withParticle('카드6', '로'), '카드6으로');
});

test('카드 목록 44장 모두 조사가 붙는다 (빈 이름은 그대로)', () => {
  const cards = JSON.parse(readFileSync(new URL('../../data/cardCatalog40.json', import.meta.url), 'utf8'));
  const names = (Array.isArray(cards) ? cards : cards.cards).map(card => card.name);
  assert.equal(names.length, 44);
  for (const name of names) {
    assert.match(withParticle(name, '와'), /(와|과)$/, name);
    assert.match(withParticle(name, '로'), /(로|으로)$/, name);
  }
  assert.equal(withParticle('', '로'), '');
});
