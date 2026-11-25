// 앱 내 알림함 + 폰 알림(로컬 알림)
//
// - 알림함: 이 기기에 저장한 알림 목록(읽음 표시). 오늘 일정, 맞춤 카드 추천, 진행 중인 혜택 등을 쌓습니다.
// - 폰 알림: '알림 수신 동의'를 한 경우에만 매일 오전 7시 일정 입력 안내를 예약합니다.
//   expo-notifications(SDK 58) 로컬 알림 사용. Expo Go에서도 동작하고, 웹은 지원하지 않아 건너뜁니다.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Store from './demoStore';

export const INBOX_KEY = 'solpay_notifications_v1';
const MAX_ITEMS = 60;
const CHANNEL_ID = 'solpay-default';
const MORNING_HOUR = 7;
export const PHONE_NOTIFICATIONS_SUPPORTED = Platform.OS !== 'web';

// ── 알림함 ──
let writes = Promise.resolve();
const queue = action => {
  const next = writes.catch(() => {}).then(action);
  writes = next;
  return next;
};
const listeners = new Set();
const emit = items => listeners.forEach(listener => listener(items));

/** 알림함이 바뀔 때마다 호출됩니다. 해제 함수를 돌려줍니다. */
export function subscribeInbox(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readInbox() {
  try {
    const value = JSON.parse(await Store.getItemAsync(INBOX_KEY));
    return Array.isArray(value?.items) ? value.items : [];
  } catch {
    return [];
  }
}

async function writeInbox(items) {
  const next = items.slice(0, MAX_ITEMS);
  await Store.setItemAsync(INBOX_KEY, JSON.stringify({ version: 1, items: next }));
  emit(next);
  return next;
}

/**
 * 알림함에 알림을 넣습니다. 같은 id가 이미 있으면 넣지 않습니다(하루 한 번 같은 알림 등).
 * @param item { id, type: 'schedule'|'card'|'benefit'|'savings'|'info', title, body, target? }
 */
export function addNotifications(newItems) {
  return queue(async () => {
    const items = await readInbox();
    const known = new Set(items.map(item => item.id));
    const fresh = newItems.filter(item => item?.id && !known.has(item.id)).map(item => ({
      ...item,
      createdAt: item.createdAt || new Date().toISOString(),
      read: false,
    }));
    if (!fresh.length) return items;
    return writeInbox([...fresh, ...items]);
  });
}

export const addNotification = item => addNotifications([item]);

export const markRead = id => queue(async () =>
  writeInbox((await readInbox()).map(item => (item.id === id ? { ...item, read: true } : item))));

export const markAllRead = () => queue(async () =>
  writeInbox((await readInbox()).map(item => ({ ...item, read: true }))));

export const clearInbox = () => queue(() => writeInbox([]));

export const unreadCount = items => items.filter(item => !item.read).length;

const today = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

/**
 * 앱을 열 때 오늘 알림을 만듭니다(같은 날 같은 알림은 한 번만).
 * @param events 일정 목록, titleOf 일정 이름 함수, promotions 진행 중인 프로모션
 */
export function refreshDailyNotifications({ events = [], titleOf = () => '일정', promotions = [] }) {
  const day = today();
  const items = [];
  const todayEvents = events.filter(event => event.date === day);
  if (todayEvents.length) {
    const names = todayEvents.slice(0, 3).map(titleOf).join(', ');
    items.push({
      id: `schedule:${day}`,
      type: 'schedule',
      title: `오늘 일정 ${todayEvents.length}개가 있어요`,
      body: `${names}${todayEvents.length > 3 ? ' 외' : ''} · 일정에 맞는 카드를 확인해보세요`,
      target: 'schedule',
    });
  }
  const promotion = promotions[0];
  if (promotion) {
    items.push({
      id: `benefit:${promotion.id}`,
      type: 'benefit',
      title: `${promotion.merchant} 혜택이 진행 중이에요`,
      body: promotion.benefit || promotion.title || '혜택 탭에서 조건을 확인해보세요',
      target: 'benefits',
    });
  }
  return items.length ? addNotifications(items) : readInbox();
}

// ── 폰 알림 ──
let handlerReady = false;
function ensureHandler() {
  if (handlerReady || !PHONE_NOTIFICATIONS_SUPPORTED) return;
  handlerReady = true;
  // 앱을 보고 있을 때도 배너와 알림 목록에 보여줍니다(SDK 58: shouldShowAlert 대신 Banner/List).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  // 안드로이드 8.0 이상은 채널이 있어야 하고, 13 이상은 채널이 있어야 권한 창이 뜹니다.
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Pay·Mate 알림',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/** 폰 알림 권한을 확인하고, 없으면 요청합니다. 허용되면 true */
export async function requestPhonePermission() {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return false;
  ensureHandler();
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const asked = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
  return asked.granted || asked.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

let phoneSync = Promise.resolve();

/** 이전 예약을 지운 뒤, 동의와 기기 권한이 있으면 아침 알림을 예약합니다. */
export function syncPhoneNotifications({ agreed }) {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return Promise.resolve();
  phoneSync = phoneSync.catch(() => {}).then(async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!agreed) return;
    ensureHandler();
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      content: {
        // 바탕화면 웹앱 웹 푸시와 같은 문구 (2026-11-25 팀 결정: 짧은 질문형)
        title: '오늘 어디 가세요?',
        body: '일정을 알려 주면 카드를 골라 드려요',
        data: { kind: 'morning' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: MORNING_HOUR,
        minute: 0,
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
    });
  });
  return phoneSync;
}

export const cancelPhoneNotifications = () => syncPhoneNotifications({ agreed: false });

/** 앱이 종료된 상태에서 아침 알림을 눌렀을 때도 열기 요청을 전달합니다. */
export function addMorningNotificationOpenListener(onOpen) {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return () => {};
  let handled;
  const receive = response => {
    const notification = response?.notification;
    if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER ||
      notification?.request?.content?.data?.kind !== 'morning') return;
    const key = notification.request.identifier + ':' + notification.date;
    if (handled === key) return;
    handled = key;
    onOpen();
    Notifications.clearLastNotificationResponse();
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(receive);
  receive(Notifications.getLastNotificationResponse());
  return () => subscription.remove();
}
