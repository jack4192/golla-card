// 실행: node --test utils/__tests__/catalogCardCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogActionState, removeConfirmText, walletCardForCatalog } from '../catalogCardCore.js';

// 지갑 카드의 상품 목록 코드: 앱 22장 코드(SH_...)와 40장 코드(DB40_...)가 섞여 있어 이어 주는 함수를 받는다
const codeOf = card => ({ SH_DISCOUNT_PLAN: 'DB40_01' })[card.catalogCode] || card.catalogCode;
const wallet = [
  { id: 'SH_DISCOUNT_PLAN', catalogCode: 'SH_DISCOUNT_PLAN', name: '신한카드 Discount Plan' },
  { id: 'DB40_17', catalogCode: 'DB40_17', name: 'KB ALL 카드' },
];

test('상품에 해당하는 내 지갑 카드 (코드가 달라도 이어 주는 함수로 찾고, 없으면 null)', () => {
  assert.equal(walletCardForCatalog(wallet, 'DB40_01', codeOf)?.id, 'SH_DISCOUNT_PLAN');
  assert.equal(walletCardForCatalog(wallet, 'DB40_17', codeOf)?.id, 'DB40_17');
  assert.equal(walletCardForCatalog(wallet, 'DB40_02', codeOf), null);
  assert.equal(walletCardForCatalog([], 'DB40_01', codeOf), null);
  assert.equal(walletCardForCatalog(undefined, 'DB40_01', codeOf), null);
});

test('상세 창 버튼: 미보유면 추가(+신청 주소 있으면 신청), 보유면 빼기, 처리기가 없으면 숨김', () => {
  assert.deepEqual(catalogActionState({ owned: false, canAdd: true, canRemove: true, applyUrl: 'https://x' }),
    { add: true, remove: false, apply: true });
  assert.deepEqual(catalogActionState({ owned: false, canAdd: true, canRemove: true, applyUrl: null }),
    { add: true, remove: false, apply: false });
  assert.deepEqual(catalogActionState({ owned: true, canAdd: true, canRemove: true, applyUrl: 'https://x' }),
    { add: false, remove: true, apply: false });
  assert.deepEqual(catalogActionState({ owned: true, canAdd: true, canRemove: false, applyUrl: null }),
    { add: false, remove: false, apply: false });
  assert.deepEqual(catalogActionState({ owned: false, canAdd: false, canRemove: false, applyUrl: 'https://x' }),
    { add: false, remove: false, apply: true });
});

test('빼기 확인 문구는 카드 이름에 맞는 조사로 묻기만 한다 (PR #15)', () => {
  assert.equal(removeConfirmText('신한카드 Discount Plan'),
    '신한카드 Discount Plan을 내 카드에서 뺄까요?');
  assert.match(removeConfirmText('신한카드 Discount Plan+'), /^신한카드 Discount Plan\+를 /);
});
