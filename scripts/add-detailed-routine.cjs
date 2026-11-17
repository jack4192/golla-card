const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');

const read = name =>
  fs.readFileSync(path.join(root, name), 'utf8')
    .replace(/\r\n/g, '\n');

const parse = code =>
  babel.parseSync(code, {
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['jsx'] },
  });

const replaceOnce = (source, target, value) => {
  if (source.split(target).length !== 2) {
    throw Error(
      '연결 위치 확인 실패: ' + target +
      ' (기존 파일 변경 없음)'
    );
  }

  return source.replace(target, value);
};

const current = read('screens/DailyRoutineScreen.js');
const installed = current.includes('DETAILED_ROUTINE_FLOW_V1');

let basic = installed
  ? read('screens/DailyRoutineQuestionsScreen.js')
  : current;

if (
  !basic.includes('onContinue') ||
  !basic.includes('saveProfile')
) {
  throw Error('기존 생활 패턴 화면 버전을 확인해주세요.');
}

basic = basic.replace(
  '저장하고 맞춤 카드 보기',
  '저장하고 상세 일과 설정'
);

let data = read('utils/routineData.js');

if (!data.includes('DETAILED_ROUTINE_DATA_V1')) {
  data =
    "import {DETAIL_CATEGORIES,detailSignals,validateDetails} from './routineDetails';\n" +
    data;

  data = replaceOnce(
    data,
    'export const CATEGORIES = {',
    'export const CATEGORIES = {\n  ...DETAIL_CATEGORIES,'
  );

  data = replaceOnce(
    data,
    '  return [...found.values()];',
    '  detailSignals(profile?.detailedRoutine, day).forEach(signal => add(signal.id, signal.weight, signal.reason));\n  return [...found.values()];'
  );

  data += `
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
`;
}

