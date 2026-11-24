// 연말 결산 (2026-11-24 다시 만듦, 설계서 2026-11-23-year-end-report-design.md).
// 올해 받은 혜택(결제에 기록된 카드 혜택·가맹점 행사의 합, 백엔드)과 놓친 혜택(AI 연말정산, 올해 1월부터, 1만 원 이상 상위 3장)을
// 위에서 아래로 읽는 리포트로 보여준다. 두 API 는 따로 불러서 AI 가 느리거나 실패해도 받은 혜택은 먼저 보인다.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SERVER_MODE, api } from '../utils/api';
import { CARD_CATALOG_40 } from '../data/cardCatalog40';
import { officialProduct } from '../screens/RoutinePatternRecommendationScreen';
import { barRatios, findCatalogCard, missedMessage, missedTags, missedView, monthLabel, peakLine, periodLine, splitLine, topCards, won } from '../utils/yearEndCore';

const BAR_HEIGHT = 56;
const BASIS = [
  '받은 혜택은 결제할 때 기록된 카드 혜택과 가맹점 행사 금액을 더한 값이에요.',
  '놓친 혜택은 올해 결제는 그대로 두고, 그 카드가 있었다면 매장 결제에 어떤 카드를 냈을지 다시 골라 계산한 값이에요. 전월 실적은 달마다 다시 세고, 연회비는 기간만큼 뺐어요.',
  '"대신"은 가진 카드 하나를 그 카드로 바꿨다고 본 금액이고, "더해서"는 지금 카드에 그 카드를 더해 함께 썼다고 본 금액이에요.',
];

function CardThumb({ name, large }) {
  const product = findCatalogCard(CARD_CATALOG_40, name);
  const style = large ? s.thumbLarge : s.thumb;
  return product?.image
    ? <Image source={product.image} style={style} resizeMode="contain" accessible={false} />
    : <View style={[style, s.thumbEmpty]}><Ionicons name="card-outline" size={large ? 26 : 18} color="#5A6E89" /></View>;
}

function Retry({ text, onPress }) {
  return <View style={s.center}>
    <Text style={s.mutedText}>{text}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={s.retry}>
      <Text style={s.retryText}>다시 시도</Text>
    </TouchableOpacity>
  </View>;
}

// 놓친 혜택 한 장의 자세한 내용: 절약 금액·꼬리표·카드 보러 가기
function MissedDetail({ item }) {
  const card = findCatalogCard(CARD_CATALOG_40, item.card_name);
  const product = officialProduct(card?.code);
  return <View style={s.detail}>
    <Text style={s.message}>{missedMessage(item, card)}</Text>
    <View style={s.tags}>
      {missedTags(item).map(tag => <View key={tag} style={s.tag}><Text style={s.tagText}>{tag}</Text></View>)}
    </View>
    {product && <TouchableOpacity accessibilityRole="link" onPress={() => Linking.openURL(product.url).catch(() => {})} style={s.linkButton}>
      <Text style={s.linkText}>카드 보러 가기</Text>
      <Ionicons name="open-outline" size={16} color="#1459F5" />
    </TouchableOpacity>}
  </View>;
}

function MissedSection({ missed, onRetry }) {
  const [open, setOpen] = useState(null);
  useEffect(() => setOpen(null), [missed.items]);
  const [first, ...rest] = missed.items;
  return <View style={s.card}>
    <View style={s.cardHead}>
      <Text style={s.cardTitle}>이 카드였다면 더 받았어요</Text>
      <View style={s.aiBadge}><Text style={s.aiBadgeText}>AI 분석</Text></View>
    </View>
    {missed.state === 'loading' && <View style={s.center}>
      <ActivityIndicator color="#1459F5" />
      <Text style={s.mutedText}>올해 결제를 다시 계산하고 있어요</Text>
    </View>}
    {missed.state === 'error' && <Retry text="놓친 혜택을 불러오지 못했어요" onPress={onRetry} />}
    {missed.state === 'empty' && <View style={s.goodFit}>
      <Ionicons name="checkmark-circle" size={28} color="#178A4A" />
      <Text style={s.goodFitTitle}>지금 카드 조합이 잘 맞아요</Text>
      <Text style={s.mutedText}>올해 결제로 계산해 보니 1만 원 넘게 더 주는 신한카드가 없었어요.</Text>
    </View>}
    {missed.state === 'ready' && first && <>
      <View style={s.featured}>
        <CardThumb name={first.card_name} large />
        <View style={s.flex}>
          <Text style={s.featuredName} numberOfLines={2}>{first.card_name}</Text>
          <Text style={s.gainBig}>+{won(first.gain)}</Text>
        </View>
      </View>
      <MissedDetail item={first} />
      {rest.map((item, index) => {
        const expanded = open === index;
        return <View key={item.card_id} style={s.restItem}>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }}
            onPress={() => setOpen(expanded ? null : index)} style={s.restRow}>
            <Text style={s.rank}>{index + 2}위</Text>
            <CardThumb name={item.card_name} />
            <Text style={s.restName} numberOfLines={1}>{item.card_name}</Text>
            <Text style={s.gainSmall}>+{won(item.gain)}</Text>
            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color="#6A7A91" />
          </TouchableOpacity>
          {expanded && <MissedDetail item={item} />}
        </View>;
      })}
    </>}
  </View>;
}

