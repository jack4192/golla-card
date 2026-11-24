import { DETAIL_CATEGORIES, INDUSTRIES, ROUTINE_TITLE_LIMIT, detailSignals, normalizeTime, routineLabel, validateDetails } from './routineDetails';
import { Platform } from 'react-native';
import * as Store from './demoStore';
import { SERVER_MODE, api } from './api';
import { fromServerCategory, toServerCategory } from './scheduleCategory';
import { serverCacheEvents } from './eventCacheCore';
import { eventCategoryIds } from './eventCategoryCore';

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

export const ROUTINE_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

export const ROUTINE_ACTIVITY_TIMES = {
  lunchPlace: {
    label: '점심',
    scheduleKey: 'lunchSchedule',
    excludedAnswer: 'skip',
    hours: Array.from({ length: 7 }, (_, index) => index + 9),
  },
  coffee: {
    label: '커피',
    scheduleKey: 'coffeeSchedule',
    excludedAnswer: 'never',
    hours: Array.from({ length: 8 }, (_, index) => index + 9),
  },
};

// 상황 일정 이름은 글자만 두고, 화면에서는 EVENT_ICONS 의 선 아이콘(Ionicons)을 함께 보여준다.
export const EVENT_OPTIONS = [
  ['hospital', '병원 예약'],
  ['half_day', '반차·조퇴'],
  ['day_off', '휴무·휴강'],
  ['unwell', '몸 상태가 좋지 않음'],
  ['overtime', '야근·추가 공부'],
  ['appointment', '개인 약속'],
  ['team_dinner', '회식·모임'],
  ['night_snack', '야식·배달'],
  ['travel', '외출·여행'],
  ['shopping', '쇼핑·장보기'],
  ['refuel', '주유·충전'],
  ['other', '기타'],
];

