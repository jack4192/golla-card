import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DemoStore from '../utils/demoStore';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';

// SOL페이 시연용 카드 추천
// GPS, 실제 금융기관 API, 실제 보유 카드 조회는 사용하지 않습니다.

const TODAY_KEY = 'solpay_today_card_plan_v1';
const ROUTINE_KEY = 'solpay_routine_profile_v1';
const EXCEPTIONS_KEY = 'solpay_routine_exceptions_v1';
const WEB_ROUTINE_PREFIX = 'solpay_demo_';

// ============================================
// 일정과 카드 혜택 키워드
// ============================================

const ACTIVITIES = [{
  id: 'coffee',
  label: '☕ 카페',
  words: ['카페', '커피', '스타벅스', '이디야', '투썸', '폴바셋']
}, {
  id: 'lunch',
  label: '🍚 외식·점심',
  words: ['음식점', '외식', '식당', '한식', '일식', '양식', '중식', '레스토랑']
}, {
  id: 'convenience',
  label: '🏪 편의점',
  words: ['편의점', 'CU', 'GS25', '세븐일레븐']
}, {
  id: 'delivery',
  label: '🛵 배달·야식',
  words: ['배달', '요기요', '배달의민족', '쿠팡이츠']
}, {
  id: 'hospital',
  label: '🏥 병원',
  words: ['병원', '의원', '약국', '의료', '치과', '한의원']
}, {
  id: 'dinner',
  label: '🍽️ 회식·저녁',
  words: ['음식점', '외식', '식당', '한식', '일식', '양식', '중식', '레스토랑']
}, {
  id: 'commute',
  label: '🚌 대중교통',
  words: ['대중교통', '버스', '지하철', '교통']
}, {
  id: 'gas',
  label: '⛽ 주유',
  words: ['주유', 'GS칼텍스', 'SK에너지', 'S-OIL']
}, {
  id: 'shopping',
  label: '🛍️ 쇼핑',
  words: ['쇼핑', '백화점', '온라인몰', '쿠팡', '마트']
}, {
  id: 'home',
  label: '🏠 바로 귀가',
  words: []
}];
const ACTIVITY_BY_ID = Object.fromEntries(ACTIVITIES.map(activity => [activity.id, activity]));

// ============================================
// 오늘 날짜
// ============================================

function localDateKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return date.getFullYear() + '-' + month + '-' + day;
}

// ============================================
// 기존 일상 루틴과 특별 일정 불러오기
// ============================================

async function loadRoutineValue(key) {
  let raw;
  if (Platform.OS === 'web') {
    raw = window.localStorage.getItem(WEB_ROUTINE_PREFIX + key);
  } else {
    raw = await DemoStore.getItemAsync(key);
  }
  if (!raw) {
    return null;
  }
  return JSON.parse(raw);
}

// ============================================
// 생활 패턴 분석
// ============================================

function makeSignals(profile, todayEvents, selectedId) {
  const signals = new Map();
  function add(id, weight, source) {
    if (!ACTIVITY_BY_ID[id] || id === 'home') {
      return;
    }
    const current = signals.get(id);
    if (!current) {
      signals.set(id, {
        id,
        weight,
        sources: [source]
      });
    } else {
      current.weight = Math.max(current.weight, weight);
      if (!current.sources.includes(source)) {
        current.sources.push(source);
      }
    }
  }

  // 평소 일과 반영
  if (profile && typeof profile === 'object') {
    if (profile.lunchPlace === 'restaurant') {
      add('lunch', 1, '평소 점심 식사');
    }
    if (profile.lunchPlace === 'convenience') {
      add('convenience', 1, '평소 점심 식사');
    }
    if (profile.coffee === 'always') {
      add('coffee', 2, '평소 커피 습관');
    }
    if (profile.coffee === 'sometimes') {
      add('coffee', 1, '평소 커피 습관');
    }
    if (profile.evening === 'dinner') {
      add('dinner', 1, '평소 저녁 일과');
    }
    if (profile.evening === 'cafe') {
      add('coffee', 1, '평소 저녁 일과');
    }
  }

  // 특별 일정 반영
  const eventMap = {
    hospital: 'hospital',
    team_dinner: 'dinner',
    travel: 'commute'
  };
  for (const event of todayEvents) {
    const types = Array.isArray(event.types) ? event.types : [];
    for (const type of types) {
      if (eventMap[type]) {
        add(eventMap[type], 3, '오늘 등록한 특별 일정');
      }
    }
  }

  // 오늘 바로 귀가하는 경우
  if (selectedId === 'home') {
    return [];
  }

  // 사용자가 직접 선택한 오늘 일정
  if (selectedId) {
    add(selectedId, 4, '오늘 선택한 일정');
  }
  return Array.from(signals.values());
}