function ReceivedCard({ summary, onRetry }) {
  if (summary.state === 'loading') {
    return <View style={[s.hero, s.center]}><ActivityIndicator color="#FFFFFF" /></View>;
  }
  if (summary.state === 'error') {
    return <View style={s.card}><Retry text="결산을 불러오지 못했어요" onPress={onRetry} /></View>;
  }
  const data = summary.data;
  if (!data.count) {
    return <View style={s.card}><Text style={[s.mutedText, s.centerText]}>올해 결제가 아직 없어요</Text></View>;
  }
  const ratios = barRatios(data.months);
  const peakIndex = ratios.indexOf(1);
  const peak = peakLine(data.months);
  return <View style={s.hero}>
    <Text style={s.heroLabel}>올해 카드로 받은 혜택</Text>
    <Text style={s.heroValue} adjustsFontSizeToFit numberOfLines={1}>{won(data.total)}</Text>
    <Text style={s.heroSub}>{splitLine(data)}</Text>
    <View style={s.bars} accessible accessibilityLabel={peak || '월별 받은 혜택'}>
      {ratios.map((ratio, index) => <View key={data.months[index].month}
        style={[s.bar, { height: Math.max(3, Math.round(ratio * BAR_HEIGHT)) }, index === peakIndex && s.barPeak]} />)}
    </View>
    <View style={s.barLabels}>
      <Text style={s.barLabel}>{monthLabel(data.months[0].month)}</Text>
      {data.months.length > 1 && <Text style={s.barLabel}>{monthLabel(data.months[data.months.length - 1].month)}</Text>}
    </View>
    {peak && <Text style={s.heroPeak}>{peak}</Text>}
  </View>;
}

