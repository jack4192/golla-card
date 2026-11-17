
const fs = require('fs');
const path = require('path');

// SOLPay_FIXED/scripts 폴더를 기준으로 실행
const root = path.resolve(__dirname, '..');

const appPath = path.join(root, 'App.js');
const routinePath = path.join(
  root, 'screens', 'DailyRoutineScreen.js'
);
const catalogPath = path.join(
  root, 'data', 'cardCatalogCsv.js'
);

const screenPath = path.join(
  root,
  'screens',
  'RoutineRecommendationScreen.js'
);

// 필수 파일 확인
for (const target of [
  appPath,
  routinePath,
  catalogPath,
]) {
  if (!fs.existsSync(target)) {
    throw new Error(
      '파일을 찾을 수 없습니다: ' + target
    );
  }
}

const before = fs.readFileSync(
  appPath,
  'utf8'
);

// 중복 실행 방지
if (
  before.includes(
    "import RoutineRecommendationScreen from './screens/RoutineRecommendationScreen';"
  )
) {
  console.log(
    '이미 일과 → 추천 화면 연결이 적용되어 있습니다.'
  );
  process.exit(0);
}

// 현재 프로젝트 코드 구조 확인
const checks = [
  "import DailyRoutineScreen from './screens/DailyRoutineScreen';",
  '  const handleRoutineContinue = () => {\n    setCurrentScreen(routineReturnTo);\n  };',
  '      {/* 마이데이터 데모 분석 */}',
  "      {currentScreen === 'Main' && <TodayBenefitPanel />}",
  "  { key: 'DailyRoutine', label: '4. 평소 일과 등록' },",
  "  { key: 'MyDataLoading', label: '5. 데모 분석' },",
  "  { key: 'MyDataResult', label: '6. 분석 결과' },",
  "  { key: 'Main', label: '7. 메인 화면' },",
  "  { key: 'Payment', label: '8. 결제 화면' },",
];

for (const check of checks) {
  if (
    !before.includes(check) ||
    before.indexOf(check) !==
      before.lastIndexOf(check)
  ) {
    throw new Error(
      '현재 App.js 구조가 예상과 다릅니다. 변경하지 않았습니다: ' +
      check.slice(0, 60)
    );
  }
}

// ====================================
// 새로운 맞춤 카드 추천 화면 전체 코드
// ====================================