export const EVENT_ICONS = {
  hospital: 'medkit-outline',
  half_day: 'time-outline',
  day_off: 'sunny-outline',
  unwell: 'thermometer-outline',
  overtime: 'laptop-outline',
  appointment: 'people-outline',
  team_dinner: 'restaurant-outline',
  night_snack: 'bicycle-outline',
  travel: 'walk-outline',
  shopping: 'bag-handle-outline',
  refuel: 'car-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

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

// ── 직접 입력한 업종 ──
// 기본 업종에 없는 곳(헬스장, 영화관 등)은 'custom:<입력한 업종>' 으로 추천에 반영합니다.
// 입력한 말과 아래 비슷한 말로 카드 혜택 이름·조건을 찾아요.
const CUSTOM_SYNONYMS = [
  [/헬스|피트니스|필라테스|요가|운동/, ['헬스', '피트니스', '스포츠', '필라테스', '요가']],
  [/영화|시네마|cgv|메가박스/i, ['영화', 'CGV', '롯데시네마', '메가박스']],
  [/미용|헤어|네일|뷰티/, ['미용', '헤어', '뷰티', '올리브영']],
  [/학원|교육|과외|강의|인강/, ['학원', '교육', '강의']],
  [/서점|책|도서/, ['서점', '도서', '교보', '예스24']],
  [/놀이공원|테마파크|에버랜드|롯데월드/, ['놀이공원', '테마파크', '에버랜드', '롯데월드']],
  [/통신|휴대폰|핸드폰|요금/, ['통신', '이동통신', 'SKT', 'KT', 'LG U+']],
  [/약국|드럭|올리브영/, ['약국', '올리브영', '드럭스토어']],
  [/독서실|스터디/, ['스터디', '독서실']],
  [/OTT|넷플릭스|유튜브|구독/i, ['넷플릭스', '유튜브', 'OTT', '디지털콘텐츠', '구독']],
  [/야구|트윈스|직관/, ['야구', 'LG트윈스', '트윈스', '홈경기', '입장권', '구단']],     // 2026-11-24
];
export const CUSTOM_CATEGORY_PREFIX = 'custom:';
export const isCustomCategory = id => typeof id === 'string' && id.startsWith(CUSTOM_CATEGORY_PREFIX);
export const customKeyword = id => (isCustomCategory(id) ? id.slice(CUSTOM_CATEGORY_PREFIX.length) : '');

export function customWords(keyword) {
  const text = String(keyword || '').trim();
  if (!text) return [];
  const extra = CUSTOM_SYNONYMS.filter(([pattern]) => pattern.test(text)).flatMap(([, words]) => words);
  // 끝의 '장·점·관·실'을 뗀 말도 함께 찾습니다(예: 볼링장 → 볼링).
  const stem = text.replace(/(장|점|관|실|집|샵)$/, '');
  return [...new Set([text, stem.length >= 2 ? stem : '', ...extra].filter(Boolean))];
}

/** 업종 id(기본 또는 custom:...)의 화면 이름 */
export function categoryLabel(id) {
  if (isCustomCategory(id)) return `'${customKeyword(id)}'`;
  return CATEGORIES[id]?.label || '기타';
}

/** 업종 id(기본 또는 custom:...)로 카드 혜택을 찾을 때 쓰는 말 목록 */
export function categoryWords(id) {
  return isCustomCategory(id) ? customWords(customKeyword(id)) : CATEGORIES[id]?.words || [];
}

/** 직접 입력한 업종 이름을 기본 업종으로 바꿀 수 있으면 바꾸고, 아니면 custom 업종으로 */
export function typedCategoryIds(title) {
  const text = String(title || '').trim();
  if (!text) return [];
  if (/(?:시외|고속)\s*버스/.test(text)) return ['intercity'];
  if (/(?:대중\s*교통|지하철|버스)/.test(text)) return ['transport'];
  if (/택시/.test(text)) return ['taxi'];
  const lower = text.toLowerCase();
  const known = Object.entries(CATEGORIES)
    .filter(([, { label, words }]) => [label, ...words].some(word => word.length >= 2 && lower.includes(word.toLowerCase())))
    .map(([id]) => id);
  return known.length ? known.slice(0, 1) : [CUSTOM_CATEGORY_PREFIX + text];
}

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

  const normalized = {
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

  for (const [key, { scheduleKey, excludedAnswer, hours }] of Object.entries(ROUTINE_ACTIVITY_TIMES)) {
    const schedule = normalized[key] === excludedAnswer ? null : profile[scheduleKey];
    normalized[scheduleKey] = {
      days: ROUTINE_WEEKDAYS.filter(day => Array.isArray(schedule?.days) && schedule.days.includes(day)),
      hours: hours.filter(hour => Array.isArray(schedule?.hours) && schedule.hours.includes(hour)),
    };
  }

  return normalized;
}

export function completeProfile(profile) {
  return QUESTIONS.every(question =>
    question.options.some(([value]) => value === profile?.[question.key])
  );
}

export function dailyBasicSchedule(profile, day = dateKey()) {
  const weekday = new Date(day + 'T12:00:00').getDay();
  const { coffee, coffeeSchedule, lunchPlace, lunchSchedule } = normalizeProfile(profile);
  const lunchCategory = { restaurant: 'restaurant', convenience: 'convenience' }[lunchPlace];
  const activities = [
    [lunchPlace && lunchPlace !== 'skip', '점심', lunchCategory, lunchSchedule],
    [coffee && coffee !== 'never', '커피', 'cafe', coffeeSchedule],
  ];

  return activities.flatMap(([enabled, label, category, schedule]) => {
    if (!enabled || (schedule.days.length && !schedule.days.includes(weekday))) return [];

    const intervals = [];
    for (const hour of schedule.hours) {
      const previous = intervals[intervals.length - 1];
      if (previous?.end === hour) previous.end += 1;
      else intervals.push({ start: hour, end: hour + 1 });
    }
    return intervals.map(({ start, end }) => ({ label, category, start, end }));
  });
}

export function effectiveDetailedRoutine(profile) {
  const { lunchPlace, lunchSchedule, coffee, coffeeSchedule, detailedRoutine } = normalizeProfile(profile);
  if (!Array.isArray(detailedRoutine)) return [];

  return detailedRoutine.filter(row => {
    if (row?.category === 'cafe') return coffee !== 'never' && !(coffee && coffeeSchedule.hours.length);
    if (row?.category === 'restaurant') return lunchPlace !== 'skip' && !(lunchPlace && lunchSchedule.hours.length);
    return true;
  });
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

// 회원가입 때 고른 직장으로 일과 질문의 직업 답만 채웁니다(다른 답은 그대로, 완성 여부 검사 없음).
export async function saveOccupation(occupation, extra = {}) {
  const profile = await readProfile();
  await writeJson(ROUTINE_KEY, { ...profile, ...extra, occupation, updatedAt: new Date().toISOString() });
}

export async function deleteProfile() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(PREFIX + ROUTINE_KEY);
  } else {
    await Store.deleteItemAsync(ROUTINE_KEY);
  }
}

