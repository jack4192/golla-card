import {DETAIL_CATEGORIES,detailSignals,validateDetails} from './routineDetails';
import { Platform } from 'react-native';
import * as Store from './demoStore';

export const ROUTINE_KEY = 'solpay_routine_profile_v1';
export const EVENTS_KEY = 'solpay_routine_exceptions_v1';

const CHECKED_KEY = 'solpay_schedule_checked_v1';
const PREFIX = 'solpay_demo_';

export const QUESTIONS = [
  {
    key: 'occupation',
    title: '어떤 일을 하고 계신가요?',
    options: [
      ['worker', '💼 직장인'],
      ['student', '🎓 학생'],
      ['freelancer', '💻 프리랜서'],
      ['other', '🏡 기타'],
    ],
  },
  {
    key: 'lunchPlace',
    title: '평소 점심은 어디서 드시나요?',
    options: [
      ['cafeteria', '회사·학교 식당'],
      ['restaurant', '근처 음식점'],
      ['convenience', '편의점'],
      ['lunchbox', '도시락'],
      ['home', '집'],
      ['skip', '거르는 편'],
    ],
  },
  {
    key: 'coffee',
    title: '커피는 얼마나 자주 마시나요?',
    options: [
      ['always', '거의 매일'],
      ['sometimes', '가끔'],
      ['never', '거의 안 마심'],
    ],
  },
  {
    key: 'evening',
    title: '일과가 끝나면 무엇을 하시나요?',
    options: [
      ['home', '바로 귀가'],
      ['dinner', '외식'],
      ['cafe', '카페·취미'],
      ['study', '공부·운동'],
      ['variable', '매일 다름'],
    ],
  },
  {
    key: 'transport',
    title: '주로 어떤 교통수단을 이용하나요?',
    options: [
      ['public', '버스·지하철'],
      ['car', '자가용'],
      ['taxi', '택시'],
      ['walk', '도보·자전거'],
      ['mixed', '여러 수단'],
      ['none', '이동 적음'],
    ],
  },
  {
    key: 'fuel',
    title: '주유·충전은 얼마나 자주 하나요?',
    options: [
      ['weekly', '주 1회 이상'],
      ['monthly', '월 1~3회'],
      ['electric', '전기차 충전'],
      ['none', '이용하지 않음'],
    ],
  },
  {
    key: 'shopping',
    title: '주로 어디서 쇼핑하나요?',
    options: [
      ['online', '온라인 쇼핑'],
      ['mart', '마트·장보기'],
      ['department', '백화점·아울렛'],
      ['mixed', '온라인·오프라인'],
      ['none', '거의 안 함'],
    ],
  },
];

export const EVENT_OPTIONS = [
  ['hospital', '🏥 병원 예약'],
  ['half_day', '🕒 반차·조퇴'],
  ['day_off', '🌿 휴무·휴강'],
  ['unwell', '🤒 몸 상태가 좋지 않음'],
  ['overtime', '💻 야근·추가 공부'],
  ['appointment', '🤝 개인 약속'],
  ['team_dinner', '🍽️ 회식·모임'],
  ['night_snack', '🛵 야식·배달'],
  ['travel', '🚆 외출·여행'],
  ['shopping', '🛍️ 쇼핑·장보기'],
  ['refuel', '⛽ 주유·충전'],
  ['other', '✏️ 기타'],
];

