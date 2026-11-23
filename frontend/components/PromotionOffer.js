import React, { useState } from 'react';
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useRecommendationReveal from './useRecommendationReveal';

const money = value => Number(value).toLocaleString('ko-KR') + '원';

export default function PromotionOffer({ offer, reason, status, onBrowse, recommendation = false, reduced = true }) {
  const [expanded, setExpanded] = useState(false);
  const [logoStatus, setLogoStatus] = useState('loading');
  // 로고는 서버가 준다 (offer.logo = { uri }, 2026-11-23 행사 DB 이전). 없거나 받지 못하면 이름만
  const logo = offer.logo;
  const hasLogo = Boolean(logo) && logoStatus !== 'failed';
  const summary = String(offer.benefit || offer.merchant).replace(' 마이신한포인트', 'P');
  const detailsLabel = expanded ? '상세 혜택 접기' : '더 자세한 혜택 보기';
  const { motionStyle } = useRecommendationReveal({
    ready: !hasLogo || logoStatus === 'loaded',
    reduced: !recommendation || !hasLogo ? true : reduced,
  });
  return <View style={[s.card, recommendation && s.recommendationCard]}>
    <View style={[s.summary, recommendation && s.recommendationSummary]}>
      {hasLogo ? <View style={recommendation && s.stage}>
        <Animated.View style={[
          s.logoBox,
          s.logoBackground,
          recommendation && s.recommendationLogoBox,
          recommendation && motionStyle,
        ]}>
          <Image source={logo} style={[
            s.logo,
            recommendation && s.recommendationLogo,
          ]} resizeMode="contain" fadeDuration={0} accessible accessibilityLabel={offer.merchant + ' 로고'}
            onLoad={() => setLogoStatus('loaded')} onError={() => setLogoStatus('failed')} />
        </Animated.View>
      </View> : <Text style={s.merchant}>{offer.merchant}</Text>}
      <View style={recommendation ? s.benefitBadge : s.offerColumn}>
        <Text accessibilityRole="header" style={[s.offer, recommendation && s.recommendationOffer]}>{summary}</Text>
      </View>
    </View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={detailsLabel} accessibilityState={{ expanded }}
      style={[s.detailsButton, recommendation && s.recommendationButton]} onPress={() => setExpanded(value => !value)}>
      <Text style={s.link}>{detailsLabel}</Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color="#2455C7" accessible={false} />
    </TouchableOpacity>
    {expanded && <View style={s.details}>
      {[
        ['적용 혜택', summary !== offer.benefit ? offer.benefit : null],
        ['추천 이유', reason],
        ['결제 조건', offer.method],
        ['최소 결제', offer.minimum == null ? null : money(offer.minimum) + ' 이상'],
        ['최대 혜택한도', offer.cap == null ? null : money(offer.cap)],
        ['기간', offer.start && offer.end ? offer.start + ' ~ ' + offer.end : null],
        ['혜택 지급일', offer.payout],
        ['현재 기간 상태', status],
        ['유의사항', offer.note],
      ].filter(([, value]) => value).map(([label, value]) => <View key={label} style={s.detailRow}>
        <Text style={s.detailLabel}>{label}</Text>
        <Text style={s.detail}>{value}</Text>
      </View>)}
      {status && <Text style={s.fineprint}>개인별 혜택 적용 및 중복 사용 여부는 카드사 안내를 확인해주세요.</Text>}
      {onBrowse && <TouchableOpacity accessibilityRole="button" style={s.detailsButton} onPress={onBrowse}>
        <Text style={s.link}>혜택 둘러보기</Text>
      </TouchableOpacity>}
    </View>}
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 4, borderRadius: 18, borderWidth: 1, borderColor: '#E4E8EF' },
  recommendationCard: { borderRadius: 26, padding: 22, borderColor: '#E3EAF4' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingBottom: 16 },
  recommendationSummary: { flexDirection: 'column', flexWrap: 'nowrap', gap: 12, paddingBottom: 0 },
  stage: { width: '100%', minHeight: 168, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  logoBox: { width: 142, maxWidth: '100%', height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#E8EBF0', overflow: 'hidden' },
  logo: { width: 118, height: 46, maxWidth: '100%' },
  logoBackground: { backgroundColor: '#FFFFFF' },     // 브랜드별 배경색은 앱 데이터라 두지 않는다 (2026-11-23)
  paddedLogo: { width: 134, height: 70 },
  recommendationLogoBox: { width: '100%', maxWidth: 252, height: 120, borderRadius: 20 },
  recommendationLogo: { width: '82%', height: 80 },
  recommendationPaddedLogo: { width: '100%', height: 132 },
  merchant: { fontSize: 15, fontWeight: '600', color: '#526176' },
  offerColumn: { flexGrow: 1, flexShrink: 1, minWidth: 118 },
  offer: { fontSize: 23, lineHeight: 31, fontWeight: '700', color: '#18253B' },
  benefitBadge: { alignSelf: 'stretch', padding: 18, borderRadius: 18, backgroundColor: '#EDF3FF' },
  recommendationOffer: { fontSize: 22, fontWeight: '800', color: '#104FE7', textAlign: 'center' },
  detailsButton: { minHeight: 46, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#EDF0F4' },
  recommendationButton: { justifyContent: 'center', borderTopWidth: 0, marginTop: 8 },
  link: { fontSize: 14, fontWeight: '600', color: '#2455C7' },
  details: { padding: 14, marginBottom: 12, gap: 10, borderRadius: 12, backgroundColor: '#F6F8FB' },
  detailRow: { flexDirection: 'row', gap: 12 },
  detailLabel: { width: 84, fontSize: 13, lineHeight: 20, fontWeight: '700', color: '#244874' },
  detail: { flex: 1, fontSize: 13, lineHeight: 20, color: '#526783' },
  fineprint: { fontSize: 12, lineHeight: 18, color: '#526783' },
});
