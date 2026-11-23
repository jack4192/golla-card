import { Platform } from 'react-native';
import * as Store from './demoStore';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { categoryWords, dateKey, isCustomCategory, makeSignals } from './routineData';

const KEY = 'solpay_recommendation_preferences_v1';
const PREFIX = 'solpay_demo_';

const codes = new Set(CSV_CARD_CATALOG.map(card => card.code));

const record = value =>
  value && typeof value === 'object' && !Array.isArray(value);

export const monthKey = () => dateKey().slice(0, 7);

export const numberValue = value => {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  if (!/^\d{1,10}$/.test(String(value))) {
    return null;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number <= 1000000000
    ? number
    : null;
};

export const money = value =>
  Number(value).toLocaleString('ko-KR') + '원';

export const amountText = (value, unit) =>
  unit === 'POINT'
    ? Number(value).toLocaleString('ko-KR') + 'P'
    : money(value);

export function emptyPreferences() {
  return {
    version: 1,
    month: monthKey(),
    owned: [],
    interests: [],
    spend: {},
    remaining: {},
    scenario: {
      spend: '',
      amount: '',
      assume: false,
    },
  };
}

export function normalizePreferences(value) {
  const base = emptyPreferences();

  if (value === null) return base;

  if (
    !record(value) ||
    value.version !== 1 ||
    !Array.isArray(value.owned) ||
    !Array.isArray(value.interests) ||
    !record(value.spend) ||
    !record(value.remaining) ||
    !record(value.scenario)
  ) {
    throw Error('추천 설정 형식이 올바르지 않습니다.');
  }

  const validList = list =>
    [...new Set(list.filter(code => codes.has(code)))];

  const cleanInputs = source =>
    Object.fromEntries(
      Object.entries(source).map(([key, input]) => {
        if (input !== '' && numberValue(input) === null) {
          throw Error('저장된 금액 형식을 확인해주세요.');
        }

        return [key, String(input)];
      })
    );

  const spend = cleanInputs(value.spend);

  const remaining = Object.fromEntries(
    Object.entries(value.remaining).map(([key, group]) => {
      if (!record(group)) {
        throw Error('저장된 잔여 한도 형식을 확인해주세요.');
      }

      return [key, cleanInputs(group)];
    })
  );

  cleanInputs({
    spend: value.scenario.spend ?? '',
    amount: value.scenario.amount ?? '',
  });

  return {
    ...base,
    owned: validList(value.owned),
    interests: validList(value.interests),
    spend: value.month === base.month ? spend : {},
    remaining: value.month === base.month ? remaining : {},
    scenario: {
      spend: String(value.scenario.spend ?? ''),
      amount: String(value.scenario.amount ?? ''),
      assume: value.scenario.assume === true,
    },
  };
}

export async function readPreferences() {
  const raw =
    Platform.OS === 'web'
      ? window.localStorage.getItem(PREFIX + KEY)
      : await Store.getItemAsync(KEY);

  return normalizePreferences(raw ? JSON.parse(raw) : null);
}

export async function savePreferences(value) {
  const next = normalizePreferences(value);

  const inputs = [
    next.scenario.spend,
    next.scenario.amount,
    ...Object.values(next.spend),
  ];

  for (const group of Object.values(next.remaining)) {
    if (!record(group)) {
      throw Error('잔여 한도 입력값을 확인해주세요.');
    }

    inputs.push(...Object.values(group));
  }

  if (
    inputs.some(input =>
      input !== '' && numberValue(input) === null
    )
  ) {
    throw Error('금액은 0~10억 원의 정수로 입력해주세요.');
  }

  const raw = JSON.stringify(next);

  if (Platform.OS === 'web') {
    window.localStorage.setItem(PREFIX + KEY, raw);
  } else {
    await Store.setItemAsync(KEY, raw);
  }

  return next;
}

export async function deletePreferences() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(PREFIX + KEY);
  } else {
    await Store.deleteItemAsync(KEY);
  }
}