const screenSource = String.raw`
import React, {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import * as DemoStore from '../utils/demoStore';

import {
  CSV_CARD_CATALOG,
} from '../data/cardCatalogCsv';

// 기존 일상 루틴 및 특별 일정 저장 키
const ROUTINE_KEY =
  'solpay_routine_profile_v1';

const EVENTS_KEY =
  'solpay_routine_exceptions_v1';

const WEB_PREFIX = 'solpay_demo_';

// ====================================
// 카드 혜택 카테고리
// ====================================

const CATEGORIES = {
  cafe: {
    label: '카페·커피',
    words: [
      '카페', '커피', '스타벅스',
      '이디야', '투썸', '폴바셋',
    ],
  },

  restaurant: {
    label: '외식·음식점',
    words: [
      '외식', '음식점', '식당',
      '레스토랑', '패밀리레스토랑',
    ],
  },

  convenience: {
    label: '편의점',
    words: [
      '편의점', 'CU',
      'GS25', '세븐일레븐',
    ],
  },

  medical: {
    label: '병원·약국',
    words: [
      '병원', '의원', '약국',
      '의료', '치과', '한의원',
    ],
  },

  transport: {
    label: '교통·이동',
    words: [
      '대중교통', '버스',
      '지하철', '교통',
    ],
  },
};

// ====================================
// 오늘 날짜
// ====================================

function todayText() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(
      now.getMonth() + 1
    ).padStart(2, '0'),
    String(
      now.getDate()
    ).padStart(2, '0'),
  ].join('-');
}

// ====================================
// 저장된 일상 루틴 불러오기
// ====================================

async function readSaved(key) {
  try {
    const raw =
      Platform.OS === 'web'
        ? window.localStorage.getItem(
            WEB_PREFIX + key
          )
        : await DemoStore.getItemAsync(key);

    return raw
      ? JSON.parse(raw)
      : null;
  } catch {
    return null;
  }
}

// ====================================
// 생활 패턴 분석
// ====================================

function makeSignals(profile, events) {
  const found = new Map();

  const add = (id, weight, reason) => {
    if (!CATEGORIES[id]) return;

    const existing = found.get(id);

    if (existing) {
      existing.weight = Math.max(
        existing.weight,
        weight
      );

      if (
        !existing.reasons.includes(reason)
      ) {
        existing.reasons.push(reason);
      }
    } else {
      found.set(id, {
        id,
        weight,
        reasons: [reason],
      });
    }
  };

  // 평소 일상 루틴
  if (profile?.coffee === 'always') {
    add(
      'cafe',
      3,
      '평소 커피를 거의 매일 마심'
    );
  }

  if (profile?.coffee === 'sometimes') {
    add(
      'cafe',
      1,
      '가끔 커피를 마심'
    );
  }

  if (
    profile?.lunchPlace === 'restaurant'
  ) {
    add(
      'restaurant',
      2,
      '점심을 근처 음식점에서 먹음'
    );
  }

  if (
    profile?.lunchPlace === 'convenience'
  ) {
    add(
      'convenience',
      2,
      '점심에 편의점을 이용함'
    );
  }

  if (profile?.evening === 'dinner') {
    add(
      'restaurant',
      2,
      '일과 후 외식하는 편'
    );
  }

  if (profile?.evening === 'cafe') {
    add(
      'cafe',
      2,
      '일과 후 카페·취미 활동'
    );
  }

  // 기존에 등록된 오늘의 특별 일정
  const today = todayText();

  for (
    const event of
    Array.isArray(events) ? events : []
  ) {
    if (event.date !== today) continue;

    const types = Array.isArray(
      event.types
    )
      ? event.types
      : [];

    if (types.includes('hospital')) {
      add(
        'medical',
        4,
        '오늘 병원 방문 일정'
      );
    }

    if (types.includes('team_dinner')) {
      add(
        'restaurant',
        4,
        '오늘 회식·모임 일정'
      );
    }

    if (types.includes('travel')) {
      add(
        'transport',
        2,
        '오늘 외출·여행 일정'
      );
    }
  }

  return [...found.values()];
}

// ====================================
// 카드 추천 알고리즘
// ====================================

function rankCards(signals) {
  return CSV_CARD_CATALOG
    .map((card) => {
      let score = 0;
      const matches = [];

      for (const signal of signals) {
        const benefit = (
          card.benefits || []
        ).find((item) => {
          const name = String(
            item.name || ''
          ).toLowerCase();

          return CATEGORIES[
            signal.id
          ].words.some((word) =>
            name.includes(
              word.toLowerCase()
            )
          );
        });

        if (!benefit) continue;

        score += signal.weight;

        matches.push({
          label:
            CATEGORIES[signal.id].label,
          reason:
            signal.reasons.join(', '),
          benefit,
        });
      }

      return {
        card,
        score,
        matches,
      };
    })
    .filter(
      (item) => item.score > 0
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(
          a.card.name
        ).localeCompare(
          String(b.card.name),
          'ko'
        )
    )
    .slice(0, 3);
}

// ====================================
// 추천 결과 화면
// ====================================

export default function RoutineRecommendationScreen({
  onNext,
  onBack,
}) {
  const [profile, setProfile] =
    useState(null);

  const [events, setEvents] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [moving, setMoving] =
    useState(false);

  // 화면 진입 시 저장된 일과 분석
  useEffect(() => {
    let active = true;

    Promise.all([
      readSaved(ROUTINE_KEY),
      readSaved(EVENTS_KEY),
    ])
      .then(
        ([savedProfile, savedEvents]) => {
          if (!active) return;

          setProfile(savedProfile);

          setEvents(
            Array.isArray(savedEvents)
              ? savedEvents
              : []
          );
        }
      )
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const signals = useMemo(
    () => makeSignals(
      profile,
      events
    ),
    [profile, events]
  );

  const results = useMemo(
    () => rankCards(signals),
    [signals]
  );

  const goToMain = async () => {
    if (moving) return;

    setMoving(true);

    try {
      await onNext?.();
    } finally {
      setMoving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={
          styles.body
        }
      >
        <Text style={styles.step}>
          SOL Pay · 일상 맞춤 카드 추천
        </Text>

        <Text style={styles.title}>
          일상에 맞는 카드 혜택을
          찾아봤어요 ✨
        </Text>

        <Text style={styles.subtitle}>
          방금 선택한 평소 일과를
          기준으로 기존 카드 상품의
          혜택을 비교했습니다.
          GPS나 계좌·자산 연동 없이
          작동하는 시연용 추천입니다.
        </Text>

        {loading ? (
          <ActivityIndicator
            size="large"
            color="#245DE5"
            style={styles.loader}
          />
        ) : (
          <>
            {/* 분석된 생활 패턴 */}
            <View style={styles.summary}>
              <Text
                style={
                  styles.summaryTitle
                }
              >
                이번 추천에 반영한 정보
              </Text>

              {signals.length ? (
                signals.map(
                  (signal) => (
                    <Text
                      key={signal.id}
                      style={
                        styles.summaryLine
                      }
                    >
                      ✓ {
                        signal.reasons.join(
                          ' · '
                        )
                      }
                    </Text>
                  )
                )
              ) : (
                <Text
                  style={
                    styles.summaryLine
                  }
                >
                  입력한 일과와 직접
                  연결되는 소비 혜택이
                  없습니다. 이전 화면에서
                  일과를 수정할 수 있어요.
                </Text>
              )}
            </View>

            <Text
              style={
                styles.sectionTitle
              }
            >
              추천 카드 후보
            </Text>

            {/* 카드 추천 결과 */}
            {results.length ? (
              results.map(
                (
                  {
                    card,
                    matches,
                  },
                  index
                ) => (
                  <View
                    key={String(
                      card.id ||
                      card.code ||
                      index
                    )}
                    style={
                      styles.card
                    }
                  >
                    <Text
                      style={
                        styles.cardEyebrow
                      }
                    >
                      후보 {index + 1}
                      {' · '}
                      {card.issuer}
                    </Text>

                    <Text
                      style={
                        styles.cardName
                      }
                    >
                      {card.name}
                    </Text>

                    {matches.map(
                      (item, i) => (
                        <View
                          key={i}
                          style={
                            styles.match
                          }
                        >
                          <Text
                            style={
                              styles.benefitTitle
                            }
                          >
                            {item.label}
                            {' · '}
                            {item.benefit.name}
                          </Text>

                          <Text
                            style={
                              styles.reason
                            }
                          >
                            추천 이유:{' '}
                            {item.reason}
                          </Text>

                          <Text
                            style={
                              styles.reason
                            }
                          >
                            전월 이용금액 조건:{' '}
                            {Number(
                              item.benefit
                                .minPrevSpend
                            ) > 0
                              ? Number(
                                  item.benefit
                                    .minPrevSpend
                                ).toLocaleString(
                                  'ko-KR'
                                ) + '원 이상'
                              : '상품별 세부 조건 확인 필요'}
                          </Text>

                          {!!item.benefit
                            .note && (
                            <Text
                              style={
                                styles.note
                              }
                            >
                              유의:{' '}
                              {item.benefit.note}
                            </Text>
                          )}
                        </View>
                      )
                    )}
                  </View>
                )
              )
            ) : (
              <View
                style={
                  styles.empty
                }
              >
                <Text
                  style={
                    styles.emptyText
                  }
                >
                  해당 생활 패턴과
                  직접 일치하는 혜택을
                  찾지 못했습니다.
                  무리하게 카드를 추천하지
                  않고 메인 화면으로
                  안내합니다.
                </Text>
              </View>
            )}

            <Text
              style={
                styles.disclaimer
              }
            >
              생활 패턴과 혜택 이름의
              관련성을 기준으로 고른
              후보입니다. 실제 최적 카드
              순위가 아니며 전월 실적,
              할인 한도, 제외 가맹점 및
              상품 변경 여부를 별도로
              확인해야 합니다.
              실제 카드 보유 여부는
              조회하지 않습니다.
            </Text>
          </>
        )}
      </ScrollView>

      {/* 하단 화면 이동 버튼 */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={
            styles.secondaryButton
          }
          onPress={onBack}
          disabled={moving}
        >
          <Text
            style={
              styles.secondaryText
            }
          >
            일과 다시 수정
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.mainButton,
            (loading || moving) &&
              styles.disabled,
          ]}
          onPress={goToMain}
          disabled={
            loading || moving
          }
        >
          <Text
            style={
              styles.mainText
            }
          >
            {moving
              ? '이동 중...'
              : '확인하고 메인으로'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ====================================
// 화면 스타일
// ====================================

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F8FD',
  },

  body: {
    padding: 20,
    paddingBottom: 35,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },

  step: {
    color: '#245DE5',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 15,
  },

  title: {
    fontSize: 25,
    lineHeight: 35,
    fontWeight: '900',
    color: '#18335E',
    marginTop: 13,
  },

  subtitle: {
    fontSize: 13,
    lineHeight: 22,
    color: '#6A7D98',
    marginTop: 12,
    marginBottom: 22,
  },

  loader: {
    marginTop: 65,
  },

  summary: {
    backgroundColor: '#E9F1FF',
    borderRadius: 15,
    padding: 17,
    marginBottom: 23,
  },

  summaryTitle: {
    color: '#244F91',
    fontWeight: '900',
    fontSize: 14,
    marginBottom: 10,
  },

  summaryLine: {
    color: '#476996',
    fontSize: 12,
    lineHeight: 21,
  },

  sectionTitle: {
    color: '#203D68',
    fontWeight: '900',
    fontSize: 18,
    marginBottom: 12,
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 17,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E8F4',
  },

  cardEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#3470BB',
  },

  cardName: {
    fontSize: 17,
    fontWeight: '900',
    color: '#1F3555',
    marginTop: 6,
  },

  match: {
    marginTop: 13,
    borderTopWidth: 1,
    borderTopColor: '#EDF1F8',
    paddingTop: 10,
  },

  benefitTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#315B90',
  },

  reason: {
    fontSize: 12,
    color: '#657A96',
    lineHeight: 19,
    marginTop: 5,
  },

  note: {
    fontSize: 11,
    color: '#8290A4',
    lineHeight: 18,
    marginTop: 5,
  },

  empty: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
  },

  emptyText: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 21,
  },

  disclaimer: {
    color: '#8A96A8',
    fontSize: 11,
    lineHeight: 18,
    marginTop: 10,
  },

  actions: {
    flexDirection: 'row',
    padding: 15,
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderTopColor: '#E5EAF2',
    borderTopWidth: 1,
  },

  secondaryButton: {
    flex: 1,
    borderRadius: 11,
    paddingVertical: 15,
    backgroundColor: '#EAF1FC',
    alignItems: 'center',
  },

  secondaryText: {
    color: '#315C9D',
    fontWeight: '800',
    fontSize: 12,
  },

  mainButton: {
    flex: 1.5,
    backgroundColor: '#245DE5',
    borderRadius: 11,
    paddingVertical: 15,
    alignItems: 'center',
  },

  mainText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 13,
  },

  disabled: {
    opacity: 0.5,
  },
});
`;

