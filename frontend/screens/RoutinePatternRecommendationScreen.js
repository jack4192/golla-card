import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, Image, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { findCatalog40Product } from '../data/cardCatalog40';
import { readEvents, readProfile } from '../utils/routineData';
import { benefitText, emptyPreferences, money, rankRecommendations, readPreferences } from '../utils/cardRecommendation';
import { restoreMyData, subscribeMyData } from '../utils/myDataService';
const PATTERNS = {
  cafe: /카페|커피/,
  convenience: /편의점/,
  restaurant: /음식|외식|식당/,
  transport: /교통|버스|지하철|택시/,
  fuel: /주유|충전/,
  shopping: /쇼핑|마트|백화점|슈퍼|아울렛/,
  medical: /병원|약국|의료/,
  delivery: /배달/,
  education: /교육|학원|서점/
};
const LABELS = {
  cafe: '카페',
  convenience: '편의점',
  restaurant: '음식점',
  transport: '교통',
  fuel: '주유·충전',
  shopping: '쇼핑',
  medical: '병원·약국',
  delivery: '배달',
  education: '교육'
};
export function officialProduct(code) {
  const product = CARD_PRODUCTS[code];
  return product?.image?.uri && /^https:\/\/(www\.shinhancard\.com|card\.kbcard\.com)\//.test(product.url || '') ? product : null;
}
export function recentPattern(data, category) {
  if (!PATTERNS[category] || !data?.endExclusive || !Array.isArray(data.transactions)) {
    return null;
  }
  const end = new Date(data.endExclusive + 'T00:00:00Z');
  if (!Number.isFinite(end.getTime())) {
    return null;
  }
  const start = new Date(end.getTime() - 28 * 86400000).toISOString().slice(0, 10);
  const last = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
  const rows = data.transactions.filter(row => row.date.slice(0, 10) >= start && row.date.slice(0, 10) < data.endExclusive && PATTERNS[category].test(row.category));
  return rows.length ? {
    count: rows.length,
    amount: rows.reduce((sum, row) => sum + row.amount, 0),
    start,
    last
  } : null;
}
export function CardReveal({
  card,
  reduced,
  replay
}) {
  const pop = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const image = findCatalog40Product(card)?.image || officialProduct(card.code)?.image;
  useEffect(() => {
    setFailed(false);
    setLoading(true);
    setRetry(0);
  }, [card.code]);
  useEffect(() => {
    pop.stopAnimation();
    fade.stopAnimation();
    burst.stopAnimation();
    if (failed) {
      pop.setValue(1);
      fade.setValue(1);
      burst.setValue(1);
      return undefined;
    }
    if (reduced === null || loading) {
      pop.setValue(0);
      fade.setValue(0);
      burst.setValue(1);
      return undefined;
    }
    if (reduced) {
      pop.setValue(1);
      fade.setValue(1);
      burst.setValue(1);
      return undefined;
    }
    pop.setValue(0);
    fade.setValue(0);
    burst.setValue(0);
    const native = Platform.OS !== 'web';
    const animation = Animated.parallel([Animated.spring(pop, {
      toValue: 1,
      friction: 5,
      tension: 100,
      useNativeDriver: native
    }), Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: native
    }), Animated.timing(burst, {
      toValue: 1,
      duration: 850,
      useNativeDriver: native
    })]);
    animation.start();
    return () => animation.stop();
  }, [card.code, reduced, replay, loading, failed]);
  return <View style={s.reveal}>
      {!reduced && [0, 1, 2, 3, 4, 5].map(index => {
      const angle = index * Math.PI / 3;
      return <Animated.Text key={index} accessible={false} pointerEvents="none" style={[s.spark, {
        color: index % 2 ? '#92B8FF' : '#F5BF47',
        opacity: burst.interpolate({
          inputRange: [0, 0.2, 0.75, 1],
          outputRange: [0, 1, 1, 0]
        }),
        transform: [{
          translateX: burst.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.cos(angle) * 160]
          })
        }, {
          translateY: burst.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.sin(angle) * 140]
          })
        }, {
          scale: burst.interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1.3]
          })
        }]
      }]}>
              ✦
            </Animated.Text>;
    })}

      <Animated.View style={[s.imageArea, {
      opacity: fade,
      transform: [{
        scale: pop.interpolate({
          inputRange: [0, 1],
          outputRange: [0.72, 1]
        })
      }, {
        translateY: pop.interpolate({
          inputRange: [0, 1],
          outputRange: [32, 0]
        })
      }, {
        rotate: pop.interpolate({
          inputRange: [0, 1],
          outputRange: ['-8deg', '0deg']
        })
      }]
    }]}>
        {image && !failed ? <Image key={card.code + ':' + retry} source={image} accessibilityLabel={card.name + ' 실제 상품 이미지'} style={s.image} resizeMode="contain" fadeDuration={0} onLoad={() => setLoading(false)} onError={() => {
        setLoading(false);
        setFailed(true);
      }} /> : <View style={s.imageError}>
            <Text style={s.body}>
              카드 이미지를 불러오지 못했어요.
            </Text>

            <TouchableOpacity accessibilityRole="button" onPress={() => {
          setRetry(value => value + 1);
          setFailed(false);
          setLoading(true);
        }} style={s.small}>
              <Text style={s.link}>
                공식 이미지 다시 불러오기
              </Text>
            </TouchableOpacity>
          </View>}
      </Animated.View>

      {loading && !failed && <ActivityIndicator style={s.spinner} color="#245DE5" pointerEvents="none" />}

    </View>;
}
export default function RoutineRecommendationScreen({
  onNext,
  onBack
}) {
  const [input, setInput] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState('');
  const [reduced, setReduced] = useState(null);
  const [replay, setReplay] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const mounted = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    mounted.current = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted.current) {
        setReduced(value);
      }
    }).catch(() => {
      if (mounted.current) {
        setReduced(true);
      }
    });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const state = AppState.addEventListener('change', value => {
      if (value === 'active') {
        setNow(new Date());
      }
    });
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => {
      mounted.current = false;
      motion.remove();
      state.remove();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    setNotice('');
    Promise.all([readProfile(), readEvents(), readPreferences(), restoreMyData().catch(() => {
      if (alive) {
        setNotice('마이데이터 기록을 읽지 못해 평소 일과로 추천합니다.');
      }
      return null;
    })]).then(([profile, events, saved, snapshot]) => {
      if (!alive) return;
      setInput({
        profile,
        events,
        saved
      });
      setData(snapshot);
      setIndex(0);
    }).catch(problem => {
      if (alive) {
        setError(problem.message || '추천 정보를 읽지 못했습니다.');
      }
    }).finally(() => {
      if (alive) {
        setLoading(false);
      }
    });
    const off = subscribeMyData(value => {
      if (alive) {
        setData(value);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [reload]);
  const recommendations = useMemo(() => {
    if (!input) return [];

    // 기존에 수기로 입력한 실적·가정 금액은
    // 이 화면의 추천 계산에 사용하지 않습니다.
    const preferences = emptyPreferences();
    preferences.owned = input.saved.owned;
    const rows = rankRecommendations(input.profile, input.events, preferences, now).filter(row => officialProduct(row.card.code));
    const unowned = rows.filter(row => !row.owned);
    return (unowned.length ? unowned : rows).slice(0, 3);
  }, [input, data, now]);
  const selected = recommendations[Math.min(index, Math.max(0, recommendations.length - 1))];
  const match = selected ? [...selected.matches].sort((a, b) => b.weight - a.weight)[0] : null;
  const pattern = match ? recentPattern(data, match.category) : null;
  const card = selected?.card;
  const run = async (name, action) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(name);
    setError('');
    try {
      await action();
    } catch (problem) {
      if (mounted.current) {
        setError(problem.message || '다시 시도해주세요.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy('');
      }
    }
  };
  const continueMain = () => run('next', async () => {
    if (typeof onNext !== 'function') {
      throw Error('메인 화면 이동은 최종 App.js 연결이 필요합니다.');
    }
    await onNext();
  });
  const apply = () => run('apply', async () => {
    const product = officialProduct(card.code);
    if (!product) {
      throw Error('카드사 공식 상품 주소를 확인해주세요.');
    }
    await Linking.openURL(product.url);
  });
  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <TouchableOpacity accessibilityRole="button" disabled={!!busy} onPress={() => onBack?.()} style={s.back}>
          <Text style={s.link}>
            ← 일과 다시 확인
          </Text>
        </TouchableOpacity>

        {loading ? <View style={s.empty}>
            <ActivityIndicator color="#245DE5" size="large" />
            <Text style={s.body}>
              일상에 맞는 카드를 찾고 있어요
            </Text>
          </View> : !card ? <View style={s.empty}>
            <Text style={s.headline}>
              평소 일과를 알려주세요
            </Text>

            <Text style={s.body}>
              {error || '아직 카드와 연결할 일과 정보가 없습니다. 평소 일과를 등록하면 맞는 카드를 추천해드릴게요.'}
            </Text>

            <TouchableOpacity accessibilityRole="button" style={s.primary} onPress={() => onBack?.()}>
              <Text style={s.white}>
                일과 등록하러 가기
              </Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button" style={s.small} onPress={() => setReload(value => value + 1)}>
              <Text style={s.link}>
                다시 불러오기
              </Text>
            </TouchableOpacity>
          </View> : <>
            <Text style={s.eyebrow}>
              당신의 일상에 어울리는 한 장
            </Text>

            <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={s.headline}>
              이 카드를 추천합니다!
            </Text>

            <View style={s.reason}>
              {pattern ? <>
                  <Text style={s.reasonText}>
                    최근 4주 예시 내역에서{' '}
                    <Text style={s.bold}>
                      {LABELS[match.category] || '이 분야'}에서{' '}
                      {pattern.count}번,{' '}
                      {money(pattern.amount)}
                    </Text>
                    {' '}이용하셨어요.
                  </Text>

                  <Text style={s.caption}>
                    {pattern.start} ~ {pattern.last}
                    {' · '}{data.label}
                  </Text>
                </> : <Text style={s.reasonText}>
                  {match?.reasons?.[0] || '등록한 평소 일과와 오늘 일정을 살펴봤어요.'}
                </Text>}

              <Text style={s.body}>
                이런 일상에 어울리는 혜택을 가진 카드예요.
              </Text>
            </View>

            <View style={s.hero}>
              <Text style={s.star}>✦</Text>

              <Text style={s.cardName}>
                {card.name}
              </Text>

              <Text style={s.caption}>
                {card.issuer}
                {' · '}연회비 {money(card.annualFee || 0)}
                {selected.owned ? ' · 이미 보유한 카드' : ''}
              </Text>

              <CardReveal key={card.code} card={card} reduced={reduced} replay={replay} />

              {match && <View style={s.benefitBadge}>
                  <Text style={s.benefitHeadline}>
                    {benefitText(match.benefit)}
                  </Text>

                  <Text style={s.body}>
                    {match.benefit.name}
                  </Text>
                </View>}

              <TouchableOpacity accessibilityRole="button" onPress={() => setDetails(!details)} style={s.small}>
                <Text style={s.link}>
                  {details ? '혜택 조건 접기' : '추천 이유·혜택 조건 확인'}
                </Text>
              </TouchableOpacity>

              {details && <View style={s.details}>
                  {selected.matches.slice(0, 3).map((row, i) => <View key={i} style={s.detailRow}>
                        <Text style={s.bold}>
                          {row.benefit.name}
                          {' · '}
                          {benefitText(row.benefit)}
                        </Text>

                        <Text style={s.caption}>
                          추천 이유:{' '}
                          {row.reasons.join(' · ')}
                        </Text>

                        <Text style={s.caption}>
                          전월 실적{' '}
                          {row.benefit.minPrevSpend == null ? '확인 필요' : money(row.benefit.minPrevSpend) + ' 이상'}

                          {row.benefit.monthlyCap != null ? ' · 월 한도 ' + Number(row.benefit.monthlyCap).toLocaleString('ko-KR') + (['POINT', 'POINT_BONUS'].includes(row.benefit.type) ? 'P' : '원') : ''}
                        </Text>

                        {!!row.benefit.note && <Text style={s.caption}>
                            {row.benefit.note}
                          </Text>}
                      </View>)}

                  <Text style={s.caption}>
                    일과와 혜택 분야의 관련성을 기준으로
                    추천합니다. 실제 할인액·기존 카드 대비
                    추가 이익은 확정하지 않습니다.
                    전월 실적·대상 가맹점·결제 방식·한도 등
                    상품 조건 확인이 필요합니다.
                  </Text>
                </View>}
            </View>

            {recommendations.length > 1 && <View style={s.pager}>
                {recommendations.map((row, i) => <TouchableOpacity key={row.card.code} accessibilityRole="button" accessibilityLabel={i + 1 + '번째 추천: ' + row.card.name} accessibilityState={{
            selected: card.code === row.card.code
          }} onPress={() => {
            setIndex(i);
            setDetails(false);
            setError('');
          }} style={[s.dotButton, card.code === row.card.code && s.dotSelected]}>
                    <Text style={[s.dotText, card.code === row.card.code && s.dotActive]}>
                      {i + 1}
                    </Text>
                  </TouchableOpacity>)}
              </View>}

            <TouchableOpacity accessibilityRole="button" disabled={!!busy} style={[s.primary, !!busy && s.disabled]} onPress={apply}>
              {busy === 'apply' ? <ActivityIndicator color="#FFF" /> : <Text style={s.white}>
                  카드 신청
                </Text>}
            </TouchableOpacity>

            <Text style={s.caption}>
              카드사 공식 상품 안내로 이동합니다.
              실제 발급 신청은 카드사에서 진행합니다.
            </Text>

            <TouchableOpacity accessibilityRole="button" disabled={!!busy} onPress={continueMain} style={s.skip}>
              <Text style={s.skipText}>
                {busy === 'next' ? '이동 중…' : '괜찮아요, 메인으로 갈게요'}
              </Text>
            </TouchableOpacity>

            {!reduced && <TouchableOpacity accessibilityRole="button" onPress={() => setReplay(value => value + 1)} style={s.small}>
                <Text style={s.caption}>
                  등장 효과 다시 보기
                </Text>
              </TouchableOpacity>}
          </>}

        {!!notice && <Text style={s.caption}>
            {notice}
          </Text>}

        {!!error && card && <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>}

        <Text style={s.disclaimer}>
          발급하려면 카드사에서 별도로 신청해주세요.
        </Text>
      </View>
    </ScrollView>;
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  content: {
    padding: 20,
    paddingBottom: 110,
    flexGrow: 1
  },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: 12
  },
  back: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    minHeight: 44
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  eyebrow: {
    color: '#6687C6',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 12
  },
  headline: {
    fontSize: 28,
    lineHeight: 39,
    fontWeight: "800",
    color: "#142D4E",
    textAlign: 'center'
  },
  reason: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  reasonText: {
    fontSize: 16,
    lineHeight: 27,
    textAlign: 'center',
    color: '#354F72'
  },
  body: {
    fontSize: 14,
    lineHeight: 24,
    color: '#5D718F',
    textAlign: 'center'
  },
  bold: {
    fontWeight: '800',
    color: '#244C8D'
  },
  caption: {
    fontSize: 12,
    lineHeight: 21,
    color: "#5A6E89",
    textAlign: 'center'
  },
  hero: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: "#E3EAF4",
    gap: 7
  },
  star: {
    color: '#DCAF43',
    fontSize: 27
  },
  cardName: {
    fontSize: 22,
    lineHeight: 31,
    fontWeight: "800",
    color: "#142D4E",
    textAlign: 'center'
  },
  reveal: {
    width: '100%',
    height: 300,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  imageArea: {
    width: '100%',
    maxWidth: 330,
    height: 265,
    zIndex: 2
  },
  image: {
    width: '100%',
    height: '100%'
  },
  spinner: {
    ...StyleSheet.absoluteFillObject
  },
  imageError: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  spark: {
    position: 'absolute',
    left: '48%',
    top: '48%',
    fontSize: 22,
    zIndex: 1
  },
  benefitBadge: {
    alignSelf: 'stretch',
    backgroundColor: "#EDF3FF",
    borderRadius: 16,
    padding: 15,
    gap: 5
  },
  benefitHeadline: {
    fontSize: 20,
    fontWeight: "800",
    color: "#245DE5",
    textAlign: 'center'
  },
  small: {
    padding: 10,
    alignItems: 'center',
    minHeight: 44
  },
  details: {
    alignSelf: 'stretch',
    gap: 12,
    paddingTop: 6
  },
  detailRow: {
    borderTopWidth: 1,
    borderColor: "#E3EAF4",
    paddingTop: 12,
    gap: 5
  },
  pager: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8
  },
  dotButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E7EDFA',
    alignItems: 'center',
    justifyContent: 'center'
  },
  dotSelected: {
    backgroundColor: "#245DE5"
  },
  dotText: {
    color: '#6D83A9',
    fontWeight: '800'
  },
  dotActive: {
    color: "#FFFFFF"
  },
  primary: {
    minHeight: 54,
    backgroundColor: "#245DE5",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    alignSelf: 'stretch'
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  skip: {
    padding: 14,
    alignItems: 'center'
  },
  skipText: {
    color: '#7D8DA6',
    fontSize: 14
  },
  empty: {
    gap: 20,
    paddingVertical: 65
  },
  error: {
    color: "#C53D56",
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 22
  },
  disclaimer: {
    fontSize: 12,
    lineHeight: 20,
    color: "#5A6E89",
    textAlign: 'center',
    marginTop: 10
  },
  disabled: {
    opacity: 0.5
  }
});