export function selectedTier(card, group, spend) {
  if (spend === null) return null;

  return (
    (card.tiers || [])
      .filter(tier =>
        tier.capGroup === group &&
        Number(tier.minPrevSpend || 0) <= spend
      )
      .sort(
        (a, b) =>
          Number(b.minPrevSpend || 0) -
          Number(a.minPrevSpend || 0)
      )[0] || null
  );
}

export function limitGroups(card) {
  return [
    ...new Set((card.tiers || []).map(tier => tier.capGroup)),
  ];
}

export function benefitText(benefit) {
  if (benefit.type === 'PER_LITER_DISCOUNT') {
    return `${benefit.fixedAmount}원/ℓ`;
  }

  if (benefit.type === 'MULTIPLIER') {
    return `${benefit.rate}배 · 추가 조건 확인`;
  }

  if (
    Number(benefit.rate) > 0 &&
    Number(benefit.rate) <= 1
  ) {
    return `${Number((benefit.rate * 100).toFixed(3))}%`;
  }

  if (
    benefit.fixedAmount !== null &&
    benefit.fixedAmount !== undefined
  ) {
    return amountText(
      benefit.fixedAmount,
      benefit.type === 'POINT' ? 'POINT' : 'KRW'
    );
  }

  return '상품 상세 조건 확인';
}

function calendarAllowed(benefit, now) {
  const condition = benefit.dayCondition;

  if (condition === 'MONDAY' && now.getDay() !== 1) {
    return false;
  }

  if (
    condition === 'WEEKEND' &&
    ![0, 6].includes(now.getDay())
  ) {
    return false;
  }

  if (condition === 'DAY_1' && now.getDate() !== 1) {
    return false;
  }

  if (condition === 'DAY_10' && now.getDate() !== 10) {
    return false;
  }

  if (
    condition &&
    !['MONDAY', 'WEEKEND', 'DAY_1', 'DAY_10'].includes(condition)
  ) {
    return false;
  }

  if (benefit.timeStart || benefit.timeEnd) {
    if (
      !/^\d{2}:\d{2}$/.test(benefit.timeStart) ||
      !/^\d{2}:\d{2}$/.test(benefit.timeEnd)
    ) {
      return false;
    }

    const toMinutes = text =>
      Number(text.slice(0, 2)) * 60 + Number(text.slice(3));

    const start = toMinutes(benefit.timeStart);
    const end = toMinutes(benefit.timeEnd);
    const minutes = now.getHours() * 60 + now.getMinutes();

    const within =
      start <= end
        ? minutes >= start && minutes < end
        : minutes >= start || minutes < end;

    if (!within) return false;
  }

  return true;
}

