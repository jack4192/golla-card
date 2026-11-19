
export const INDUSTRIES = [
  ['cafe', '☕ 커피'],
  ['restaurant', '🍽 식사'],
  ['pcroom', '🎮 PC방'],
  ['travel', '✈️ 여행·숙박'],
  ['train', '🚆 기차'],
  ['intercity', '🚌 시외·고속버스'],
  ['transport', '🚇 버스·지하철'],
  ['taxi', '🚕 택시'],
  ['convenience', '🏪 편의점'],
  ['delivery', '🛵 배달'],
  ['fuel', '⛽ 주유·충전'],
  ['shopping', '🛍 쇼핑'],
  ['medical', '🏥 병원·약국'],
  ['other', '✏️ 기타'],
];

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const ROUTINE_TITLE_LIMIT = 40;

export function routineLabel(row) {
  if (row.category === 'other' && row.title) return row.title;
  return INDUSTRIES.find(([id]) => id === row.category)?.[1] || '업종 확인 필요';
}

export const DETAIL_CATEGORIES = {
  pcroom: {
    label: 'PC방',
    words: ['PC방', 'pc방', '피시방'],
  },
  travel: {
    label: '여행·숙박',
    words: ['여행', '항공', '숙박', '호텔'],
  },
  train: {
    label: '기차',
    words: ['기차', '철도', 'KTX', 'SRT'],
  },
  intercity: {
    label: '시외·고속버스',
    words: ['시외버스', '고속버스'],
  },
  taxi: {
    label: '택시',
    words: ['택시'],
  },
};

export function normalizeTime(value) {
  const match = String(value)
    .trim()
    .match(/^(\d{1,2}):?(\d{2})$/);

  if (
    !match ||
    +match[1] > 23 ||
    +match[2] > 59
  ) {
    return null;
  }

  return match[1].padStart(2, '0') + ':' + match[2];
}

export function validateDetails(rows) {
  if (!Array.isArray(rows) || rows.length > 20) {
    throw Error('상세 일과는 최대 20개까지 등록할 수 있습니다.');
  }

  const ids = new Set();

  return rows.map((row, index) => {
    const fail = text => {
      throw Error((index + 1) + '번째 일과: ' + text);
    };

    if (
      !row ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id)
    ) {
      fail('일과 식별자를 확인해주세요.');
    }

    ids.add(row.id);

    if (!INDUSTRIES.some(([id]) => id === row.category)) {
      fail('업종을 선택해주세요.');
    }

    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (row.category === 'other' && (!title || title.length > ROUTINE_TITLE_LIMIT)) {
      fail('기타 일과 제목을 1~' + ROUTINE_TITLE_LIMIT + '자로 입력해주세요.');
    }

    const start = normalizeTime(row.start);
    const end = normalizeTime(row.end);

    if (!start || !end) {
      fail('시간을 00:00~23:59로 입력해주세요. 예: 09:30');
    }

    if (start === end) {
      fail('시작 시간과 종료 시간을 다르게 입력해주세요.');
    }

    if (
      !Array.isArray(row.days) ||
      !row.days.length ||
      row.days.some(
        day => !Number.isInteger(day) || day < 0 || day > 6
      )
    ) {
      fail('이용 요일을 선택해주세요.');
    }

    if (
      !['week', 'month'].includes(row.unit) ||
      !/^[1-9]\d?$/.test(String(row.count))
    ) {
      fail('이용 횟수를 1~99회로 입력해주세요.');
    }

    return {
      id: row.id,
      category: row.category,
      ...(row.category === 'other' ? { title } : {}),
      start,
      end,
      nextDay: end < start,
      days: [...new Set(row.days)].sort((a, b) => a - b),
      unit: row.unit,
      count: Number(row.count),
    };
  });
}

export function detailSignals(rows, day) {
  let valid;

  try {
    valid = validateDetails(rows || []);
  } catch {
    return [];
  }

  const weekday = new Date(day + 'T12:00:00').getDay();

  return valid
    .filter(row => row.category !== 'other' && row.days.includes(weekday))
    .map(row => {
      const weekly =
        row.unit === 'week'
          ? row.count
          : row.count * 7 / 30;

      return {
        id: row.category,
        weight: Math.min(4, 1 + Math.floor(weekly / 2)),
        reason:
          '직접 설정: ' +
          routineLabel(row) +
          ' ' +
          row.start +
          '~' +
          (row.nextDay ? '다음 날 ' : '') +
          row.end +
          ' · ' +
          (row.unit === 'week' ? '주' : '월') +
          ' ' +
          row.count +
          '회',
      };
    });
}
