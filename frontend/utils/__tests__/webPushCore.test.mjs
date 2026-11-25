// 실행: node --test utils/__tests__/webPushCore.test.mjs
// 바탕화면 웹앱 웹 푸시 (2026-11-25)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SW_OPEN_MESSAGE, opensSchedule, urlBase64ToUint8Array, webPushState } from '../webPushCore.js';

test('VAPID 공개 키(base64url, 패딩 없음) → 바이트', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID')], [1, 2, 3]);
  assert.deepEqual([...urlBase64ToUint8Array('-_8')], [251, 255]);   // - _ 와 패딩 없는 길이
  assert.equal(urlBase64ToUint8Array('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8').length, 65);
});

test('알림을 눌러 열린 주소면 일정 관리를 연다', () => {
  assert.equal(opensSchedule('?open=schedule'), true);
  assert.equal(opensSchedule('?x=1&open=schedule'), true);
  assert.equal(opensSchedule('?x=1'), false);
  assert.equal(opensSchedule(''), false);
  assert.equal(opensSchedule(undefined), false);
  assert.equal(SW_OPEN_MESSAGE, 'open-schedule');
});

test('웹 푸시를 쓸 수 있는지: 아이폰은 홈 화면에 추가한 앱에서만', () => {
  const all = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: true, isIOS: true };
  assert.equal(webPushState(all), 'ready');
  assert.equal(webPushState({ ...all, standalone: false }), 'install');
  assert.equal(webPushState({ ...all, isIOS: false, standalone: false }), 'ready');   // 맥·안드로이드 크롬은 탭에서도
  assert.equal(webPushState({ ...all, hasPushManager: false, standalone: false }), 'install');   // 아이폰 사파리 탭엔 PushManager 가 없다
  assert.equal(webPushState({ ...all, isIOS: false, hasPushManager: false }), 'unsupported');
  assert.equal(webPushState({ ...all, hasServiceWorker: false, isIOS: false }), 'unsupported');
});
