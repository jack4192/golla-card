import { Platform } from 'react-native';
import * as Store from './demoStore';

const DAY = 24 * 60 * 60 * 1000;
const keys = {
  recommendation: ['solpay_recommendation_hide_until_v1', 'solpay_recommendation_last_shown_v1'],
  promotion: ['solpay_promotion_hide_until_v1', 'solpay_promotion_last_shown_v1'],
};
const get = key => Platform.OS === 'web'
  ? window.localStorage.getItem('solpay_demo_' + key)
  : Store.getItemAsync(key);
const set = (key, at) => {
  const value = JSON.stringify(at);
  return Platform.OS === 'web'
    ? window.localStorage.setItem('solpay_demo_' + key, value)
    : Store.setItemAsync(key, value);
};
const parse = raw => {
  const value = raw === null ? 0 : JSON.parse(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw Error('팝업 설정을 확인해주세요.');
  return value;
};
const kstDay = at => Math.floor((at + 9 * 60 * 60 * 1000) / DAY);

export function isAdDue(kind, hiddenUntil, lastShown, now) {
  if (now < hiddenUntil) return false;
  if (!lastShown) return true;
  return kind === 'recommendation'
    ? now - lastShown >= 3 * DAY
    : kstDay(now) > kstDay(lastShown);
}

export async function readAdDue(kind, now = Date.now()) {
  const [until, last] = await Promise.all(keys[kind].map(get));
  return isAdDue(kind, parse(until), parse(last), now);
}

export const recordAdShown = (kind, now = Date.now()) => set(keys[kind][1], now);
export const hideAdForSevenDays = (kind, now = Date.now()) => set(keys[kind][0], now + 7 * DAY);
