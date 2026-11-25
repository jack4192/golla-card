// 바탕화면 웹앱(PWA) 웹 푸시: 서비스 워커 등록, 알림 켜기·끄기, '지금 알림 받기', 알림을 눌러 열렸을 때 (2026-11-25).
// 웹에서만 동작하고, 휴대폰 앱(Expo Go)은 utils/notifications.js 의 로컬 알림을 그대로 쓴다.
import { Platform } from 'react-native';
import { api } from './api';
import { SW_OPEN_MESSAGE, opensSchedule, urlBase64ToUint8Array, webPushState } from './webPushCore';

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';
let registration = null;

export function registerServiceWorker() {
  if (!isWeb || !('serviceWorker' in navigator)) return Promise.resolve(null);
  registration = navigator.serviceWorker.register('/sw.js').catch(() => null);
  return registration;
}

async function readyRegistration() {
  if (!isWeb || !('serviceWorker' in navigator)) return null;
  if (!registration) registerServiceWorker();
  await registration;
  return navigator.serviceWorker.ready;
}

export function currentWebPushState() {
  if (!isWeb) return 'unsupported';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return webPushState({
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    hasNotification: 'Notification' in window,
    standalone,
    isIOS,
  });
}

export async function isWebPushOn() {
  if (currentWebPushState() !== 'ready' || Notification.permission !== 'granted') return false;
  const ready = await readyRegistration();
  return Boolean(await ready?.pushManager.getSubscription());
}

/** 알림 허락 → 구독 → 백엔드에 저장. 버튼을 누른 그 순간에 불러야 한다(아이폰). 거절하면 Error('denied'). */
export async function enableWebPush() {
  if (currentWebPushState() !== 'ready') throw new Error('unsupported');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');
  const { enabled, publicKey } = await api.pushPublicKey();
  if (!enabled || !publicKey) throw new Error('disabled');
  const ready = await readyRegistration();
  const subscription = await ready.pushManager.getSubscription() ||
    await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  await api.savePushSubscription(subscription.toJSON());
}

export async function disableWebPush() {
  const ready = await readyRegistration();
  const subscription = await ready?.pushManager.getSubscription();
  if (!subscription) return;
  await api.deletePushSubscription(subscription.endpoint).catch(() => {});
  await subscription.unsubscribe().catch(() => {});
}

export const sendTestPush = () => api.sendTestPush();

/** 알림을 눌러 열렸을 때(?open=schedule) 한 번, 이미 열려 있으면 서비스 워커 메시지로 onOpen 을 부른다. */
export function addWebPushOpenListener(onOpen) {
  if (!isWeb) return () => {};
  if (opensSchedule(window.location.search)) {
    window.history.replaceState(null, '', window.location.pathname);   // 새로고침해도 다시 열지 않게
    onOpen();
  }
  if (!('serviceWorker' in navigator)) return () => {};
  const receive = event => { if (event.data?.type === SW_OPEN_MESSAGE) onOpen(); };
  navigator.serviceWorker.addEventListener('message', receive);
  return () => navigator.serviceWorker.removeEventListener('message', receive);
}
