// 앱 내 알림함 + 폰 알림(로컬 알림)
//
// - 알림함: 이 기기에 저장한 알림 목록(읽음 표시). 오늘 일정, 맞춤 카드 추천, 진행 중인 혜택 등을 쌓습니다.
// - 폰 알림: '알림 수신 동의'를 한 경우에만, 매일 아침 8시 안내 + 시간이 있는 일정 30분 전 알림을 예약합니다.
//   expo-notifications(SDK 58) 로컬 알림 사용. Expo Go에서도 동작하고, 웹은 지원하지 않아 건너뜁니다.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Store from './demoStore';

export const INBOX_KEY = 'solpay_notifications_v1';
const MAX_ITEMS = 60;
const CHANNEL_ID = 'solpay-default';
const MORNING_HOUR = 8;
const SCHEDULE_LEAD_MINUTES = 30;
const SCHEDULE_DAYS_AHEAD = 7;
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
    name: 'SOL·Pay 알림',
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

/** 예약된 SOL·Pay 폰 알림을 모두 취소합니다(동의 철회·로그아웃 시). */
export async function cancelPhoneNotifications() {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

const dailyTrigger = (hour, minute) => (Platform.OS === 'android'
  ? { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID }
  // iOS는 달력(시·분) 트리거로 매일 반복합니다.
  : { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, hour, minute, repeats: true });

/**
 * 폰 알림 예약을 다시 맞춥니다. 동의하지 않았거나 권한이 없으면 모두 취소합니다.
 * - 매일 아침 8시: 오늘 일정·맞춤 카드 확인 안내
 * - 시간이 있는 일정: 시작 30분 전(앞으로 7일 안의 일정만)
 */
export async function syncPhoneNotifications({ agreed, events = [], titleOf = () => '일정' }) {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return { scheduled: 0 };
  ensureHandler();
  await cancelPhoneNotifications();
  if (!agreed) return { scheduled: 0 };
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return { scheduled: 0, denied: true };
  }
  await ensureChannel();

  await Notifications.scheduleNotificationAsync({
    content: { title: '오늘의 카드를 확인해보세요', body: '오늘 일정에 맞는 카드와 진행 중인 혜택을 알려드려요.', data: { kind: 'morning', target: 'home' } },
    trigger: dailyTrigger(MORNING_HOUR, 0),
  });
  let scheduled = 1;

  const now = Date.now();
  const limit = now + SCHEDULE_DAYS_AHEAD * 24 * 60 * 60 * 1000;
  const upcoming = events
    .filter(event => event.start && event.date)
    .map(event => ({ event, at: new Date(`${event.date}T${event.start}:00`).getTime() - SCHEDULE_LEAD_MINUTES * 60 * 1000 }))
    .filter(({ at }) => at > now && at < limit)
    .sort((a, b) => a.at - b.at)
    .slice(0, 20);
  for (const { event, at } of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${SCHEDULE_LEAD_MINUTES}분 뒤 일정: ${titleOf(event)}`,
        body: `${event.start} 시작 · 이 일정에 맞는 카드를 앱에서 확인해보세요`,
        data: { kind: 'schedule', target: 'schedule', eventId: event.id },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}) },
    });
    scheduled += 1;
  }
  return { scheduled };
}

/** 폰 알림을 눌러 앱이 열렸을 때 갈 곳(target)을 알려줍니다. */
export function addPhoneNotificationOpenListener(onOpen) {
  if (!PHONE_NOTIFICATIONS_SUPPORTED) return () => {};
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    onOpen?.(response?.notification?.request?.content?.data?.target || 'home');
  });
  return () => subscription.remove();
}
