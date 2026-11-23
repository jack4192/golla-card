import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, AppState, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PromotionOffer from '../components/PromotionOffer';
import { resolveWalletProduct } from '../components/WalletProductCard';
import { recommendPromotion } from '../data/promotions';
import { CardReveal, officialProduct } from './RoutinePatternRecommendationScreen';
import { dateKey, eventEndDate, makeSignals, readEvents, readProfile } from '../utils/routineData';
import { benefitText, emptyPreferences, money, rankRecommendations, readPreferences } from '../utils/cardRecommendation';
import { recordRecommendation } from '../utils/savingsRecords';
import { addNotification } from '../utils/notifications';
import { SERVER_MODE, api } from '../utils/api';
import { CARD_CATALOG_40 } from '../data/cardCatalog40';
import { toCardRecommendation, toPromotionOffer, visibleTabs } from '../utils/aiRecommendCore';
export { officialProduct, recentPattern } from './RoutinePatternRecommendationScreen';
export const RECOMMENDATION_LABELS = ['카드 추천', '프로모션 추천'];
function CardFallback({ selectedWalletCard }) {
  const walletProduct = resolveWalletProduct(selectedWalletCard);
  return <View style={s.hero}>
    {selectedWalletCard && <View style={s.fallbackRow}>
      {!!walletProduct?.image && <Image source={walletProduct.image} fadeDuration={0} resizeMode="contain" style={s.fallbackImage} />}
      <View style={s.flex}>
        <Text style={s.strong}>지금 갖고 있는 카드가 적합합니다.</Text>
        <Text style={s.caption}>{selectedWalletCard.name}</Text>
      </View>
    </View>}
  </View>;
}

