// 연말 결산용 '카드 추천 기록'
// 카드를 추천할 때마다 "이 일정에서 내 카드로 아낀 금액"과 "추천 카드가 없어서 놓친 금액"을 한 줄씩 기록합니다.
// 1년치 결제 내역이 아니라 추천 시점의 예상 금액만 남깁니다(올해 기록만 보관).
import * as Store from './demoStore';
import { evaluateBenefit } from './cardRecommendation';
import { categoryLabel, dateKey } from './routineData';
import { typicalAmount } from './schedulePayment';

export const SAVINGS_KEY = 'solpay_savings_records_v1';
const MAX_RECORDS = 120;

let writes = Promise.resolve();
const queue = action => {
  const next = writes.catch(() => {}).then(action);
  writes = next;
  return next;
};

export async function readSavingsRecords() {
  try {
    const value = JSON.parse(await Store.getItemAsync(SAVINGS_KEY));
    return Array.isArray(value?.records) ? value.records : [];
  } catch {
    return [];
  }
}

// 자세한 계산이 안 될 때(추가 조건 확인 필요 등) 쓰는 단순 예상: 정액이면 그 금액, 정률이면 결제 금액 × 비율(건당 한도까지)
function roughValue(benefit, amount) {
  const fixed = Number(benefit?.fixedAmount);
  if (Number.isFinite(fixed) && fixed > 0) return Math.min(fixed, amount);
  const rate = Number(benefit?.rate);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  const value = Math.floor(amount * (rate > 1 ? rate / 100 : rate));
  const cap = Number(benefit?.maxPerTx);
  return Number.isFinite(cap) && cap > 0 ? Math.min(value, cap) : value;
}

// 이 카드의 이 업종 혜택으로 예시 금액을 결제하면 받는 예상 혜택(원). 전월 실적은 충족했다고 가정.
function estimate(row, category, amount, now) {
  const matches = (row?.matches || []).filter(item => item.category === category && item.status !== 'blocked');
  const values = matches.map(match => {
    const result = evaluateBenefit(row.card, match.benefit, {
      spend: Number(match.benefit?.minPrevSpend || 0),
      amount,
      assume: true,
      now,
    });
    if (Number.isFinite(result.value) && result.value > 0) return result.value;
    if (result.status === 'blocked') return 0;
    return roughValue(match.benefit, amount);
  });
  return values.length ? Math.max(0, ...values) : 0;
}

/**
 * 카드 추천 한 번을 기록합니다.
 * @param recommended 추천한 카드 줄(rankRecommendations 결과)
 * @param ownedBest   같은 일정에서 혜택이 가장 좋은 내 카드 줄(없으면 null)
 */
export function recordRecommendation({ recommended, ownedBest, category, reason, now = new Date() }) {
  if (!recommended?.card || !category) return Promise.resolve(null);
  return queue(async () => {
    const amount = typicalAmount(category);
    const recommendedValue = estimate(recommended, category, amount, now);
    const ownedValue = ownedBest ? estimate(ownedBest, category, amount, now) : 0;
    const date = dateKey(now);
    const record = {
      id: `${date}:${recommended.card.code}:${category}`,
      date,
      month: date.slice(0, 7),
      category,
      categoryLabel: categoryLabel(category),
      reason: reason || '',
      amount,
      recommended: { code: recommended.card.code, name: recommended.card.name, owned: Boolean(recommended.owned), value: recommendedValue },
      ownedBest: ownedBest ? { code: ownedBest.card.code, name: ownedBest.card.name, value: ownedValue } : null,
      // 아낀 금액: 내가 가진 카드로 받을 수 있는 혜택
      saved: recommended.owned ? recommendedValue : ownedValue,
      // 놓친 금액: 추천 카드가 내 카드보다 더 줄 수 있었던 혜택
      missed: recommended.owned ? 0 : Math.max(0, recommendedValue - ownedValue),
      createdAt: now.toISOString(),
    };
    const year = date.slice(0, 4);
    const records = (await readSavingsRecords()).filter(item => item.id !== record.id && item.date?.startsWith(year));
    const next = [record, ...records].slice(0, MAX_RECORDS);
    await Store.setItemAsync(SAVINGS_KEY, JSON.stringify({ version: 1, records: next }));
    return record;
  });
}

/** 연말 결산 요약: 올해 아낀 금액·놓친 금액, 월별 기록(최근 월 먼저) */
export function summarizeSavings(records, year = String(new Date().getFullYear())) {
  const mine = records.filter(item => item.date?.startsWith(year));
  const saved = mine.reduce((sum, item) => sum + (item.saved || 0), 0);
  const missed = mine.reduce((sum, item) => sum + (item.missed || 0), 0);
  const months = new Map();
  for (const item of [...mine].sort((a, b) => b.date.localeCompare(a.date))) {
    if (!months.has(item.month)) months.set(item.month, []);
    months.get(item.month).push(item);
  }
  // 가장 많이 놓친 카드(발급하면 좋은 카드)
  const byCard = new Map();
  for (const item of mine.filter(row => row.missed > 0)) {
    const key = item.recommended.code;
    const old = byCard.get(key) || { name: item.recommended.name, code: key, missed: 0, count: 0 };
    byCard.set(key, { ...old, missed: old.missed + item.missed, count: old.count + 1 });
  }
  const topMissedCard = [...byCard.values()].sort((a, b) => b.missed - a.missed)[0] || null;
  return { year, saved, missed, count: mine.length, months: [...months.entries()], topMissedCard };
}

export const waitForSavingsWrites = () => writes.catch(() => {});
