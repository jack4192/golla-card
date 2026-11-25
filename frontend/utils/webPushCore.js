// 바탕화면 웹앱 웹 푸시의 순수 함수 (2026-11-25). 시험: node --test utils/__tests__/webPushCore.test.mjs
// 서비스 워커(public/sw.js)가 알림을 누르면 앱에 보내는 메시지 종류
export const SW_OPEN_MESSAGE = 'open-schedule';

/** VAPID 공개 키(base64url, 패딩 없음) → Uint8Array (pushManager.subscribe 의 applicationServerKey). */
export function urlBase64ToUint8Array(value) {
  const base64 = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/** 알림을 눌러 열린 주소(?open=schedule)인지. */
export function opensSchedule(search) {
  if (!search) return false;
  try {
    return new URLSearchParams(String(search)).get('open') === 'schedule';
  } catch {
    return false;
  }
}

/**
 * 이 브라우저에서 웹 푸시를 켤 수 있는지.
 * 'ready' = 켤 수 있음, 'install' = 아이폰인데 홈 화면에 추가한 앱이 아님(사파리 탭엔 PushManager 가 없다), 'unsupported' = 안 됨.
 */
export function webPushState({ hasServiceWorker, hasPushManager, hasNotification, standalone, isIOS }) {
  if (isIOS && !standalone) return 'install';
  if (!hasServiceWorker || !hasPushManager || !hasNotification) return 'unsupported';
  return 'ready';
}