// ── 서버 모드 일정 변환 ──
// 앱: { id, date, types[], category?(소문자), title?, start?, end?, memo }
// 서버: { scheduleId, date, kind, types[], category(대문자), categoryName, title, start, end, memo }
function eventFromServer(item) {
  const event = {
    id: String(item.scheduleId),
    date: String(item.date),
    types: [],
    memo: item.memo || '',
  };
  if (item.kind === 'PLACE') {
    // 서버 업종 코드를 앱 업종으로 바꿉니다(예: TRANSIT → transport). 앱에 없는 업종이면 '기타'로 보여주고,
    // 업종 이름을 일정 이름으로 씁니다. 표는 utils/scheduleCategory.js 에 있습니다.
    Object.assign(event, fromServerCategory(item));
    event.start = item.start;
    event.end = item.end;
  } else {
    event.types = (Array.isArray(item.types) ? item.types : []).map(String);
    if (item.start && item.end) Object.assign(event, { start: item.start, end: item.end });
    if (item.title) event.title = item.title;
  }
  return event;
}

function eventToServer(event) {
  const place = Boolean(event.category);
  // 장소 일정의 업종은 서버 코드로 바꿔 보냅니다. 대문자로만 바꾸면 서버에 없는 코드가 돼서
  // (transport → TRANSPORT, 서버는 TRANSIT) 서버가 '존재하지 않는 업종'으로 거절합니다.
  const server = place ? toServerCategory(event) : null;
  return {
    date: event.date,
    types: place ? null : event.types,
    category: place ? server.category : null,
    // 상황 일정의 '직접 입력' 이름(예: 밥먹기)도 함께 보냅니다. 서버가 상황·장소 일정 모두 저장합니다.
    title: place ? server.title : event.title || null,
    start: event.start || null,
    end: event.end || null,
    memo: event.memo || null,
  };
}

// 서버 모드: 서버 일정을 읽어 기기에도 복사해 둡니다(다른 화면 계산용).
async function readServerEvents() {
  const list = await api.schedules();
  const events = (Array.isArray(list) ? list : []).map(eventFromServer);
  await writeJson(EVENTS_KEY, events);
  return events;
}

export async function readEvents() {
  if (SERVER_MODE) {
    try {
      return await readServerEvents();
    } catch (error) {
      throw Error('서버에서 일정을 불러오지 못했어요. ' + (error?.message || ''));
    }
  }
  return readLocalEvents();
}

// 일정 저장·삭제 때 쓰는 기기 목록: 서버 모드는 서버 복사본이라 느슨하게(모양만), 데모 모드는 엄격하게 (2026-11-24)
async function readEventsForWrite() {
  if (SERVER_MODE) return serverCacheEvents(await readJson(EVENTS_KEY, []));
  return readLocalEvents();
}

async function readLocalEvents() {
  const events = await readJson(EVENTS_KEY, []);

  const invalid =
    !Array.isArray(events) ||
    events.some(event =>
      !event ||
      typeof event.id !== 'string' ||
      !validDate(event.date) ||
      !Array.isArray(event.types) ||
      event.types.some(type => typeof type !== 'string') ||
      (event.category !== undefined && (
        !INDUSTRIES.some(([id]) => id === event.category) ||
        !event.start || normalizeTime(event.start) !== event.start ||
        !event.end || normalizeEventEnd(event.end) !== event.end || event.start === event.end
      )) ||
      // 상황 일정(types)은 시간이 선택 항목이지만, 있으면 시작·종료가 모두 올바라야 합니다.
      (event.category === undefined && (event.start !== undefined || event.end !== undefined) && (
        normalizeTime(event.start) !== event.start ||
        normalizeEventEnd(event.end) !== event.end || event.start === event.end
      )) ||
      (event.memo !== undefined && typeof event.memo !== 'string')
    );

  if (invalid) {
    throw Error(
      '일정 기록 형식을 확인해주세요. 기존 기록을 덮어쓰지 않았습니다.'
    );
  }

  return events;
}

