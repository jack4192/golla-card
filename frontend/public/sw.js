// Pay·Mate 바탕화면 웹앱 서비스 워커 (2026-11-25): 아침 일정 웹 푸시를 보여 주고, 누르면 일정 관리를 연다.
// 금융 정보라 화면·데이터를 캐시하지 않는다 (오프라인 기능 없음).
const OPEN_MESSAGE = 'open-schedule';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

function notificationOptions(data) {
  return {
    body: data.body || '',
    tag: data.tag || 'morning-schedule',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/?open=schedule', title: data.title || 'Pay·Mate', body: data.body || '', tag: data.tag || 'morning-schedule' },
  };
}

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'Pay·Mate', notificationOptions(data)));
});

self.addEventListener('notificationclick', event => {
  const data = event.notification.data || {};
  const url = data.url || '/?open=schedule';
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(item => new URL(item.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: OPEN_MESSAGE });
    } else {
      await self.clients.openWindow(url);
    }
    // 시연용: 누른 알림을 다시 띄워 다음 사람도 같은 알림을 눌러 볼 수 있게 한다 (2026-11-25 팀 피드백)
    await self.registration.showNotification(data.title || 'Pay·Mate', notificationOptions(data));
  })());
});