function buildRecommendations(profile, events, saved, now, useCurrentTime, cardAd) {
  const day = dateKey(now);
  const active = useCurrentTime ? events.filter(event => (event.category || event.start) &&
    now >= new Date(`${event.date}T${event.start}:00`) && now < eventEndDate(event)) : [];
  const relevant = active.length ? active.map(event => ({ ...event, date: day })) : events;
  const input = active.length ? null : profile;
  const signals = makeSignals(input, relevant, day);
  const preferences = emptyPreferences();
  preferences.owned = saved.owned;
  const rank = (routine, schedules) => rankRecommendations(routine, schedules, preferences, now).filter(row =>
    // 신한은행 프로젝트이므로 카드 추천은 신한카드 상품만 대상으로 합니다.
    officialProduct(row.card.code) && row.card.issuer === '신한카드' &&
    row.matches.some(match => match.status !== 'blocked')
  );
  const relevantCards = rank(input, relevant);
  // 일정·일과에 맞는 카드가 없으면, 가진 카드를 그대로 두지 않고 혜택이 좋은 신한카드를 한 장 추천합니다.
  const example = relevantCards.length === 0;
  const ranked = example ? rank({ coffee: 'always' }, []) : relevantCards;
  const card = ranked.find(row => !row.owned) || ranked[0] || null;
  // 연말 결산용: 같은 일정에서 혜택이 가장 좋은 '내 카드'(카드사 상관없이)
  const ownedBest = example ? null : rankRecommendations(input, relevant, preferences, now)
    .find(row => row.owned && row.matches.some(match => match.status !== 'blocked')) || null;
  return { card, example, ownedBest, ...(cardAd ? {} : recommendPromotion(signals, now)) };
}
export default function RoutineRecommendationScreen({
  onNext,
  onBack,
  scheduleDate,
  selectedWalletCard,
  presentation = 'screen'
}) {
  const cardAd = presentation === 'card-ad';
  const [input, setInput] = useState(null);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const [reduced, setReduced] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => new Date());
  // 서버 모드: AI 맞춤 추천 페이지 (카드 추천·프로모션 추천과 탭 규칙). 못 받으면 앱 계산을 쓴다.
  const [aiPage, setAiPage] = useState(null);
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
    Promise.all([readProfile(), readEvents(), readPreferences()]).then(([profile, events, saved]) => {
      if (!active) return;
      setInput({
        profile,
        events,
        saved
      });
      setIndex(0);
    }).catch(problem => {
      if (active) {
        setError(problem.message || '추천 정보를 읽지 못했습니다.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    // 오늘 일정의 추천만 AI 에 묻는다 (AI 맞춤 추천은 오늘 기준)
    if (!SERVER_MODE || (scheduleDate && scheduleDate !== dateKey(new Date()))) return undefined;
    let active = true;
    api.aiRecommendationPage().then(page => { if (active) setAiPage(page); }).catch(() => {});
    return () => { active = false; };
  }, [reload, scheduleDate]);
  const recommendations = useMemo(() => {
    if (!input) return null;
    const useCurrentTime = !scheduleDate || scheduleDate === dateKey(now);
    const when = useCurrentTime ? now : new Date(scheduleDate + 'T12:00:00');
    const local = buildRecommendations(input.profile, input.events, input.saved, when, useCurrentTime, cardAd);
    if (!aiPage) return local;
    // AI 가 카드를 주면 그것을, 못 주면(결제 내역이 없는 새 가입자 등) 설문 기반 앱 계산을 쓴다 (2026-11-23 결정)
    const aiCard = toCardRecommendation(aiPage, CARD_CATALOG_40);
    const aiOffer = toPromotionOffer(aiPage);
    return {
      ...local,
      ...(aiCard ? { card: aiCard, example: false, ownedBest: null } : {}),
      ...(aiOffer && !cardAd ? aiOffer : {}),
    };
  }, [input, now, scheduleDate, cardAd, aiPage]);
  // 탭은 AI 규칙을 따른다: 카드날에만 카드 추천, 행사가 없으면 카드 추천만 (2026-11-23 결정)
  const tabs = useMemo(() => cardAd ? [0] : visibleTabs(aiPage), [aiPage, cardAd]);
  useEffect(() => {
    if (!tabs.includes(index)) setIndex(tabs[0]);
  }, [tabs, index]);
  const promotionTab = !cardAd && index === 1;
  const selected = recommendations?.card;
  const card = promotionTab ? null : selected?.card;
  const matches = selected?.matches.filter(item => item.status !== 'blocked') || [];
  const match = matches.sort((a, b) => b.weight - a.weight)[0];
  // 일정과 딱 맞는 카드가 없을 때(기본 추천)는 짧게 추천 이유만
  const reason = recommendations?.example ? '어디서나 두루 쓰기 좋은 카드라 추천해요' : match?.reasons?.[0];
  // 추천을 보여주면 연말 결산 기록을 남깁니다(같은 날·같은 카드·같은 업종은 한 번만).
  const recordedKey = useRef('');
  useEffect(() => {
    // AI 추천은 앱 업종 기준인 연말 결산 기록 방식과 맞지 않아 기록하지 않는다
    if (!selected || selected.ai || recommendations?.example || !match?.category) return;
    const key = `${selected.card.code}:${match.category}`;
    if (recordedKey.current === key) return;
    recordedKey.current = key;
    recordRecommendation({ recommended: selected, ownedBest: recommendations.ownedBest, category: match.category, reason: match.reasons?.[0], now })
      .then(record => record && addNotification({
        id: 'card:' + record.id,
        type: record.missed > 0 ? 'savings' : 'card',
        title: record.missed > 0 ? `${record.recommended.name} 추천` : `${record.recommended.name}이(가) 이 일정에 딱 맞아요`,
        body: record.missed > 0
          ? `${record.categoryLabel} 일정에서 이 카드가 있으면 ${record.missed.toLocaleString('ko-KR')}원 더 아낄 수 있어요 · 연말 결산에 기록했어요`
          : `${record.categoryLabel} 일정 맞춤 카드 · 연말 결산에 기록했어요`,
        target: 'yearend',
      }))
      .catch(() => {});
  }, [selected, recommendations, match, now]);
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
  const promotionContent = () => recommendations?.offer
    ? <PromotionOffer key={recommendations.offer.id} offer={recommendations.offer} reason={recommendations.reason}
        recommendation reduced={reduced} />
    : <View style={s.empty}>
    <Text style={s.reason}>{error || '진행 중인 프로모션이 없어요.'}</Text>
  </View>;
  const cardFallback = () => !cardAd && recommendations
    ? <CardFallback selectedWalletCard={selectedWalletCard} />
    : <View style={s.empty}>
        <Text style={s.reason}>{error || '추천할 카드가 없어요.'}</Text>
        {!!error && <TouchableOpacity accessibilityRole="button" onPress={() => setReload(value => value + 1)} style={s.small}>
          <Text style={s.link}>다시 불러오기</Text>
        </TouchableOpacity>}
      </View>;
  const recommendationTabs = !cardAd && <View style={s.pager}>
    {tabs.map(position => (
      <TouchableOpacity key={position} accessibilityRole="tab" accessibilityState={{ selected: index === position }}
        disabled={busy} onPress={() => {
          setIndex(position);
          setDetails(false);
          setError('');
        }}
        style={[s.choice, index === position && s.active]}>
        <Text style={[s.choiceText, index === position && s.activeText]}>{RECOMMENDATION_LABELS[position]}</Text>
      </TouchableOpacity>
    ))}
  </View>;

  if (presentation === 'popup' || cardAd) {
    return <ScrollView style={s.screen} contentContainerStyle={{padding:18,gap:16}}>
      {recommendationTabs}
      {loading ? <ActivityIndicator/> : promotionTab ? promotionContent() : card ? <View style={[s.hero,{gap:12}]}>
        <CardReveal key={card.code} card={card} reduced={reduced} replay={0}/>
        <Text style={s.cardName}>{card.name}</Text>
        {!!reason && <Text style={s.reason}>{reason}</Text>}
        {match && <View style={s.badge}><Text style={s.benefit}>{benefitText(match.benefit)}</Text><Text style={s.caption}>{match.benefit.name}</Text></View>}
        <TouchableOpacity disabled={busy} onPress={apply} style={s.primary}><Text style={s.white}>카드 상품 보기</Text></TouchableOpacity>
      </View> : cardFallback()}
      {!!error && <Text style={s.error}>{error}</Text>}
    </ScrollView>;
  }
  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <View style={s.header}>
          <View style={s.headerNav}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 다시 확인" disabled={busy} onPress={() => onBack?.()} style={s.backButton}>
              <Ionicons name="chevron-back" size={17} color="#526176" accessible={false} />
              <Text style={s.backText}>일정 다시 확인</Text>
            </TouchableOpacity>
            <Text style={s.wordmark}>SOL·Pay</Text>
          </View>
          <Text accessibilityRole="header" style={s.heading}>일정 맞춤 추천</Text>
        </View>
        {recommendationTabs}

        {loading ? <ActivityIndicator color="#104FE7" size="large" /> : promotionTab ? promotionContent() : card ? <>
            {!!reason && <Text style={s.reason}>{reason}</Text>}

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
                  {/* 간결하게: '업종 · 혜택' + (왜 추천했는지 · 전월 실적) 한 줄 */}
                  {matches.slice(0, 3).map((row, i) => <View key={i} style={s.detail}>
                        <Text style={s.strong}>
                          {String(row.benefit.name || '').split('(')[0].trim()} · {benefitText(row.benefit)}
                        </Text>

                        <Text style={s.detailText}>
                          {[recommendations?.example ? '' : row.reasons[0],
                            row.benefit.minPrevSpend == null ? '' : Number(row.benefit.minPrevSpend) === 0 ? '실적 조건 없음' : '전월 ' + money(row.benefit.minPrevSpend) + ' 이상'].filter(Boolean).join(' · ')}
                        </Text>
                      </View>)}
                </View>}
            </View>
          </> : cardFallback()}

        {!loading && card && <>
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={apply} style={[s.primary, busy && s.dim]}>
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.white}>
                  카드 신청
                </Text>}
            </TouchableOpacity>
          </>}

        {!!error && recommendations && <Text style={s.error} accessibilityRole="alert">
            {error}
          </Text>}

        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={next} style={[s.secondary, busy && s.dim]}>
          <Text style={s.secondaryText}>홈으로 가기</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>;
}
const s = StyleSheet.create({
  flex: { flex: 1 },
  fallbackRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fallbackImage: { width: 86, height: 60 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  screen: {
    flex: 1,
    backgroundColor: '#F7F8FA'
  },
  content: {
    padding: 20,
    paddingBottom: 36,
    paddingTop: 16
  },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: 16
  },
  header: { gap: 10, paddingBottom: 2 },
  headerNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  wordmark: { color: '#1748B8', fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 28, lineHeight: 36, fontWeight: '800', letterSpacing: -0.7, color: '#18253B' },
  caption: {
    fontSize: 12,
    lineHeight: 21,
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
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    minHeight: 44,
    paddingRight: 8
  },
  backText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#526176'
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
  pager: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#E2E6ED' },
  choice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, minHeight: 44, borderBottomWidth: 2, borderColor: 'transparent' },
  active: { borderColor: '#2455C7' },
  choiceText: { color: '#526176', fontSize: 14, fontWeight: '600' },
  activeText: { color: '#2455C7', fontWeight: '700' },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  secondary: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    minHeight: 44,
    alignSelf: 'center',
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#526176'
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
