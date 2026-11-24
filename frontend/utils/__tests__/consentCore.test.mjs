// 실행: node --test utils/__tests__/consentCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { consentFromServer } from '../consentCore.js';

const V = 'solpay-onboarding-options-v3';
const NOW = new Date('2026-11-24T10:00:00Z');

test('서버에 필수 동의가 있고 기기에 없으면 기기 동의를 만든다 (알림 동의는 기기 값, 없으면 false)', () => {
  assert.deepEqual(consentFromServer({ mydataAgreed: true }, null, V, NOW),
    { version: V, savedAt: '2026-11-24T10:00:00.000Z', termsAgreed: true, morningNotificationAgreed: false });
  assert.equal(consentFromServer({ mydataAgreed: true }, { morningNotificationAgreed: true }, V, NOW).morningNotificationAgreed, true);
});

test('기기에 이미 동의가 있거나, 서버 동의가 없으면(false·null) 만들지 않는다', () => {
  assert.equal(consentFromServer({ mydataAgreed: true }, { termsAgreed: true }, V, NOW), null);
  assert.equal(consentFromServer({ mydataAgreed: false }, null, V, NOW), null);
  assert.equal(consentFromServer({ mydataAgreed: null }, null, V, NOW), null);
  assert.equal(consentFromServer(null, null, V, NOW), null);
});

test('알림 수신 동의는 서버 값(true/false)을 쓰고, 서버가 모르면(null·없음) 기기 값을 쓴다', () => {
  assert.equal(consentFromServer({ mydataAgreed: true, notificationAgreed: true }, null, V, NOW).morningNotificationAgreed, true);
  assert.equal(consentFromServer({ mydataAgreed: true, notificationAgreed: false }, { morningNotificationAgreed: true }, V, NOW).morningNotificationAgreed, false);
  assert.equal(consentFromServer({ mydataAgreed: true, notificationAgreed: null }, { morningNotificationAgreed: true }, V, NOW).morningNotificationAgreed, true);
  assert.equal(consentFromServer({ mydataAgreed: true, notificationAgreed: null }, null, V, NOW).morningNotificationAgreed, false);
});