export function evaluateBenefit(
  card,
  benefit,
  {
    spend = null,
    amount = null,
    remaining = {},
    assume = false,
    now = new Date(),
  } = {}
) {
  const unit = benefit.type === 'POINT' ? 'POINT' : 'KRW';

  const out = (status, label, value = null) => ({
    status,
    label,
    value,
    unit,
    benefit,
  });

  const threshold = Number(benefit.minPrevSpend || 0);

  if (threshold > 0 && spend === null) {
    return out('unknown', '전월 실적 미입력');
  }

  if (spend !== null && spend < threshold) {
    return out('blocked', `전월 ${money(threshold)} 이상 필요`);
  }

  if (!calendarAllowed(benefit, now)) {
    return out('blocked', '현재 날짜·시간 조건 미충족');
  }

  if (
    amount !== null &&
    amount < Number(benefit.minAmountPerTx || 0)
  ) {
    return out(
      'blocked',
      `건당 ${money(benefit.minAmountPerTx)} 이상 필요`
    );
  }

  if (
    ![
      'DISCOUNT',
      'CASHBACK',
      'POINT',
      'INSTANT_DISCOUNT',
    ].includes(benefit.type)
  ) {
    return out('unknown', '추가 정보가 필요해 금액 계산 제외');
  }

  const group = benefit.capGroup;
  let tier = selectedTier(card, group, spend);

  const hasGroup = (card.tiers || []).some(
    item => item.capGroup === group
  );

  if (hasGroup && spend === null) {
    return out('unknown', '통합 한도 확인을 위한 실적 필요');
  }

  if (hasGroup && !tier) {
    if (
      card.code === 'KB_NORI2_CHECK' &&
      benefit.benefitId === '170'
    ) {
      tier = {
        unit: 'KRW',
        monthlyCap: 3000,
      };
    } else {
      return out('blocked', '통합 한도 실적 구간 미충족');
    }
  }

  const balance = numberValue(remaining[group]);

  if (
    balance === 0 ||
    benefit.monthlyCap === 0 ||
    benefit.monthlyCountCap === 0 ||
    benefit.dailyCountCap === 0
  ) {
    return out('blocked', '사용 가능한 한도·횟수 없음', 0);
  }

  if (amount === null || amount <= 0) {
    return out(
      'ready',
      '실적 조건 충족 · 결제금액 입력 필요'
    );
  }

  if (!assume) {
    return out(
      'ready',
      '가맹점·결제방식·횟수 조건 확인 필요'
    );
  }

  let base = amount;

  if (tier?.unit === 'USAGE_KRW') {
    base = Math.min(
      base,
      Number(tier.monthlyCap),
      balance ?? Infinity
    );
  }

  const rate = Number(benefit.rate);
  let value;

  if (
    benefit.rate !== null &&
    benefit.rate !== undefined &&
    rate > 0 &&
    rate <= 1
  ) {
    value = Math.floor(base * rate);
  } else if (
    benefit.fixedAmount !== null &&
    benefit.fixedAmount !== undefined &&
    Number(benefit.fixedAmount) >= 0
  ) {
    value =
      unit === 'POINT'
        ? Number(benefit.fixedAmount)
        : Math.min(base, Number(benefit.fixedAmount));
  } else {
    return out('unknown', '계산식 확인 필요');
  }

  const caps = unit === 'POINT' ? [value] : [value, amount];

  if (
    benefit.maxPerTx !== null &&
    benefit.maxPerTx !== undefined
  ) {
    caps.push(Number(benefit.maxPerTx));
  }

  if (
    benefit.monthlyCap !== null &&
    benefit.monthlyCap !== undefined
  ) {
    caps.push(Number(benefit.monthlyCap));
  }

  if (tier && tier.unit !== 'USAGE_KRW') {
    if (tier.unit !== unit) {
      return out('unknown', '한도 단위 확인 필요');
    }

    caps.push(Number(tier.monthlyCap));
  }

  if (balance !== null && tier?.unit !== 'USAGE_KRW') {
    caps.push(balance);
  }

  if (
    card.code === 'KB_BIZ_PRIME' &&
    group?.startsWith('BIZ_')
  ) {
    const parent = selectedTier(card, 'BIZ_TOTAL', spend);

    if (!parent) {
      return out('unknown', '상위 통합 한도 확인 필요');
    }

    caps.push(Number(parent.monthlyCap));

    const parentBalance = numberValue(remaining.BIZ_TOTAL);

    if (parentBalance !== null) {
      caps.push(parentBalance);
    }
  }

  value = Math.max(0, Math.floor(Math.min(...caps)));

  return out(
    value ? 'estimate' : 'blocked',
    value
      ? '상세 조건 충족 가정 · 결제 1건 예상'
      : '사용 가능한 한도 없음',
    value
  );
}

