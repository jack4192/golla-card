import FlowHeading from '../components/FlowHeading';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PromotionOffer from '../components/PromotionOffer';
import { recommendPromotion } from '../data/promotions';
import { CardReveal, officialProduct } from './RoutinePatternRecommendationScreen';
import { dateKey, makeSignals, readEvents, readProfile } from '../utils/routineData';
import { benefitText, emptyPreferences, money, rankRecommendations, readPreferences } from '../utils/cardRecommendation';
import { restoreMyData, subscribeMyData } from '../utils/myDataService';
export { officialProduct, recentPattern } from './RoutinePatternRecommendationScreen';
export const RECOMMENDATION_LABELS = ['카드 추천', '프로모션 추천'];
function buildRecommendations(profile, events, saved, data, now) {
  const signals = makeSignals(profile, events, dateKey(now));
  const input = signals.length ? profile : { coffee: 'always' };
  const preferences = emptyPreferences();
  preferences.owned = [...new Set([...(saved?.owned || []), ...(data?.cards || []).map(card => card.catalogCode).filter(Boolean)])];
  const ranked = rankRecommendations(input, events, preferences, now).filter(row => officialProduct(row.card.code));
  const card = ranked.find(row => !row.owned) || ranked[0] || null;
  return { card, example: !signals.length, ...recommendPromotion(signals, now) };
}
export default function RoutineRecommendationScreen({
  onNext,
  onBack,
  scheduleDate,
  includeMyData = true,
  presentation = 'screen'
}) {
  const [input, setInput] = useState(null);
  const [data, setData] = useState(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [details, setDetails] = useState(false);
  const [reduced, setReduced] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const alive = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    alive.current = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive.current) setReduced(value);
    }).catch(() => {
      if (alive.current) setReduced(true);
    });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const app = AppState.addEventListener('change', state => {
      if (state === 'active') {
        setNow(new Date());
      }
    });
    return () => {
      alive.current = false;
      motion.remove();
      app.remove();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNotice('');
    const imported = includeMyData ? restoreMyData().catch(() => {
      if (active) {
        setNotice('마이데이터를 읽지 못해 일과 정보로 추천합니다.');
      }
      return null;
    }) : null;
    Promise.all([readProfile(), readEvents(), readPreferences(), imported]).then(([profile, events, saved, snapshot]) => {
      if (!active) return;
      setInput({
        profile,
        events,
        saved
      });
      setData(snapshot);
      setIndex(0);
    }).catch(problem => {
      if (active) {
        setError(problem.message || '추천 정보를 읽지 못했습니다.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    const off = includeMyData ? subscribeMyData(value => {
      if (active) setData(value);
    }) : null;
    return () => {
      active = false;
      off?.();
    };
  }, [reload, includeMyData]);
  const recommendations = useMemo(() => {
    if (!input) return null;
    const when = scheduleDate && scheduleDate !== dateKey(now) ? new Date(scheduleDate + 'T12:00:00') : now;
    return buildRecommendations(input.profile, input.events, input.saved, includeMyData ? data : null, when);
  }, [input, data, now, includeMyData, scheduleDate]);
  const cardAd = presentation === 'card-ad';
  const promotionTab = !cardAd && index === 1;
  const selected = recommendations?.card;
  const card = promotionTab ? null : selected?.card;
  const match = selected ? [...selected.matches].sort((a, b) => b.weight - a.weight)[0] : null;
  const run = async action => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (problem) {
      if (alive.current) {
        setError(problem.message || '다시 시도해주세요.');
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
      }
    }
  };
  const apply = () => run(async () => {
    const product = officialProduct(card?.code);
    if (!product) {
      throw Error('카드 상품 주소를 확인해주세요.');
    }
    await Linking.openURL(product.url);
  });
  const next = () => run(async () => {
    if (typeof onNext !== 'function') {
      throw Error('다음 화면 연결을 확인해주세요.');
    }
    await onNext();
  });
  const promotionContent = () => recommendations?.offer ? <>
    <Text style={s.caption}>{recommendations.reason || '진행 중인 프로모션이에요.'}</Text>
    <PromotionOffer offer={recommendations.offer} />
  </> : <View style={s.empty}>
    <Text style={s.reason}>{error || '진행 중인 프로모션이 없어요.'}</Text>
  </View>;
  if (presentation === 'popup' || cardAd) {
    return <ScrollView style={s.screen} contentContainerStyle={{padding:18,gap:16}}>
      {!cardAd && <View style={{flexDirection:'row',gap:8}}>
        {RECOMMENDATION_LABELS.map((label,i) => <TouchableOpacity key={label} accessibilityRole="tab"
          accessibilityState={{selected:index===i}} onPress={() => {setIndex(i);setError('');}}
          style={{flex:1,minHeight:44,alignItems:'center',justifyContent:'center',borderRadius:14,backgroundColor:index===i?'#123EAC':'#E3EBFD'}}>
          <Text style={{color:index===i?'white':'#294674',fontWeight:'700'}}>{label}</Text>
        </TouchableOpacity>)}
      </View>}
      {loading ? <ActivityIndicator/> : promotionTab ? promotionContent() : card ? <View style={[s.hero,{gap:12}]}>
        <CardReveal key={card.code} card={card} reduced={reduced} replay={0}/>
        <Text style={s.cardName}>{card.name}</Text>
        <Text style={s.reason}>{recommendations.example ? '일과 등록 전에 살펴볼 수 있는 카드예요.' : match?.reasons?.[0] || '등록한 일과와 맞는 혜택이 있어요.'}</Text>
        {match && <View style={s.badge}><Text style={s.benefit}>{benefitText(match.benefit)}</Text><Text style={s.caption}>{match.benefit.name}</Text></View>}
        <TouchableOpacity disabled={busy} onPress={apply} style={s.primary}><Text style={s.white}>카드 상품 보기</Text></TouchableOpacity>
      </View> : <View style={s.empty}><Text style={s.reason}>추천할 카드 정보를 찾지 못했어요.</Text>
        <TouchableOpacity onPress={() => setReload(value=>value+1)} style={s.small}><Text style={s.link}>다시 불러오기</Text></TouchableOpacity></View>}
      {!!error && <Text style={s.error}>{error}</Text>}
      {!promotionTab && <Text style={s.caption}>등록된 카드 상품과 가맹점 혜택을 바탕으로 골랐어요.</Text>}
    </ScrollView>;
  }
  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        {presentation !== 'popup' && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => onBack?.()} style={s.small}>
            <Text style={s.link}>
              ← 일정 다시 확인
            </Text>
          </TouchableOpacity>}

        <FlowHeading brand icon="sparkles-outline">
          일정 맞춤 추천
        </FlowHeading>

        <Text style={s.demo}>
          일정에 맞는 카드와 프로모션을 확인해보세요.
        </Text>

        <View style={s.pager}>
          {RECOMMENDATION_LABELS.map((label, i) => (
            <TouchableOpacity
              key={label}
              accessibilityRole="tab"
              accessibilityLabel={i + 1 + '. ' + label}
              accessibilityState={{selected: index === i}}
              disabled={busy}
              onPress={() => {
                setIndex(i);
                setDetails(false);
                setError('');
              }}
              style={[s.choice, index === i && s.active]}
            >
              <Text style={index === i ? s.white : s.link}>{i + 1}. {label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? <ActivityIndicator color="#104FE7" size="large" /> : promotionTab ? promotionContent() : card ? <>
            <Text style={s.reason}>
              {recommendations.example ? '일정을 등록하기 전이라 카드 상품 예시를 보여드려요.' : match?.reasons?.[0] || '일정에 맞는 혜택을 살펴봤어요.'}
            </Text>

            <View style={s.hero}>
              <Text style={s.cardName}>
                {card.name}
              </Text>

              <Text style={s.caption}>
                {card.issuer} · 연회비{' '}
                {money(card.annualFee || 0)}
                {selected.owned ? ' · 보유 카드' : ''}
              </Text>

              <CardReveal key={index + ':' + card.code} card={card} reduced={reduced} replay={0} />

              {match && <View style={s.badge}>
                  <Text style={s.benefit}>
                    {benefitText(match.benefit)}
                  </Text>

                  <Text style={s.caption}>
                    {match.benefit.name}
                  </Text>
                </View>}

              <TouchableOpacity accessibilityRole="button" onPress={() => setDetails(value => !value)} style={s.small}>
                <Text style={s.link}>
                  {details ? '추천 이유·혜택 조건 접기' : '추천 이유·혜택 조건 확인'}
                </Text>
              </TouchableOpacity>

              {details && <View style={s.details}>
                  {selected.matches.slice(0, 3).map((row, i) => <View key={i} style={s.detail}>
                        <Text style={s.strong}>
                          {row.benefit.name} ·{' '}
                          {benefitText(row.benefit)}
                        </Text>

                        <Text style={s.detailText}>
                          {row.reasons.join(' · ')}
                        </Text>

                        <Text style={s.detailText}>
                          전월 실적:{' '}
                          {row.benefit.minPrevSpend == null ? '확인 필요' : money(row.benefit.minPrevSpend) + ' 이상'}
                        </Text>

                        <Text style={s.detailText}>
                          {row.benefit.note || '카드사 상품 안내에서 상세 조건을 확인해주세요.'}
                        </Text>
                      </View>)}

                  <Text style={s.detailText}>
                    할인율·적립률은 상품 안내값입니다.
                    실적·가맹점·시간·결제 방식·한도에 따라
                    달라지며 실제 절약액을 뜻하지 않습니다.
                  </Text>
                </View>}
            </View>
          </> : <View style={s.empty}>
            <Text style={s.reason}>
              {error || '이 항목에 맞는 카드 혜택을 확인하지 못했어요.'}
            </Text>

            <TouchableOpacity accessibilityRole="button" onPress={() => setReload(value => value + 1)} style={s.small}>
              <Text style={s.link}>
                다시 불러오기
              </Text>
            </TouchableOpacity>
          </View>}

        {!loading && card && <>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={apply} style={[s.primary, busy && s.dim]}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.white}>
                  카드 신청
                </Text>}
            </TouchableOpacity>

            <Text style={s.caption}>
              카드사 공식 상품 안내로 이동합니다.
              발급 신청은 카드사에서 진행합니다.
            </Text>
          </>}

        {!!notice && <Text style={s.caption}>{notice}</Text>}

        {!!error && card && <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>}

        {presentation !== 'popup' && <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={next} style={s.small}>
            <Text style={s.caption}>
              괜찮아요, 메인으로 갈게요
            </Text>
          </TouchableOpacity>}
      </View>
    </ScrollView>;
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FF"
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    paddingTop: 28
  },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: 16
  },
  caption: {
    fontSize: 12,
    lineHeight: 21,
    color: "#5A6E89",
    textAlign: 'center'
  },
  demo: {
    fontSize: 12,
    lineHeight: 20,
    color: "#5A6E89",
    textAlign: 'center'
  },
  reason: {
    fontSize: 16,
    lineHeight: 27,
    color: "#5A6E89",
    textAlign: 'center'
  },
  hero: {
    backgroundColor: "#FFFFFF",
    borderRadius: 26,
    padding: 22,
    gap: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  cardName: {
    fontSize: 21,
    lineHeight: 30,
    fontWeight: "800",
    color: "#142D4E",
    textAlign: 'center'
  },
  badge: {
    alignSelf: 'stretch',
    padding: 18,
    borderRadius: 18,
    backgroundColor: "#EDF3FF",
    gap: 6
  },
  benefit: {
    fontSize: 22,
    fontWeight: "800",
    color: "#104FE7",
    textAlign: 'center'
  },
  small: {
    padding: 12,
    alignItems: 'center',
    minHeight: 44
  },
  link: {
    fontSize: 13,
    fontWeight: "700",
    color: "#104FE7"
  },
  details: {
    alignSelf: 'stretch',
    gap: 12
  },
  detail: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#E8EEF8',
    gap: 6
  },
  strong: {
    fontSize: 13,
    lineHeight: 22,
    fontWeight: '800',
    color: '#244C8D'
  },
  detailText: {
    fontSize: 12,
    lineHeight: 21,
    color: '#73839D'
  },
  pager: {flexDirection: 'row', backgroundColor: '#E5EDFC', padding: 5, gap: 5, borderRadius: 16},
  choice: {flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, minHeight: 48, borderRadius: 12},
  active: {backgroundColor: '#104FE7'},
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  primary: {
    padding: 16,
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: "#104FE7",
    alignItems: "center",
    justifyContent: "center"
  },
  empty: {
    padding: 30
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: "#C53D56",
    textAlign: 'center'
  },
  dim: {
    opacity: 0.5
  }
});