let eventWrites = Promise.resolve();

function writeEventRecord(action) {
  const write = eventWrites.catch(() => {}).then(action);
  eventWrites = write;
  return write;
}

export const waitForEventWrites = () => eventWrites.catch(() => {});

const normalizeEventEnd = value => value === '24:00' ? value : normalizeTime(value);

export function eventEndDate(event) {
  if (event.end === '24:00') return new Date(`${shiftDate(event.date, 1)}T00:00:00`);
  const day = event.end < event.start ? shiftDate(event.date, 1) : event.date;
  return new Date(`${day}T${event.end}:00`);
}

export function eventTimeCaption(event) {
  return event.start && event.end
    ? `${event.start}~${event.end < event.start ? '다음 날 ' : ''}${event.end}`
    : '';
}

export function eventTitle(event) {
  if (event.category) return routineLabel(event);
  // 직접 입력한 상황 일정은 입력한 이름을 보여줍니다.
  return event.types.map(type => type === 'other' && event.title ? event.title : eventLabel(type)).join(' · ');
}

export const saveEvent = input => writeEventRecord(async () => {
  if (!validDate(input.date)) {
    throw Error('날짜를 YYYY-MM-DD 형식으로 입력해주세요.');
  }

  const timed = Boolean(input.category);
  const timing = {};
  if (timed) {
    if (!INDUSTRIES.some(([id]) => id === input.category)) throw Error('일과 종류를 선택해주세요.');
    const start = normalizeTime(input.start);
    const end = normalizeEventEnd(input.end);
    if (!start || !end) throw Error('시작과 종료 시간을 09:30처럼 입력해주세요.');
    if (start === end) throw Error('시작 시간과 종료 시간을 다르게 설정해주세요.');
    const title = String(input.title || '').trim();
    if (input.category === 'other' && (!title || title.length > ROUTINE_TITLE_LIMIT)) {
      throw Error(`일정 이름을 ${ROUTINE_TITLE_LIMIT}자 이내로 입력하거나 아래 항목을 골라주세요.`);
    }
    Object.assign(timing, { category: input.category, start, end, title: input.category === 'other' ? title : '' });
  }

  const types = timed ? [] : [...new Set(input.types || [])].filter(type =>
    EVENT_OPTIONS.some(([value]) => value === type)
  );

  if (!timed && !types.length) {
    throw Error('일정 종류를 선택해주세요.');
  }

  // 상황 일정의 시간(선택): 둘 다 비우면 하루 종일, 하나라도 쓰면 둘 다 올바라야 합니다.
  let situationTime = null;
  if (!timed && (input.start || input.end)) {
    const start = normalizeTime(input.start || '');
    const end = normalizeEventEnd(input.end || '');
    if (!start || !end) throw Error('시작과 종료 시간을 09:30처럼 입력해주세요.');
    if (start === end) throw Error('시작 시간과 종료 시간을 다르게 설정해주세요.');
    situationTime = { start, end };
  }
  const situationTitle = String(input.title || '').trim().slice(0, ROUTINE_TITLE_LIMIT);
  if (!timed && types.includes('other') && !situationTitle && !String(input.memo || '').trim()) {
    throw Error('일정 이름을 직접 입력해주세요.');
  }

  // 서버 모드에서도 방금 불러와 기기에 복사해 둔 목록을 기준으로 합니다 (복사본의 이상한 줄 때문에 막히지 않게 느슨하게 읽음).
  const events = await readEventsForWrite();
  const old = input.id
    ? events.find(event => event.id === input.id)
    : null;

  if (input.id && !old) {
    throw Error('이미 삭제된 일정입니다. 다시 불러와주세요.');
  }

  const now = new Date().toISOString();

  const event = {
    ...old,
    ...timing,
    id:
      old?.id ||
      Date.now() + '-' + Math.random().toString(36).slice(2, 10),
    date: input.date,
    types,
    memo: String(input.memo ?? old?.memo ?? '').trim().slice(0, 80),
    createdAt: old?.createdAt || now,
    updatedAt: now,
  };
  if (!timed) {
    delete event.start;
    delete event.end;
    delete event.title;
    if (situationTime) Object.assign(event, situationTime);
    if (types.includes('other') && situationTitle) event.title = situationTitle;
  }

  if (SERVER_MODE) {
    const body = eventToServer(event);
    if (old) {
      await api.updateSchedule(old.id, body);
    } else {
      const created = await api.createSchedule(body);
      if (created?.scheduleId == null) throw Error('일정은 저장됐지만 번호를 받지 못했어요. 목록을 다시 불러와주세요.');
      event.id = String(created.scheduleId);
    }
  }

  await writeJson(EVENTS_KEY, [
    event,
    ...events.filter(item => item.id !== event.id),
  ]);

  return event;
});

