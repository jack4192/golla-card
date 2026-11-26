// 실행: node --test utils/__tests__/sessionCore.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpiryNotifier, isSessionExpired, screenAfterLogin, startupKeepsSession } from '../sessionCore.js';

test('로그인이 필요한 요청이 401 이면 만료 (로그인·로그아웃 요청과 다른 상태는 아님)', () => {
  assert.equal(isSessionExpired({ status: 401, auth: true, path: '/api/cards/user-cards' }), true);
  assert.equal(isSessionExpired({ status: 401, auth: false, path: '/api/auth/login' }), false);
  assert.equal(isSessionExpired({ status: 401, auth: true, path: '/api/auth/logout' }), false);
  assert.equal(isSessionExpired({ status: 403, auth: true, path: '/api/users/me/withdrawal' }), false);
  assert.equal(isSessionExpired({ status: 500, auth: true, path: '/api/ai/rank' }), false);
});

test('만료 알림은 여러 요청이 동시에 401 이어도 한 번만, 다시 로그인하면 다시 알린다', () => {
  let calls = 0;
  const notifier = createExpiryNotifier();
  notifier.setHandler(() => { calls += 1; });
  notifier.notify();
  notifier.notify();
  notifier.notify();
  assert.equal(calls, 1);
  notifier.reset();
  notifier.notify();
  assert.equal(calls, 2);
  const empty = createExpiryNotifier();
  assert.doesNotThrow(() => empty.notify());   // 처리기가 없으면 아무것도 안 함
});

test('앱을 켤 때 토큰 확인이 실패하면: 401 이면 로그아웃, 연결 오류·서버 오류면 로그인 유지', () => {
  assert.equal(startupKeepsSession({ status: 401 }), false);
  assert.equal(startupKeepsSession({ status: 0 }), true);     // 서버에 연결하지 못함
  assert.equal(startupKeepsSession({ status: 503 }), true);
  assert.equal(startupKeepsSession(undefined), true);
});

test('직접 로그인하면 동의를 마친 사람도 약관 동의 화면부터', () => {
  assert.equal(screenAfterLogin({ termsAgreed: true, completed: true, resumed: false }), 'Agreement');
  assert.equal(screenAfterLogin({ termsAgreed: true, completed: false, resumed: false }), 'Agreement');
  assert.equal(screenAfterLogin({ termsAgreed: false, completed: false, resumed: false }), 'Agreement');
});

test('로그인 유지로 다시 열면 가입을 마친 사람은 바로 홈, 동의가 없으면 동의 화면, 동의만 했으면 일정 관리부터', () => {
  assert.equal(screenAfterLogin({ termsAgreed: true, completed: true, resumed: true }), 'Main');
  assert.equal(screenAfterLogin({ termsAgreed: false, completed: false, resumed: true }), 'Agreement');
  assert.equal(screenAfterLogin({ termsAgreed: true, completed: false, resumed: true }), 'LoginFlow');
});
