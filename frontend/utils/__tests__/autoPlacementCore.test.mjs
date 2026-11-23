// 실행: node --test utils/__tests__/autoPlacementCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_PLACEMENT_KEY, applyUrl, parseAutoPlacement, serializeAutoPlacement, syncAction } from '../autoPlacementCore.js';

test('자동 배치 저장값: off 만 꺼짐, 나머지는 켜짐(기본)', () => {
  assert.equal(AUTO_PLACEMENT_KEY, 'solpay_auto_placement_v1');
  assert.equal(parseAutoPlacement(null), true);
  assert.equal(parseAutoPlacement('on'), true);
  assert.equal(parseAutoPlacement('off'), false);
  assert.equal(parseAutoPlacement('x'), true);
  assert.equal(serializeAutoPlacement(true), 'on');
  assert.equal(serializeAutoPlacement(false), 'off');
});

test('카드 신청 링크는 https 카드사 페이지만', () => {
  const url = 'https://www.shinhancard.com/pconts/html/card/apply/credit/1237253_2207';
  assert.equal(applyUrl({ sourcePage: url }), url);
  assert.equal(applyUrl({ sourcePage: 'http://a' }), null);
  assert.equal(applyUrl({}), null);
  assert.equal(applyUrl(null), null);
});

test('자동 배치 중이고 AI 순서가 있으면 언제나 AI 1순위를 결제 카드로', () => {
  const base = { autoOn: true, usingAi: true, firstId: 'A', selectedId: 'B', selectedIndex: 2 };
  assert.equal(syncAction({ ...base, lastSelectedId: 'B' }), 'selectTop');
  assert.equal(syncAction({ ...base, lastSelectedId: 'C' }), 'selectTop');   // 다른 곳에서 골랐어도
});

test('AI 순서가 없거나 자동 배치가 꺼져 있으면 지금 동작 그대로', () => {
  assert.equal(syncAction({ autoOn: true, usingAi: false, firstId: 'A', selectedId: 'B', lastSelectedId: 'C', selectedIndex: 2 }),
    'moveSelectedToTop');
  assert.equal(syncAction({ autoOn: false, usingAi: false, firstId: 'A', selectedId: 'B', lastSelectedId: 'B', selectedIndex: 2 }),
    'selectTop');
});

test('맨 위 카드가 이미 결제 카드이거나 없으면 아무것도 안 한다', () => {
  assert.equal(syncAction({ autoOn: true, usingAi: true, firstId: 'A', selectedId: 'A', lastSelectedId: 'B', selectedIndex: 0 }), 'none');
  assert.equal(syncAction({ autoOn: false, usingAi: false, firstId: null, selectedId: 'A', lastSelectedId: 'B', selectedIndex: -1 }), 'none');
});
