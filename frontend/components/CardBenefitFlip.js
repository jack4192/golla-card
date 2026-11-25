// 홈 큰 카드 그림: 누르면 카드 그림만 뒤집혀, 뒷면(같은 카드를 흐리게 깐 위)에 '이 거래의 예상 혜택'을 보여 준다 (2026-11-24).
// - 계산은 결제 화면과 같다 (useBenefitEstimate). 처음 뒤집을 때만 계산을 시작한다 (홈을 열 때마다 AI 를 부르지 않게).
// - AI 배치는 기록 없는 미리보기(loadPlacementPreview). 카드가 바뀌면(미리보기 등) 앞면으로 돌아간다.
// - 뒷면은 AI 추천 문구만 (금액·비교는 결제 화면 상세 상자, PR #11). 단 그 문구는 '지금 시각 AI 1순위 카드' 이야기라,
//   뒤집은 카드가 그 1순위이고 showAiMessage(자동 배치 켬·미리보기 아님)일 때만 쓴다. 아니면 이 카드의 예상 혜택 금액 (PR #11 검토)
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { realWalletCards, reward, useBenefitEstimate, won } from '../screens/PaymentScreen';
import { SERVER_MODE } from '../utils/api';
import { loadPlacementPreview } from '../utils/aiPlacement';
import { dropCardName } from '../utils/cardReasonCore';

const HALF_MS = 170;
const CARD_RATIO = 1.52;   // 카드 그림 가로:세로 (TodaySchedulePanel homeArtwork 와 같다)

// 뒷면 내용: 흐린 카드 위에 짧게 (AI 추천 문구, 아니면 가맹점·금액 / 예상 혜택)
function BenefitBack({ card, cards, showAiMessage }) {
  const options = useMemo(() => realWalletCards(card, cards), [card, cards]);
  const selected = options.find(item => item.id === card?.id) || options[0];
  const baseline = options.find(item => item.id !== selected?.id) || selected;
  const [placement, setPlacement] = useState({ status: SERVER_MODE ? 'loading' : 'off', result: null });
  useEffect(() => {
    if (!SERVER_MODE || !options.length) return undefined;
    let stopped = false;
    loadPlacementPreview(options)
      .then(result => { if (!stopped) setPlacement({ status: result ? 'ready' : 'off', result }); })
      .catch(() => { if (!stopped) setPlacement({ status: 'failed', result: null }); });
    return () => { stopped = true; };
  }, [options]);
  const { scenario, selectedBenefit } = useBenefitEstimate({ options, selected, baseline, placement });

  if (!selected) return <Text style={s.backNote}>등록된 카드가 없어요.</Text>;
  if (placement.status === 'loading' || !scenario || !selectedBenefit) return <ActivityIndicator color="#FFFFFF" />;
  const known = Number.isFinite(selectedBenefit.value);
  const ai = placement.result;
  const aiTop = showAiMessage && ai?.topId === selected.id && !ai?.fallback;
  // 앞면에 카드가 보이니 설명 앞의 카드 이름은 뗀다 (2026-11-25 팀 피드백)
  const aiMessage = aiTop ? dropCardName(String(ai?.message || '').trim(), selected.name) : '';
  if (aiMessage) {
    return <View style={s.aiRow}>
      <View style={s.aiBadge}><Text style={s.aiBadgeText}>AI 추천</Text></View>
      <Text style={s.aiText} numberOfLines={3}>{aiMessage}</Text>
    </View>;
  }
  return <>
    <Text style={s.backEyebrow} numberOfLines={1}>이 거래의 예상 혜택 · {scenario.merchant} {won(scenario.amount)}</Text>
    <Text style={s.backLabel}>예상 혜택</Text>
    <Text style={[s.backAmount, !known && s.backAmountUnknown]} numberOfLines={1} adjustsFontSizeToFit>
      {known ? reward(selectedBenefit) : '조건 확인 필요'}
    </Text>
  </>;
}