// ============================================
// 카드 추천 알고리즘
// ============================================

function recommendCards(signals) {
  if (!signals.length) {
    return [];
  }
  return CSV_CARD_CATALOG.map(card => {
    const matched = [];
    let score = 0;
    for (const signal of signals) {
      const category = ACTIVITY_BY_ID[signal.id];
      const benefit = (card.benefits || []).find(item => {
        const name = String(item.name || '').toLowerCase();
        return category.words.some(word => name.includes(word.toLowerCase()));
      });
      if (!benefit) {
        continue;
      }
      score += signal.weight;
      matched.push({
        activity: category.label,
        source: signal.sources.join(' · '),
        benefit
      });
    }
    return {
      card,
      score,
      matched
    };
  }).filter(item => item.matched.length > 0).sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name, 'ko')).slice(0, 3);
}

// ============================================
// 카드 추천 메인 컴포넌트
// ============================================

export default function TodayBenefitPanel() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [savedId, setSavedId] = useState('');
  const [profile, setProfile] = useState(null);
  const [todayEvents, setTodayEvents] = useState([]);
  const [message, setMessage] = useState('');

  // 화면을 열 때 기존 일과 정보 불러오기
  useEffect(() => {
    let active = true;
    async function restoreData() {
      try {
        const [routine, exceptions, rawToday] = await Promise.all([loadRoutineValue(ROUTINE_KEY), loadRoutineValue(EXCEPTIONS_KEY), DemoStore.getItemAsync(TODAY_KEY)]);
        if (!active) {
          return;
        }
        setProfile(routine);
        setTodayEvents(Array.isArray(exceptions) ? exceptions.filter(event => event.date === localDateKey()) : []);
        const today = rawToday ? JSON.parse(rawToday) : null;
        if (today?.date === localDateKey() && ACTIVITY_BY_ID[today.activityId]) {
          setSelectedId(today.activityId);
          setSavedId(today.activityId);
        } else {
          setSelectedId('');
          setSavedId('');
        }
      } catch {
        if (active) {
          setMessage('이전 일과 정보를 읽지 못했습니다. 새 일정은 선택할 수 있습니다.');
        }
      }
    }
    restoreData();
    return () => {
      active = false;
    };
  }, [visible]);

  // 생활 패턴 분석
  const signals = useMemo(() => makeSignals(profile, todayEvents, selectedId), [profile, todayEvents, selectedId]);

  // 카드 추천 결과
  const results = useMemo(() => recommendCards(signals), [signals]);
  const saved = ACTIVITY_BY_ID[savedId];

  // 오늘 일정 저장
  const saveToday = async () => {
    if (!selectedId || busy) {
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await DemoStore.setItemAsync(TODAY_KEY, JSON.stringify({
        date: localDateKey(),
        activityId: selectedId
      }));
      setSavedId(selectedId);
      setMessage('오늘 일정이 저장되었습니다.');
    } catch {
      setMessage('저장하지 못했습니다. 브라우저 저장 권한을 확인해주세요.');
    } finally {
      setBusy(false);
    }
  };
  return <>
      {/* 메인 카드 추천 배너 */}
      <View style={styles.banner}>
        <View style={{
        flex: 1
      }}>
          <Text style={styles.bannerTitle}>
            ✨ 나를 위한 카드 추천
          </Text>

          <Text style={styles.bannerSubtitle}>
            {saved ? `오늘 선택한 일정: ${saved.label}` : '평소 일과와 오늘 일정으로 혜택을 비교해요.'}
          </Text>
        </View>

        <TouchableOpacity style={styles.primarySmall} onPress={() => {
        setMessage('');
        setVisible(true);
      }}>
          <Text style={styles.primarySmallText}>
            카드 추천
          </Text>
        </TouchableOpacity>
      </View>

      {/* 카드 추천 모달 */}
      <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {/* 제목 */}
              <View style={styles.header}>
                <View style={{
                flex: 1
              }}>
                  <Text style={styles.title}>
                    오늘은 어떤 하루인가요?
                  </Text>

                  <Text style={styles.subtitle}>
                    GPS 없이 평소 일과와 당일 일정을 반영합니다.
                  </Text>
                </View>

                <TouchableOpacity onPress={() => setVisible(false)} style={styles.closeButton}>
                  <Text style={styles.closeText}>
                    ✕
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 일정 선택 */}
              <Text style={styles.sectionTitle}>
                오늘의 일정 선택
              </Text>

              <View style={styles.choices}>
                {ACTIVITIES.map(activity => {
                const chosen = selectedId === activity.id;
                return <TouchableOpacity key={activity.id} style={[styles.choice, chosen && styles.choiceActive]} onPress={() => {
                  setSelectedId(activity.id);
                  setMessage('');
                }} accessibilityRole="button" accessibilityState={{
                  selected: chosen
                }}>
                        <Text style={[styles.choiceText, chosen && styles.choiceTextActive]}>
                          {activity.label}
                        </Text>
                      </TouchableOpacity>;
              })}
              </View>

              <Text style={styles.note}>
                선택하지 않아도 등록된 평소 일과와 오늘 특별 일정으로 추천받을 수 있어요.
              </Text>

              {/* 분석한 생활 패턴 */}
              <View style={styles.summary}>
                <Text style={styles.summaryTitle}>
                  분석에 반영한 생활 패턴
                </Text>

                {signals.length ? signals.map(signal => <Text key={signal.id} style={styles.summaryLine}>
                        •{' '}
                        {ACTIVITY_BY_ID[signal.id].label}
                        {' — '}
                        {signal.sources.join(', ')}
                      </Text>) : <Text style={styles.summaryLine}>
                    {selectedId === 'home' ? '오늘은 바로 귀가하는 날이므로 소비를 권하지 않습니다.' : '아직 연결할 소비 일정이 없습니다. 오늘 일정 또는 평소 일과를 등록해주세요.'}
                  </Text>}
              </View>

              {/* 카드 추천 */}
              <Text style={styles.sectionTitle}>
                맞춤 카드 혜택 후보
              </Text>

              <Text style={styles.note}>
                기존 신한·국민 카드 22종의 상품 혜택과 연결합니다. 실제 보유 카드나 전월 실적은 조회하지 않습니다.
              </Text>

              {results.length ? results.map((result, index) => <View key={String(result.card.id || result.card.code || index)} style={styles.result}>
                      <Text style={styles.rank}>
                        비교 후보{' '}
                        {index + 1}
                        {' · '}
                        {result.card.issuer}
                      </Text>

                      <Text style={styles.cardName}>
                        {result.card.name}
                      </Text>

                      {result.matched.map(({
                activity,
                source,
                benefit
              }, i) => <View key={`${i}-${benefit.name}`} style={styles.benefit}>
                            <Text style={styles.benefitName}>
                              ✓ {activity}
                              {': '}
                              {benefit.name}
                            </Text>

                            <Text style={styles.benefitDetail}>
                              추천 근거:{' '}
                              {source}
                            </Text>

                            <Text style={styles.benefitDetail}>
                              전월 실적 조건:{' '}
                              {Number(benefit.minPrevSpend || 0) > 0 ? `${Number(benefit.minPrevSpend).toLocaleString('ko-KR')}원 이상` : '해당 혜택의 상세 조건 확인 필요'}
                            </Text>

                            {!!benefit.note && <Text style={styles.benefitDetail} numberOfLines={3}>
                                유의사항:{' '}
                                {benefit.note}
                              </Text>}
                          </View>)}
                    </View>) : <View style={styles.empty}>
                  <Text style={styles.emptyText}>
                    연결할 카드 혜택이 없습니다. 다른 일정을 선택해 보세요.
                  </Text>
                </View>}

              <Text style={styles.disclaimer}>
                추천 순서는 일정과 관련된 혜택 범위 기준의 시연용 비교입니다. 실제 할인·발급 자격·최대 절약액을 보증하지 않습니다. 개인정보나 결제 데이터는 서버로 전송하지 않습니다.
              </Text>

              {!!message && <Text style={styles.message}>
                  {message}
                </Text>}

              {/* 오늘 일정 저장 */}
              <TouchableOpacity style={[styles.save, (!selectedId || busy) && styles.disabled]} disabled={!selectedId || busy} onPress={saveToday}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>
                    선택한 오늘 일정 저장
                  </Text>}
              </TouchableOpacity>

              <TouchableOpacity style={styles.cancel} onPress={() => setVisible(false)}>
                <Text style={styles.cancelText}>
                  메인으로 돌아가기
                </Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>;
}