export const deleteEvent = id => writeEventRecord(async () => {
  if (SERVER_MODE) {
    try {
      await api.deleteSchedule(id);
    } catch (error) {
      // 이미 서버에서 지워진 일정이면 기기 목록에서만 지웁니다.
      if (error?.status !== 404) throw error;
    }
  }
  // 서버 삭제가 성공했으면 성공이다. 기기 복사본은 이상한 줄이 있어도 이 일정만 빼고 정리한다 (2026-11-24)
  const events = await readEventsForWrite();

  await writeJson(
    EVENTS_KEY,
    events.filter(event => event.id !== id)
  );
});

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

const EVENT_BENEFITS = {
  hospital: ['medical', '오늘 병원 방문'],
  team_dinner: ['restaurant', '오늘 회식·모임'],
  night_snack: ['delivery', '오늘 야식·배달'],
  travel: ['transport', '오늘 외출·여행'],
  shopping: ['shopping', '오늘 쇼핑·장보기'],
  refuel: ['fuel', '오늘 주유·충전'],
};

// 상황 종류가 카드 추천에서 어떤 업종 혜택으로 반영되는지(없으면 null)
export function eventTypeBenefitLabel(type) {
  const id = EVENT_BENEFITS[type]?.[0];
  return id ? categoryLabel(id) : null;
}

// 직접 입력한 이름(장소 일정의 직접 입력, 일정 추가 창의 직접 입력 모두): 기본 업종과 맞으면 그 업종으로,
// 아니면 입력한 말 그대로 혜택을 찾습니다 (utils/eventCategoryCore.js).
export function eventBenefitCategories(event) {
  return eventCategoryIds(event, { typed: typedCategoryIds, byType: type => EVENT_BENEFITS[type]?.[0] });
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
  const weekday = new Date(day + 'T12:00:00').getDay();
  const { lunchSchedule, coffeeSchedule } = normalizeProfile(profile);
  const occursOnDay = schedule => !schedule.days.length || schedule.days.includes(weekday);
  const withTime = (reason, schedule) => schedule.hours.length
    ? `${reason} · ${schedule.hours.map(hour => `${hour}시`).join(', ')}`
    : reason;

  if (occursOnDay(coffeeSchedule)) {
    if (profile?.coffee === 'always') add('cafe', 3, withTime('평소 커피를 거의 매일 마심', coffeeSchedule));
    if (profile?.coffee === 'sometimes') add('cafe', 1, withTime('가끔 커피를 마심', coffeeSchedule));
  }

  if (!off) {
    if (occursOnDay(lunchSchedule)) {
      if (profile?.lunchPlace === 'restaurant') add('restaurant', 2, withTime('점심을 근처 음식점에서 먹음', lunchSchedule));
      if (profile?.lunchPlace === 'convenience') add('convenience', 2, withTime('점심에 편의점을 이용함', lunchSchedule));
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

  today.forEach(event => {
    if (event.category) {
      eventBenefitCategories(event).forEach(category => add(category, 4, `특별 일정 · ${eventTitle(event)} ${eventTimeCaption(event)}`.trim()));
      return;
    }
    event.types.forEach(type => {
      const match = EVENT_BENEFITS[type];

      if (match) {
        add(match[0], 4, match[1]);
      }
    });
  });

  detailSignals(effectiveDetailedRoutine(profile), day).forEach(signal => add(signal.id, signal.weight, signal.reason));
  return [...found.values()];
}
// DETAILED_ROUTINE_DATA_V1
export async function saveDetailedRoutine(rows) {
  const detailedRoutine = validateDetails(rows);
  const profile = await readProfile();

  const next = {
    ...profile,
    detailedRoutine,
    version: 2,
    updatedAt: new Date().toISOString(),
  };

  await writeJson(ROUTINE_KEY, next);
  return next;
}