export const CATEGORIES = {
  ...DETAIL_CATEGORIES,
  cafe: {
    label: '카페·커피',
    words: ['카페', '커피', '스타벅스', '이디야', '투썸', '폴바셋'],
  },
  restaurant: {
    label: '외식·음식점',
    words: ['외식', '음식점', '식당', '레스토랑', '패밀리레스토랑'],
  },
  convenience: {
    label: '편의점',
    words: ['편의점', 'CU', 'GS25', '세븐일레븐'],
  },
  medical: {
    label: '병원·약국',
    words: ['병원', '의원', '약국', '의료', '치과', '한의원'],
  },
  transport: {
    label: '교통·이동',
    words: ['대중교통', '버스', '지하철', '교통', '택시'],
  },
  fuel: {
    label: '주유·충전',
    words: ['주유', '충전', 'GS칼텍스', 'SK에너지', 'S-OIL'],
  },
  shopping: {
    label: '쇼핑·장보기',
    words: ['쇼핑', '온라인몰', '백화점', '마트', '쿠팡', '네이버', '아울렛'],
  },
  delivery: {
    label: '배달·야식',
    words: ['배달', '요기요', '배달의민족', '쿠팡이츠', '땡겨요'],
  },
};

export function dateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);

  return (
    year >= 1900 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function shiftDate(value, offset) {
  const [year, month, day] = (
    validDate(value) ? value : dateKey()
  ).split('-').map(Number);

  return dateKey(new Date(year, month - 1, day + offset, 12));
}

export function normalizeProfile(value) {
  const profile =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};

  return {
    ...profile,
    ...Object.fromEntries(
      QUESTIONS.map(question => [
        question.key,
        question.options.some(([allowed]) => allowed === profile[question.key])
          ? profile[question.key]
          : '',
      ])
    ),
  };
}

export function completeProfile(profile) {
  return QUESTIONS.every(question =>
    question.options.some(([value]) => value === profile?.[question.key])
  );
}

async function readJson(key, fallback) {
  const raw =
    Platform.OS === 'web'
      ? window.localStorage.getItem(PREFIX + key)
      : await Store.getItemAsync(key);

  return raw === null || raw === undefined ? fallback : JSON.parse(raw);
}

async function writeJson(key, value) {
  const raw = JSON.stringify(value);

  if (Platform.OS === 'web') {
    window.localStorage.setItem(PREFIX + key, raw);
  } else {
    await Store.setItemAsync(key, raw);
  }
}

export async function readProfile() {
  const value = await readJson(ROUTINE_KEY, null);

  if (
    value !== null &&
    (typeof value !== 'object' || Array.isArray(value))
  ) {
    throw Error('일과 기록 형식을 확인해주세요.');
  }

  return normalizeProfile(value);
}

export async function saveProfile(profile) {
  const next = {
    ...normalizeProfile(profile),
    version: 2,
    updatedAt: new Date().toISOString(),
  };

  if (!completeProfile(next)) {
    throw Error('7가지 질문에 모두 답변해주세요.');
  }

  await writeJson(ROUTINE_KEY, next);
  return next;
}

export async function deleteProfile() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(PREFIX + ROUTINE_KEY);
  } else {
    await Store.deleteItemAsync(ROUTINE_KEY);
  }
}

export async function readEvents() {
  const events = await readJson(EVENTS_KEY, []);

  const invalid =
    !Array.isArray(events) ||
    events.some(event =>
      !event ||
      typeof event.id !== 'string' ||
      !validDate(event.date) ||
      !Array.isArray(event.types) ||
      event.types.some(type => typeof type !== 'string') ||
      (event.memo !== undefined && typeof event.memo !== 'string')
    );

  if (invalid) {
    throw Error(
      '일정 기록 형식을 확인해주세요. 기존 기록을 덮어쓰지 않았습니다.'
    );
  }

  return events;
}