// ============================================
// 디자인
// ============================================

const styles = StyleSheet.create({
  banner: {
    padding: 18,
    backgroundColor: "#EDF3FF",
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#D6E5FC',
    gap: 12,
    borderRadius: 20
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: '#163F86'
  },
  bannerSubtitle: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    color: '#546F9D'
  },
  primarySmall: {
    backgroundColor: "#245DE5",
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  primarySmallText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFFFFF"
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(12,22,43,0.6)',
    padding: 15,
    justifyContent: 'center'
  },
  modal: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 720,
    maxHeight: '90%',
    backgroundColor: "#FFFFFF",
    borderRadius: 26
  },
  content: {
    padding: 24,
    paddingBottom: 24,
    gap: 16
  },
  header: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginBottom: 22
  },
  title: {
    color: "#142D4E",
    fontSize: 25,
    fontWeight: "800",
    lineHeight: 36
  },
  subtitle: {
    fontSize: 14,
    color: "#5A6E89",
    lineHeight: 24,
    marginTop: 8
  },
  closeButton: {
    padding: 5
  },
  closeText: {
    fontSize: 19,
    color: '#687A94'
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: '#223B63',
    marginBottom: 12
  },
  choices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10
  },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D8E2F1',
    minHeight: 44
  },
  choiceActive: {
    borderColor: "#245DE5",
    backgroundColor: "#EDF3FF"
  },
  choiceText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F718F'
  },
  choiceTextActive: {
    color: "#245DE5",
    fontWeight: "800"
  },
  note: {
    color: '#8291A5',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 17
  },
  summary: {
    backgroundColor: '#EFF5FF',
    padding: 15,
    borderRadius: 12,
    marginBottom: 22
  },
  summaryTitle: {
    color: '#244A80',
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 9
  },
  summaryLine: {
    color: '#42658E',
    fontSize: 12,
    lineHeight: 21
  },
  result: {
    borderWidth: 1,
    borderColor: '#DFE9F7',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    backgroundColor: '#FCFDFF'
  },
  rank: {
    color: '#2B62B8',
    fontWeight: '800',
    fontSize: 12
  },
  cardName: {
    color: '#1C3050',
    fontWeight: "800",
    fontSize: 15,
    marginTop: 5,
    marginBottom: 11
  },
  benefit: {
    borderTopWidth: 1,
    borderTopColor: '#EBF0F8',
    paddingTop: 9,
    marginTop: 8
  },
  benefitName: {
    color: '#2D517F',
    fontWeight: '800',
    fontSize: 12,
    lineHeight: 19
  },
  benefitDetail: {
    color: '#77879A',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4
  },
  empty: {
    padding: 18,
    backgroundColor: '#F3F6FA',
    borderRadius: 12
  },
  emptyText: {
    fontSize: 12,
    color: '#7A8799',
    lineHeight: 18
  },
  disclaimer: {
    fontSize: 12,
    color: '#8593A5',
    lineHeight: 17,
    marginTop: 8
  },
  message: {
    color: '#226F50',
    fontWeight: '700',
    marginTop: 12,
    fontSize: 12
  },
  save: {
    backgroundColor: "#245DE5",
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 16,
    borderRadius: 12,
    minHeight: 44
  },
  saveText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800"
  },
  disabled: {
    opacity: 0.5
  },
  cancel: {
    paddingVertical: 15,
    alignItems: 'center',
    minHeight: 44
  },
  cancelText: {
    color: '#72829A',
    fontSize: 12,
    fontWeight: '800'
  }
});