function matchesCategory(
  benefit,
  category,
  profile,
  signal
) {
  const name = String(benefit.name || '').toLowerCase();

  const general =
    /국내외 가맹점|전 가맹점|모든 가맹점/.test(name);

  if (general) return true;

  // 직접 입력한 업종(custom:...)은 혜택 이름·조건 문구에서 그 말을 찾습니다.
  if (isCustomCategory(category)) {
    const text = (name + ' ' + String(benefit.note || '')).toLowerCase().replace(/s+/g, '');
    return categoryWords(category).some(word => text.includes(word.toLowerCase().replace(/s+/g, '')));
  }

  const special = signal.reasons.some(reason =>
    reason.startsWith('오늘 ')
  );

  if (!special && category === 'fuel') {
    if (
      profile?.fuel === 'electric' &&
      (
        !/전기차|충전/.test(name) ||
        benefit.type === 'PER_LITER_DISCOUNT'
      )
    ) {
      return false;
    }

    if (
      ['weekly', 'monthly'].includes(profile?.fuel) &&
      /전기차/.test(name)
    ) {
      return false;
    }
  }

  if (
    !special &&
    category === 'transport' &&
    profile?.transport === 'taxi' &&
    !/택시/.test(name)
  ) {
    return false;
  }

  if (!special && category === 'shopping') {
    if (
      profile?.shopping === 'online' &&
      !/온라인|쇼핑|쿠팡|네이버|11번가|g마켓|ssg/.test(name)
    ) {
      return false;
    }

    if (
      profile?.shopping === 'mart' &&
      !/마트|장보기|홈플러스|코스트코/.test(name)
    ) {
      return false;
    }

    if (
      profile?.shopping === 'department' &&
      !/백화점|아울렛/.test(name)
    ) {
      return false;
    }
  }

  if (
    category === 'shopping' &&
    /멤버십|월회비|간편결제/.test(name)
  ) {
    return false;
  }

  return categoryWords(category).some(word =>
    name.includes(word.toLowerCase())
  );
}

export function rankRecommendations(
  profile,
  events,
  preferences,
  now = new Date()
) {
  const signals = makeSignals(profile, events, dateKey(now));

  const monthValid =
    preferences.month === dateKey(now).slice(0, 7);

  const factor = {
    estimate: 1,
    ready: 0.8,
    unknown: 0.35,
    blocked: 0.05,
  };

  const quality = row => {
    if (row.status !== 'estimate') {
      return factor[row.status];
    }

    const amount = numberValue(preferences.scenario.amount);

    const nominal =
      Number(row.benefit.rate) > 0
        ? amount * Number(row.benefit.rate)
        : Number(row.benefit.fixedAmount);

    const capRatio =
      nominal > 0
        ? Math.min(1, row.value / nominal)
        : 0;

    const strength =
      row.unit === 'KRW' && amount > 0
        ? Math.min(1, row.value / amount / 0.1)
        : 0.5;

    return 0.8 + 0.1 * capRatio + 0.1 * strength;
  };

  const totalWeight = signals.reduce(
    (sum, item) => sum + item.weight,
    0
  );

  if (!totalWeight) return [];

  return CSV_CARD_CATALOG
    .map(card => {
      const owned = preferences.owned.includes(card.code);

      const spend = numberValue(
        owned
          ? monthValid
            ? preferences.spend[card.code]
            : ''
          : preferences.scenario.spend
      );

      const remaining = monthValid
        ? preferences.remaining[card.code] || {}
        : {};

      const amount = numberValue(preferences.scenario.amount);

      const rows = (card.benefits || []).map(benefit =>
        evaluateBenefit(card, benefit, {
          spend,
          amount,
          remaining,
          assume: preferences.scenario.assume,
          now,
        })
      );

      const matches = signals.flatMap(signal => {
        const candidates = rows.filter(row =>
          matchesCategory(
            row.benefit,
            signal.id,
            profile,
            signal
          )
        );

        candidates.sort(
          (a, b) =>
            quality(b) - quality(a) ||
            Number(b.benefit.minPrevSpend || 0) -
              Number(a.benefit.minPrevSpend || 0)
        );

        return candidates.length
          ? [{
              ...candidates[0],
              category: signal.id,
              weight: signal.weight,
              reasons: signal.reasons,
            }]
          : [];
      });

      const score = Math.round(
        100 *
        matches.reduce(
          (sum, item) =>
            sum + item.weight * quality(item),
          0
        ) /
        totalWeight
      );

      return {
        card,
        owned,
        spend,
        remaining,
        matches,
        score,
      };
    })
    .filter(result => result.matches.length)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(a.card.annualFee || 0) -
          Number(b.card.annualFee || 0) ||
        a.card.code.localeCompare(b.card.code)
    );
}