export async function saveEvent(input) {
  if (!validDate(input.date)) {
    throw Error('날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
  }

  const types = [...new Set(input.types || [])].filter(type =>
    EVENT_OPTIONS.some(([value]) => value === type)
  );

  if (!types.length) {
    throw Error('일정 종류를 선택해주세요.');
  }

  const events = await readEvents();
  const old = input.id
    ? events.find(event => event.id === input.id)
    : null;

  if (input.id && !old) {
    throw Error('이미 삭제된 일정입니다. 다시 불러와주세요.');
  }

  const now = new Date().toISOString();

  const event = {
    ...old,
    id:
      old?.id ||
      Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    date: input.date,
    types,
    memo: String(input.memo || '').trim().slice(0, 80),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };

  await writeJson(EVENTS_KEY, [
    event,
    ...events.filter(item => item.id !== event.id),
  ]);

  return event;
}

export async function deleteEvent(id) {
  const events = await readEvents();

  await writeJson(
    EVENTS_KEY,
    events.filter(event => event.id !== id)
  );
}

export async function isTodayConfirmed(day = dateKey()) {
  return (await readJson(CHECKED_KEY, null))?.date === day;
}

export async function confirmToday() {
  await writeJson(CHECKED_KEY, {
    date: dateKey(),
    confirmedAt: new Date().toISOString(),
  });
}

export function eventLabel(type) {
  return EVENT_OPTIONS.find(([id]) => id === type)?.[1] || type;
}

export function makeSignals(profile, events, day = dateKey()) {
  const found = new Map();

  const add = (id, weight, reason) => {
    const old = found.get(id);

    if (old) {
      old.weight = Math.max(old.weight, weight);

      if (!old.reasons.includes(reason)) {
        old.reasons.push(reason);
      }
    } else {
      found.set(id, {
        id,
        weight,
        reasons: [reason],
      });
    }
  };

  const today = (Array.isArray(events) ? events : [])
    .filter(event => event.date === day);

  const off = today.some(event =>
    event.types.includes('day_off') || event.types.includes('unwell')
  );

  if (profile?.coffee === 'always') {
    add('cafe', 3, '평소 커피를 거의 매일 마심');
  }

  if (profile?.coffee === 'sometimes') {
    add('cafe', 1, '가끔 커피를 마심');
  }

  if (!off) {
    if (profile?.lunchPlace === 'restaurant') {
      add('restaurant', 2, '점심을 근처 음식점에서 먹음');
    }

    if (profile?.lunchPlace === 'convenience') {
      add('convenience', 2, '점심에 편의점을 이용함');
    }

    if (['public', 'mixed', 'taxi'].includes(profile?.transport)) {
      add('transport', 2, '평소 교통수단 이용');
    }
  }

  if (profile?.evening === 'dinner') {
    add('restaurant', 2, '일과 후 외식하는 편');
  }

  if (profile?.evening === 'cafe') {
    add('cafe', 2, '일과 후 카페·취미 활동');
  }

  if (['weekly', 'monthly', 'electric'].includes(profile?.fuel)) {
    add(
      'fuel',
      profile.fuel === 'monthly' ? 1 : 2,
      '평소 주유·충전 이용'
    );
  }

  if (profile?.shopping && profile.shopping !== 'none') {
    add('shopping', 2, '평소 쇼핑·장보기 습관');
  }

  const mapping = {
    hospital: ['medical', '오늘 병원 방문'],
    team_dinner: ['restaurant', '오늘 회식·모임'],
    night_snack: ['delivery', '오늘 야식·배달'],
    travel: ['transport', '오늘 외출·여행'],
    shopping: ['shopping', '오늘 쇼핑·장보기'],
    refuel: ['fuel', '오늘 주유·충전'],
  };

  today.forEach(event => {
    event.types.forEach(type => {
      const match = mapping[type];

      if (match) {
        add(match[0], 4, match[1]);
      }
    });
  });

  detailSignals(profile?.detailedRoutine, day).forEach(signal => add(signal.id, signal.weight, signal.reason));
  return [...found.values()];
}
// DETAILED_ROUTINE_DATA_V1
export async function saveDetailedRoutine(rows) {
  const detailedRoutine = validateDetails(rows);
  const profile = await readProfile();
  const next = {...profile, detailedRoutine, version:2, updatedAt:new Date().toISOString()};
  await writeJson(ROUTINE_KEY, next);
  return next;
}