// ====================================
// App.js 연결 수정
// ====================================

let updated = before;

function replaceOnce(
  source,
  oldText,
  newText
) {
  const at = source.indexOf(oldText);

  if (
    at < 0 ||
    source.indexOf(
      oldText,
      at + oldText.length
    ) >= 0
  ) {
    throw new Error(
      'App.js 구조가 달라 수정 중단: ' +
      oldText.slice(0, 45)
    );
  }

  return (
    source.slice(0, at) +
    newText +
    source.slice(
      at + oldText.length
    )
  );
}

// 새 추천 화면 import 추가
updated = replaceOnce(
  updated,
  "import DailyRoutineScreen from './screens/DailyRoutineScreen';",
  "import DailyRoutineScreen from './screens/DailyRoutineScreen';\n" +
  "import RoutineRecommendationScreen from './screens/RoutineRecommendationScreen';"
);

// 기존 메인 추천 버튼 제거
updated = replaceOnce(
  updated,
  "import TodayBenefitPanel from './components/TodayBenefitPanel';\n",
  ''
);

// 개발자 메뉴에 추천 화면 추가
updated = replaceOnce(
  updated,
  "  { key: 'DailyRoutine', label: '4. 평소 일과 등록' },",
  "  { key: 'DailyRoutine', label: '4. 평소 일과 등록' },\n" +
  "  { key: 'RoutineRecommendation', label: '5. 일과 맞춤 카드 추천' },"
);

