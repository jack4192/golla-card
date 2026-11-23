import { Platform } from 'react-native';
import * as Store from './demoStore';

const DAY = 24 * 60 * 60 * 1000;
export const AUTOMATIC_AD_HISTORY_KEY = 'solpay_automatic_ad_history_v1';
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

async function readHistory() {
  const stored = await get(AUTOMATIC_AD_HISTORY_KEY);
  if (stored === null) {
    const [recommendation, promotion] = await Promise.all([
      get(keys.recommendation[1]),
      get(keys.promotion[1]),
    ]);
    return { recommendation: parse(recommendation), promotion: parse(promotion), promotionDeferred: false };
  }
  const history = JSON.parse(stored);
  if (!Number.isSafeInteger(history?.recommendation) || history.recommendation < 0 ||
      !Number.isSafeInteger(history.promotion) || history.promotion < 0 ||
      typeof history.promotionDeferred !== 'boolean') {
    throw Error('팝업 표시 기록을 확인해주세요.');
  }
  return history;
}

async function readHiddenUntil(kind) {
  try {
    return parse(await get(keys[kind][0]));
  } catch {
    return Infinity;
  }
}

let pendingWrite = Promise.resolve();
function queueWrite(operation) {
  const locks = Platform.OS === 'web' ? globalThis.navigator?.locks : null;
  const write = pendingWrite.catch(() => {}).then(() =>
    locks ? locks.request(AUTOMATIC_AD_HISTORY_KEY, operation) : operation()
  );
  pendingWrite = write;
  return write;
}

export const waitForAdWrites = () => pendingWrite.catch(() => {});

export function takeAutomaticAd(hasPromotion, canShow) {
  return queueWrite(async () => {
    if (!canShow()) return null;
    const [history, recommendationHidden, promotionHidden] = await Promise.all([
      readHistory(), readHiddenUntil('recommendation'), readHiddenUntil('promotion'),
    ]);
    if (!canShow()) return null;

    const now = Date.now();
    const lastShown = Math.max(history.recommendation, history.promotion);
    if (lastShown && kstDay(now) <= kstDay(lastShown)) return null;

    const recommendationDue = now >= recommendationHidden &&
      (!history.recommendation || now - history.recommendation >= 3 * DAY);
    const promotionDue = hasPromotion && now >= promotionHidden &&
      (!history.promotion || now - history.promotion >= 7 * DAY);

    let kind = null;
    if (promotionDue && (history.promotionDeferred || !recommendationDue)) {
      kind = 'promotion';
    } else if (recommendationDue) {
      kind = 'recommendation';
    }
    if (!kind) return null;

    await set(AUTOMATIC_AD_HISTORY_KEY, {
      ...history,
      [kind]: now,
      promotionDeferred: kind === 'recommendation' && (history.promotionDeferred || promotionDue),
    });
    return kind;
  });
}

export const hideAdForSevenDays = kind =>
  queueWrite(() => set(keys[kind][0], Date.now() + 7 * DAY));