export default function CardBenefitFlip({ card, cards, artwork, artworkStyle, showAiMessage = true }) {
  const [side, setSide] = useState('front');
  const [opened, setOpened] = useState(false);     // 한 번이라도 뒤집었으면 뒷면 계산을 둔다
  const [box, setBox] = useState(null);            // 그림 칸 크기 → 실제 카드 그림 크기 (contain)
  const turn = useRef(new Animated.Value(0)).current;  // 0 → 1: 카드가 옆으로 눕고, 면을 바꾼 뒤 1 → 0 으로 선다
  const busy = useRef(false);

  useEffect(() => { setSide('front'); turn.setValue(0); busy.current = false; }, [card?.id]);

  const flip = () => {
    if (busy.current || !card) return;
    busy.current = true;
    if (side === 'front') setOpened(true);
    Animated.timing(turn, { toValue: 1, duration: HALF_MS, easing: Easing.in(Easing.quad), useNativeDriver: false }).start(() => {
      setSide(current => (current === 'front' ? 'back' : 'front'));
      Animated.timing(turn, { toValue: 0, duration: HALF_MS, easing: Easing.out(Easing.quad), useNativeDriver: false })
        .start(() => { busy.current = false; });
    });
  };
  // 가로로 줄였다 펴서 뒤집는다 (2D). 3D 회전(rotateY+perspective)은 아이폰에서 카드 반쪽이 뒤 배경 원에 가려 보였다 (2026-11-24)
  const scaleX = turn.interpolate({ inputRange: [0, 1], outputRange: [1, 0.02] });
  const showBack = side === 'back';
  // 그림 칸 안에서 카드가 실제로 그려지는 크기 (resizeMode contain)
  const cardSize = box ? (() => {
    const width = Math.min(box.width, box.height * CARD_RATIO);
    return { width, height: width / CARD_RATIO };
  })() : null;

  return <>
    <View style={artworkStyle} onLayout={event => { const { width, height } = event.nativeEvent.layout; setBox({ width, height }); }}>
      <Animated.View style={[StyleSheet.absoluteFill, s.center, s.raise, { transform: [{ scaleX }] }]}>
        <TouchableOpacity accessibilityRole="button" activeOpacity={0.95} onPress={flip} style={[StyleSheet.absoluteFill, s.center]}
          accessibilityLabel={showBack ? '예상 혜택 보는 중. 누르면 카드로 돌아가요' : (card?.name || '카드') + '. 누르면 예상 혜택을 보여 줘요'}>
          <Image source={artwork} resizeMode="contain" fadeDuration={0} style={[s.fill, showBack && s.invisible]} accessible={false} />
          {opened && cardSize && <View pointerEvents="none" style={[s.back, cardSize, !showBack && s.invisible]}>
            <Image source={artwork} resizeMode="cover" fadeDuration={0} blurRadius={10} style={StyleSheet.absoluteFill} accessible={false} />
            <View style={[StyleSheet.absoluteFill, s.veil]} />
            <View style={s.backContent}>
              <BenefitBack card={card} cards={cards} showAiMessage={showAiMessage} />
            </View>
          </View>}
        </TouchableOpacity>
      </Animated.View>
    </View>
    <View style={s.hintRow} pointerEvents="none">
      <Ionicons name="sync-outline" size={13} color="#4A6390" />
      <Text style={s.hint}>{showBack ? '누르면 카드로 돌아가요' : '카드를 누르면 예상 혜택을 볼 수 있어요'}</Text>
    </View>
  </>;
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  raise: { zIndex: 2, elevation: 2 },
  fill: { width: '100%', height: '100%' },
  invisible: { opacity: 0 },
  // 뒷면: 카드 색이 비치는 어두운 투명 유리 (2026-11-24, 흰 막은 탁해 보여 바꿈)
  back: { position: 'absolute', borderRadius: 14, overflow: 'hidden', backgroundColor: '#14235A', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.35)' },
  veil: { backgroundColor: 'rgba(10, 22, 64, 0.52)' },
  backContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, gap: 3 },
  aiRow: { alignItems: 'center', gap: 4, marginBottom: 2 },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: '#2F6BFF' },
  aiBadgeText: { fontSize: 10, fontWeight: '900', color: '#FFFFFF' },
  aiText: { fontSize: 15, lineHeight: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center', paddingHorizontal: 4 },
  backEyebrow: { fontSize: 11, fontWeight: '700', color: 'rgba(255, 255, 255, 0.82)' },
  backLabel: { marginTop: 4, fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  backAmount: { fontSize: 32, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5, textShadowColor: 'rgba(0, 0, 0, 0.35)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  backAmountUnknown: { fontSize: 17 },
  backNote: { fontSize: 13, color: '#FFFFFF' },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6 },
  hint: { fontSize: 12, fontWeight: '600', color: '#4A6390' },
});