// 더 이상 자동 흐름에서 사용하지 않는
// 기존 분석 화면은 메뉴에서만 제외
updated = replaceOnce(
  updated,
  "  { key: 'MyDataLoading', label: '5. 데모 분석' },\n",
  ''
);

updated = replaceOnce(
  updated,
  "  { key: 'MyDataResult', label: '6. 분석 결과' },\n",
  ''
);

updated = replaceOnce(
  updated,
  "  { key: 'Main', label: '7. 메인 화면' },",
  "  { key: 'Main', label: '6. 메인 화면' },"
);

updated = replaceOnce(
  updated,
  "  { key: 'Payment', label: '8. 결제 화면' },",
  "  { key: 'Payment', label: '7. 결제 화면' },"
);

// 일과 저장 후 자동 추천 화면 이동
updated = replaceOnce(
  updated,
  '  const handleRoutineContinue = () => {\n    setCurrentScreen(routineReturnTo);\n  };',
  "  const handleRoutineContinue = () => {\n    setCurrentScreen('RoutineRecommendation');\n  };"
);

// 추천 화면 연결
updated = replaceOnce(
  updated,
  '      {/* 마이데이터 데모 분석 */}',
  "      {/* 평소 일과 저장 후 추천 카드 확인 */}\n" +
  "      {currentScreen === 'RoutineRecommendation' && (\n" +
  "        <RoutineRecommendationScreen\n" +
  "          onBack={() => setCurrentScreen('DailyRoutine')}\n" +
  "          onNext={handleFinishDemo}\n" +
  "        />\n" +
  "      )}\n\n" +
  '      {/* 마이데이터 데모 분석 */}'
);