const files = {
  'screens/DailyRoutineQuestionsScreen.js': basic,

  'utils/routineData.js': data,

  'utils/routineDetails.js': String.raw`
export const INDUSTRIES = [
  ['cafe', '☕ 카페'],
  ['restaurant', '🍽 음식점'],
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
];

export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

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

    const start = normalizeTime(row.start);
    const end = normalizeTime(row.end);

    if (!start || !end) {
      fail('시간을 00:00~23:59로 입력해주세요. 예: 09:30');
    }

    const minutes = time =>
      +time.slice(0, 2) * 60 + +time.slice(3);

    const duration =
      minutes(end) -
      minutes(start) +
      (row.nextDay === true ? 1440 : 0);

    if (duration <= 0 || duration >= 1440) {
      fail(
        '종료 시간을 확인해주세요. 자정을 넘으면 ‘다음 날 종료’를 선택하세요.'
      );
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
      start,
      end,
      nextDay: row.nextDay === true,
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
    .filter(row => row.days.includes(weekday))
    .map(row => {
      const label = INDUSTRIES.find(
        ([id]) => id === row.category
      )[1];

      const weekly =
        row.unit === 'week'
          ? row.count
          : row.count * 7 / 30;

      return {
        id: row.category,
        weight: Math.min(4, 1 + Math.floor(weekly / 2)),
        reason:
          '직접 설정: ' +
          label +
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
`,

  'screens/DetailedRoutineScreen.js': String.raw`
import React, {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  readProfile,
  saveDetailedRoutine,
} from '../utils/routineData';

import {
  DAYS,
  INDUSTRIES,
  normalizeTime,
  validateDetails,
} from '../utils/routineDetails';

export default function DetailedRoutineScreen({
  initialDraft = null,
  onDraftChange = () => {},
  onSaved = () => {},
  onBack,
  onContinue,
  readOnly = false,
}) {
  const [rows, setRows] = useState(initialDraft || []);
  const [open, setOpen] = useState(false);

  const [loading, setLoading] = useState(
    initialDraft === null
  );

  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const lock = useRef(false);
  const alive = useRef(true);
  const sequence = useRef(0);

  useEffect(() => {
    alive.current = true;
    let current = true;

    if (initialDraft === null || reload > 0) {
      setLoading(true);
      setLoadError('');

      readProfile()
        .then(profile => {
          const value = validateDetails(
            profile.detailedRoutine || []
          );

          if (current) {
            setRows(value);
            onDraftChange(value);
          }
        })
        .catch(problem => {
          if (current) {
            setLoadError(
              problem.message ||
              '이전 일과를 읽지 못했습니다.'
            );
          }
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    }

    return () => {
      current = false;
      alive.current = false;
    };
  }, [reload]);

  const blocked =
    readOnly || saving || loading || !!loadError;

  const update = next => {
    if (blocked || lock.current) return;

    setRows(next);
    onDraftChange(next);
    setError('');
  };

  const change = (id, patch) => {
    update(
      rows.map(row =>
        row.id === id ? { ...row, ...patch } : row
      )
    );
  };

  const add = category => {
    if (rows.length >= 20) {
      setError('상세 일과는 최대 20개까지 등록할 수 있습니다.');
      return;
    }

    update([
      ...rows,
      {
        id:
          'routine_' +
          Date.now() +
          '_' +
          (++sequence.current),
        category,
        start: '',
        end: '',
        nextDay: false,
        days: [],
        unit: 'week',
        count: '',
      },
    ]);
  };

  const save = async () => {
    if (blocked || lock.current) return;

    let valid;

    try {
      valid = validateDetails(rows);
    } catch (problem) {
      setError(problem.message);
      return;
    }

    lock.current = true;
    setSaving(true);
    setError('');

    try {
      const profile = await saveDetailedRoutine(valid);

      if (!alive.current) return;

      setRows(valid);
      onDraftChange(valid);
      onSaved(profile);

      if (typeof onContinue !== 'function') {
        throw Error('다음 화면 연결을 확인해주세요.');
      }

      await onContinue();
    } catch (problem) {
      if (alive.current) {
        setError(
          problem.message ||
          '저장하지 못했습니다. 다시 시도해주세요.'
        );
      }
    } finally {
      lock.current = false;

      if (alive.current) {
        setSaving(false);
      }
    }
  };

  const button = (
    label,
    onPress,
    selected = false,
    disabled = blocked
  ) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        s.chip,
        selected && s.checked,
        disabled && s.dim,
      ]}
    >
      <Text style={[s.text, selected && s.blue]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={
        Platform.OS === 'ios' ? 'padding' : undefined
      }
    >
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.body}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.blue}>
          SOL Pay · 상세 일과 설정
        </Text>

        <Text style={s.title}>
          자주 가는 곳과 시간을{'\n'}알려주세요
        </Text>

        <Text style={s.hint}>
          선택한 업종과 시간·요일·빈도를 맞춤 추천에 참고합니다.
          구체적인 장소나 개인정보는 입력하지 않아도 됩니다.
        </Text>

        {loading && (
          <ActivityIndicator color="#245DE5" />
        )}

        {!!loadError && (
          <View style={s.card}>
            <Text style={s.error}>{loadError}</Text>

            {button(
              '다시 불러오기',
              () => setReload(n => n + 1),
              false,
              loading
            )}
          </View>
        )}

        <View style={s.card}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="업종 선택"
            accessibilityState={{
              expanded: open,
              disabled: blocked,
            }}
            disabled={blocked}
            onPress={() => setOpen(value => !value)}
            style={s.accordion}
          >
            <Text style={s.name}>
              업종 선택 · {rows.length}개 일과
            </Text>

            <Text style={s.blue}>
              {open ? '접기 ▲' : '펼치기 ▼'}
            </Text>
          </TouchableOpacity>

          {open && (
            <View style={s.wrap}>
              {INDUSTRIES.map(([id, label]) => {
                const selected = rows.some(
                  row => row.category === id
                );

                return (
                  <View key={id}>
                    {button(
                      label + (selected ? ' ✓' : ''),
                      () => {
                        if (!selected) add(id);
                      },
                      selected
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {!rows.length && !loading && (
          <Text style={s.hint}>
            업종 선택을 펼쳐 카페, 음식점, PC방 등을 골라주세요.
            입력 없이 넘어가려면 아래 버튼을 누르세요.
          </Text>
        )}

        {rows.map((row, index) => (
          <View key={row.id} style={s.card}>
            <View style={s.between}>
              <Text style={s.name}>
                {index + 1}.{' '}
                {INDUSTRIES.find(
                  ([id]) => id === row.category
                )?.[1] || '업종 확인 필요'}
              </Text>

              {button(
                '삭제',
                () =>
                  update(
                    rows.filter(
                      item => item.id !== row.id
                    )
                  )
              )}
            </View>

            <Text style={s.label}>
              이용 시간 · 직접 입력
            </Text>

            <View style={s.timeRow}>
              {[
                ['start', '시작', '09:00'],
                ['end', '종료', '10:00'],
              ].map(([key, label, placeholder]) => (
                <View key={key} style={s.timeCell}>
                  <Text style={s.hint}>{label}</Text>

                  <TextInput
                    accessibilityLabel={
                      (index + 1) +
                      '번째 일과 ' +
                      label +
                      ' 시간'
                    }
                    value={row[key]}
                    editable={!blocked}
                    placeholder={placeholder}
                    placeholderTextColor="#8B98AC"
                    maxLength={5}
                    keyboardType={
                      Platform.OS === 'ios'
                        ? 'numbers-and-punctuation'
                        : 'default'
                    }
                    autoCorrect={false}
                    autoCapitalize="none"
                    onChangeText={value =>
                      change(row.id, {
                        [key]: value
                          .replace(/[^\d:]/g, '')
                          .slice(0, 5),
                      })
                    }
                    onBlur={() => {
                      const time = normalizeTime(
                        row[key]
                      );

                      if (time) {
                        change(row.id, {
                          [key]: time,
                        });
                      }
                    }}
                    style={s.input}
                  />
                </View>
              ))}
            </View>

            <Text style={s.hint}>
              24시간 형식입니다. 930 또는 09:30 입력 가능
            </Text>

            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: row.nextDay,
                disabled: blocked,
              }}
              disabled={blocked}
              onPress={() =>
                change(row.id, {
                  nextDay: !row.nextDay,
                })
              }
              style={s.checkbox}
            >
              <Text style={s.text}>
                {row.nextDay ? '☑' : '☐'} 다음 날 종료
                · 예: 23:00 → 02:00
              </Text>
            </TouchableOpacity>

            <Text style={s.label}>
              이용 요일 · 여러 개 선택
            </Text>

            <View style={s.wrap}>
              {DAYS.map((day, value) => (
                <TouchableOpacity
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={day + '요일'}
                  accessibilityState={{
                    checked: row.days.includes(value),
                    disabled: blocked,
                  }}
                  disabled={blocked}
                  onPress={() =>
                    change(row.id, {
                      days: row.days.includes(value)
                        ? row.days.filter(
                            d => d !== value
                          )
                        : [...row.days, value],
                    })
                  }
                  style={[
                    s.chip,
                    row.days.includes(value) &&
                      s.checked,
                  ]}
                >
                  <Text style={s.text}>{day}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.label}>이용 빈도</Text>

            <View style={s.wrap}>
              {button(
                '주',
                () =>
                  change(row.id, {
                    unit: 'week',
                  }),
                row.unit === 'week'
              )}

              {button(
                '월',
                () =>
                  change(row.id, {
                    unit: 'month',
                  }),
                row.unit === 'month'
              )}

              <TextInput
                accessibilityLabel={
                  (index + 1) +
                  '번째 일과 이용 횟수'
                }
                value={String(row.count)}
                placeholder="횟수"
                keyboardType="number-pad"
                maxLength={2}
                editable={!blocked}
                onChangeText={value =>
                  change(row.id, {
                    count: value.replace(/\D/g, ''),
                  })
                }
                style={[s.input, s.count]}
              />

              <Text style={s.text}>회 이용</Text>
            </View>

            {button(
              '+ 같은 업종의 다른 시간 추가',
              () => add(row.category)
            )}
          </View>
        ))}

        <Text style={s.hint}>
          요일은 이용을 시작하는 날 기준입니다.
          입력한 내용은 이 기기에 저장되며,
          일과 설정에서 다시 변경할 수 있습니다.
        </Text>
      </ScrollView>

      <View style={s.footer}>
        {!!error && (
          <Text
            style={s.error}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        )}

        <View style={s.footerRow}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={saving || loading || readOnly}
            onPress={() => {
              if (!lock.current) onBack?.();
            }}
            style={[
              s.back,
              (saving || loading || readOnly) &&
                s.dim,
            ]}
          >
            <Text style={s.blue}>이전</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            disabled={blocked}
            onPress={save}
            style={[
              s.primary,
              blocked && s.dim,
            ]}
          >
            {saving ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={s.white}>
                {rows.length
                  ? '저장하고 맞춤 카드 보기'
                  : '추가 입력 없이 계속'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8FC',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  body: {
    padding: 20,
    paddingTop: 30,
    paddingBottom: 30,
    gap: 16,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  title: {
    fontSize: 27,
    lineHeight: 37,
    fontWeight: '800',
    color: '#152B50',
  },
  hint: {
    fontSize: 12,
    lineHeight: 21,
    color: '#77859B',
  },
  blue: {
    fontSize: 13,
    color: '#245DE5',
    fontWeight: '700',
  },
  card: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#FFF',
    gap: 14,
  },
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: 10,
  },
  name: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '800',
    color: '#213D63',
    flexShrink: 1,
  },
  text: {
    fontSize: 13,
    lineHeight: 20,
    color: '#365175',
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#213D63',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#DFE6F2',
    borderRadius: 12,
    backgroundColor: '#F8FAFE',
    minHeight: 44,
  },
  checked: {
    borderColor: '#245DE5',
    backgroundColor: '#EAF1FF',
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeCell: {
    flex: 1,
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D5DFEE',
    borderRadius: 12,
    padding: 13,
    fontSize: 16,
    color: '#213D63',
    backgroundColor: '#FFF',
    minHeight: 48,
  },
  count: {
    width: 75,
  },
  checkbox: {
    paddingVertical: 10,
  },
  footer: {
    flexShrink: 0,
    padding: 16,
    paddingBottom: 30,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderColor: '#E3EAF5',
    gap: 10,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  back: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#EDF3FF',
    justifyContent: 'center',
  },
  primary: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#245DE5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  white: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFF',
  },
  error: {
    fontSize: 13,
    lineHeight: 21,
    color: '#B6364E',
  },
  dim: {
    opacity: 0.4,
  },
});
`,

  'screens/DailyRoutineScreen.js': String.raw`
import React, { useState } from 'react';

import DailyRoutineQuestionsScreen
  from './DailyRoutineQuestionsScreen';

import DetailedRoutineScreen
  from './DetailedRoutineScreen';

// DETAILED_ROUTINE_FLOW_V1
export default function DailyRoutineScreen(props) {
  const [step, setStep] = useState('basic');

  const [basic, setBasic] = useState(
    props.initialDraft ?? null
  );

  const [details, setDetails] = useState(null);

  const remember = profile => {
    setBasic(profile);
    props.onDraftChange?.(profile);
  };

  if (step === 'details') {
    return (
      <DetailedRoutineScreen
        initialDraft={details}
        onDraftChange={setDetails}
        readOnly={props.readOnly}
        onSaved={remember}
        onBack={() => setStep('basic')}
        onContinue={props.onContinue}
      />
    );
  }

  return (
    <DailyRoutineQuestionsScreen
      {...props}
      initialDraft={basic}
      onDraftChange={remember}
      onContinue={() => setStep('details')}
    />
  );
}
`,
};

for (const content of Object.values(files)) {
  parse(content);
}

for (const [name, content] of Object.entries(files)) {
  const target = path.join(root, name);
  const backup = target + '.before-detailed-routine.bak';

  fs.mkdirSync(path.dirname(target), {
    recursive: true,
  });

  if (
    fs.existsSync(target) &&
    !fs.existsSync(backup)
  ) {
    fs.copyFileSync(target, backup);
  }

  fs.writeFileSync(target, content, 'utf8');
}

console.log(
  '완료: 생활 패턴 분석 → 상세 일과 설정 → 맞춤 카드 추천'
);

console.log(
  'App.js 변경 없음. 기존 파일은 .before-detailed-routine.bak으로 백업했습니다.'
);