export default function YearEndReport({ visible, onClose }) {
  const [summary, setSummary] = useState({ state: 'loading', data: null });
  const [missed, setMissed] = useState({ state: 'loading', items: [] });
  const [basisOpen, setBasisOpen] = useState(false);
  const generation = useRef(0);   // 닫힌 뒤 도착한 응답은 버린다

  const loadSummary = useCallback(() => {
    const gen = generation.current;
    setSummary({ state: 'loading', data: null });
    api.paymentsYearSummary()
      .then(data => {
        if (generation.current !== gen) return;
        setSummary(Array.isArray(data?.months) && data.months.length ? { state: 'ready', data } : { state: 'error', data: null });
      })
      .catch(() => { if (generation.current === gen) setSummary({ state: 'error', data: null }); });
  }, []);

  const loadMissed = useCallback(() => {
    const gen = generation.current;
    setMissed({ state: 'loading', items: [] });
    api.aiMissedBenefit()
      .then(result => { if (generation.current === gen) setMissed(missedView(result)); })
      .catch(() => { if (generation.current === gen) setMissed({ state: 'error', items: [] }); });
  }, []);

  useEffect(() => {
    if (!visible || !SERVER_MODE) return undefined;
    generation.current += 1;
    setBasisOpen(false);
    loadSummary();
    loadMissed();
    return () => { generation.current += 1; };
  }, [visible, loadSummary, loadMissed]);

  const data = summary.state === 'ready' ? summary.data : null;
  const noPayments = data && !data.count;
  const cards = data ? topCards(data.cards) : [];

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={s.headerButton}>
          <Ionicons name="arrow-back" size={24} color="#1B2C47" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={s.headerTitle}>연말 결산</Text>
        <View style={s.headerButton} />
      </View>
      {!SERVER_MODE ? <View style={[s.flex, s.center]}><Text style={s.mutedText}>서버에 연결하면 결산을 볼 수 있어요</Text></View>
        : <ScrollView contentContainerStyle={s.content}>
          <View>
            <Text style={s.year}>{data ? `${data.year}년 카드 결산` : '올해 카드 결산'}</Text>
            {data && <Text style={s.period}>{periodLine(data)}</Text>}
          </View>

          <ReceivedCard summary={summary} onRetry={loadSummary} />

          {cards.length > 0 && <View style={s.card}>
            <Text style={s.cardTitle}>혜택을 많이 준 카드</Text>
            {cards.map(card => <View key={card.userCardId} style={s.cardRow}>
              <CardThumb name={card.cardName} />
              <Text style={s.restName} numberOfLines={1}>{card.cardName}</Text>
              <Text style={s.cardAmount}>{won(card.total)}</Text>
            </View>)}
          </View>}

          {!noPayments && <MissedSection missed={missed} onRetry={loadMissed} />}

          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: basisOpen }}
            onPress={() => setBasisOpen(open => !open)} style={s.basisHead}>
            <Text style={s.basisTitle}>계산 기준</Text>
            <Ionicons name={basisOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#6A7A91" />
          </TouchableOpacity>
          {basisOpen && <View style={s.basisBody}>
            {BASIS.map(line => <Text key={line} style={s.basisText}>{line}</Text>)}
          </View>}
        </ScrollView>}
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8FC' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1B2C47' },
  content: { padding: 20, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  year: { fontSize: 26, fontWeight: '800', color: '#16305A' },
  period: { fontSize: 13, color: '#5A6E89', marginTop: 4 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18 },
  centerText: { textAlign: 'center', paddingVertical: 10 },
  mutedText: { fontSize: 13, lineHeight: 20, color: '#6A7A91', textAlign: 'center' },
  retry: { borderWidth: 1, borderColor: '#C9D5E8', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 8 },
  retryText: { fontSize: 14, fontWeight: '700', color: '#1459F5' },

  hero: { backgroundColor: '#16305A', borderRadius: 22, padding: 20, minHeight: 120 },
  heroLabel: { fontSize: 14, fontWeight: '700', color: '#C9D8FB' },
  heroValue: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', marginTop: 4 },
  heroSub: { fontSize: 13, color: '#C9D8FB', marginTop: 4 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: BAR_HEIGHT, marginTop: 18 },
  bar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'rgba(201, 216, 251, 0.35)' },
  barPeak: { backgroundColor: '#8DB8FF' },
  barLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  barLabel: { fontSize: 11, color: '#C9D8FB' },
  heroPeak: { fontSize: 13, fontWeight: '700', color: '#FFFFFF', marginTop: 10 },

  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, gap: 10 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#1B2C47' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  cardAmount: { fontSize: 15, fontWeight: '800', color: '#1B2C47' },
  thumb: { width: 44, height: 28, borderRadius: 4 },
  thumbLarge: { width: 88, height: 56, borderRadius: 6 },
  thumbEmpty: { backgroundColor: '#F1F5FB', alignItems: 'center', justifyContent: 'center' },

  aiBadge: { backgroundColor: '#EEEAFE', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  aiBadgeText: { fontSize: 12, fontWeight: '700', color: '#5B3FC4' },
  featured: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  featuredName: { fontSize: 16, fontWeight: '800', color: '#1B2C47' },
  gainBig: { fontSize: 26, fontWeight: '900', color: '#178A4A', marginTop: 2 },
  detail: { gap: 10 },
  message: { fontSize: 14, lineHeight: 21, color: '#3D5170' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { backgroundColor: '#EEF3FC', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 12, fontWeight: '600', color: '#2F4E80' },
  linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: '#C9D5E8', borderRadius: 12, paddingVertical: 10 },
  linkText: { fontSize: 14, fontWeight: '700', color: '#1459F5' },
  restItem: { borderTopWidth: 1, borderTopColor: '#EEF2F8', paddingTop: 10, gap: 10 },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rank: { fontSize: 13, fontWeight: '800', color: '#6A7A91', width: 26 },
  restName: { flex: 1, fontSize: 14, fontWeight: '700', color: '#1B2C47' },
  gainSmall: { fontSize: 14, fontWeight: '800', color: '#178A4A' },
  goodFit: { alignItems: 'center', gap: 6, paddingVertical: 12 },
  goodFitTitle: { fontSize: 16, fontWeight: '800', color: '#1B2C47' },

  basisHead: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 6 },
  basisTitle: { fontSize: 13, fontWeight: '700', color: '#6A7A91' },
  basisBody: { gap: 6 },
  basisText: { fontSize: 12, lineHeight: 18, color: '#8A99AE' },
});