// 메인 상단 추천 버튼 없애기
updated = replaceOnce(
  updated,
  "      {currentScreen === 'Main' && <TodayBenefitPanel />}",
  ''
);

// ====================================
// 백업 후 코드 저장
// ====================================

const stamp = new Date()
  .toISOString()
  .replace(/[:.]/g, '-');

const backupPath = path.join(
  root,
  'App.js.before-routine-recommendation-' +
    stamp +
    '.bak'
);

// App.js 원본 백업
fs.writeFileSync(
  backupPath,
  before,
  'utf8'
);

// 같은 이름의 추천 화면이 있으면 백업
if (fs.existsSync(screenPath)) {
  const oldScreen = fs.readFileSync(
    screenPath,
    'utf8'
  );

  fs.writeFileSync(
    screenPath + '.' + stamp + '.bak',
    oldScreen,
    'utf8'
  );
}

// 새 추천 화면 생성
fs.writeFileSync(
  screenPath,
  screenSource,
  'utf8'
);

// App.js 화면 연결 변경
fs.writeFileSync(
  appPath,
  updated,
  'utf8'
);

console.log(
  '성공! 평소 일과 → 맞춤 카드 추천 → 메인 화면'
);

console.log(
  '백업 파일: ' +
  path.basename(backupPath)
);

console.log(
  '새 화면: screens/RoutineRecommendationScreen.js'
);
