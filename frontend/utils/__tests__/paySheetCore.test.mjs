// 실행: node --test utils/__tests__/paySheetCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTURE_WARNING, EXPIRED_NOTICE, captureView, dragStep, isDownwardDrag, nextTickMs, shouldCloseSheet, webCodeMask } from '../paySheetCore.js';

test('아래로 끌기: 6px 넘게, 옆보다 아래로 더 움직여야 한다', () => {
  assert.equal(isDownwardDrag(0, 6), false);
  assert.equal(isDownwardDrag(0, 7), true);
  assert.equal(isDownwardDrag(10, 9), false);
  assert.equal(isDownwardDrag(-5, 20), true);
  assert.equal(isDownwardDrag(0, -30), false);
});

test('닫기 기준: 80px 이상, 또는 24px 이상을 빠르게(1px/ms 넘게) 끌면 닫는다', () => {
  assert.equal(shouldCloseSheet(80, 0), true);
  assert.equal(shouldCloseSheet(79, 0.5), false);
  assert.equal(shouldCloseSheet(24, 1.2), true);
  assert.equal(shouldCloseSheet(23, 3), false);
  assert.equal(shouldCloseSheet(30, 1), false);
});

test('끌기 한 단계: 아래로 끌기가 시작되면 그 뒤로는 옆으로 틀어도 위치를 0 으로 되돌리지 않는다', () => {
  assert.deepEqual(dragStep(false, 2, 3), { dragging: false, offset: 0 });
  assert.deepEqual(dragStep(false, 2, 20), { dragging: true, offset: 20 });
  assert.deepEqual(dragStep(true, 40, 25), { dragging: true, offset: 25 });   // 옆으로 더 움직여도 그대로 따라온다
  assert.deepEqual(dragStep(true, 0, -15), { dragging: true, offset: 0 });    // 위로 올리면 제자리까지만
});

test('캡처 보호 상태: 설정 중이면 창을 띄우지 않고, 실패해도 경고와 함께 코드는 보여 준다', () => {
  assert.deepEqual(captureView('pending'), { open: false, codes: false, warning: false });
  assert.deepEqual(captureView('ready'), { open: true, codes: true, warning: false });
  assert.deepEqual(captureView('unavailable'), { open: true, codes: true, warning: true });
  assert.match(CAPTURE_WARNING, /캡처 보호를 켜지 못했어요/);
});

test('웹 코드 가림 이유: 닫는 중 > 탭 숨김 > 만료 순, 셋 다 아니면 가리지 않는다', () => {
  assert.equal(webCodeMask({ closing: false, pageActive: true, expired: false }), null);
  assert.equal(webCodeMask({ closing: true, pageActive: false, expired: true }), 'closing');
  assert.equal(webCodeMask({ closing: false, pageActive: false, expired: true }), 'hidden');
  assert.equal(webCodeMask({ closing: false, pageActive: true, expired: true }), 'expired');
  assert.match(EXPIRED_NOTICE, /만료/);
});

test('남은 시간 다음 갱신: 다음 초 경계까지, 딱 맞으면 1초 뒤, 끝났으면 멈춤(null)', () => {
  assert.equal(nextTickMs(59_400), 400);
  assert.equal(nextTickMs(59_000), 1000);
  assert.equal(nextTickMs(3), 3);
  assert.equal(nextTickMs(0), null);
  assert.equal(nextTickMs(-20), null);
  assert.equal(nextTickMs(NaN), null);
});
