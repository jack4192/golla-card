
import { Platform } from 'react-native';
import * as Store from './demoStore';

export const POPUP_KEY = 'solpay_recommendation_hide_until_v1';
export const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

const webKey = 'solpay_demo_' + POPUP_KEY;

export function parseHiddenUntil(raw) {
  if (raw === null) return 0;

  const value = JSON.parse(raw);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw Error('추천 팝업 설정을 확인해주세요.');
  }

  return value;
}

export async function readHiddenUntil() {
  const raw = Platform.OS === 'web'
    ? window.localStorage.getItem(webKey)
    : await Store.getItemAsync(POPUP_KEY);

  return parseHiddenUntil(raw);
}

export async function hideForSevenDays(now = Date.now()) {
  const until = now + SEVEN_DAYS;
  const raw = JSON.stringify(until);

  parseHiddenUntil(raw);

  if (Platform.OS === 'web') {
    window.localStorage.setItem(webKey, raw);
  } else {
    await Store.setItemAsync(POPUP_KEY, raw);
  }

  return until;
}

export const canShowPopup = (until, now = Date.now()) =>
  now >= until;

// 앱 안에서 화면만 이동하면 재노출하지 않습니다.
let launch = 0;
let claimed = -1;

export const currentLaunch = () => launch;
export const nextLaunch = () => ++launch;

export const launchPending = id =>
  id === launch && id !== claimed;

export function claimLaunch(id) {
  if (!launchPending(id)) return false;

  claimed = id;
  return true;
}
