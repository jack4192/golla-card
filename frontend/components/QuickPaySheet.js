// '이 카드로 결제' QR 결제 바텀시트
// 결제 화면으로 넘어가지 않고, 화면 아래에서 QR·바코드만 간결하게 보여줍니다.
// - 열리면 60초짜리 예시 결제 코드를 발급하고, 시간이 지나면 '새 코드 받기'로 다시 발급합니다.
// - 카드 변경은 시트 안에서 바로 하고, 자세한 혜택 비교는 '혜택 자세히 보기'로 기존 결제 화면을 엽니다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Image, Modal, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Codes, makeDemoCode, protectScreen, realWalletCards } from '../screens/PaymentScreen';

const CODE_SECONDS = 60;
const CLOSE_DISTANCE = 80;

export default function QuickPaySheet({ visible, cards = [], cardId, context, onSelectCard, onClose, onOpenDetails }) {
  const options = useMemo(() => realWalletCards(cards.find(card => card.id === cardId), cards), [cards, cardId]);
  const selected = options.find(card => card.id === cardId) || options[0];
  const [code, setCode] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const sequence = useRef(0);
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > CLOSE_DISTANCE || gesture.vy > 1.2) onCloseRef.current?.();
      else Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
    },
  })).current;

  const issue = async () => {
    if (!selected) return;
    const ticket = ++sequence.current;
    setCode(null);
    setGenerating(true);
    setError('');
    try {
      const value = await makeDemoCode();
      if (ticket !== sequence.current) return;
      setCode({ value, cardId: selected.id, expiresAt: Date.now() + CODE_SECONDS * 1000 });
      setNow(Date.now());
    } catch (problem) {
      if (ticket === sequence.current) setError(problem?.message || '결제 코드를 만들지 못했어요.');
    } finally {
      if (ticket === sequence.current) setGenerating(false);
    }
  };

  // 열릴 때·카드가 바뀔 때 새 코드 발급, 닫히면 코드 폐기
  useEffect(() => {
    if (!visible) {
      sequence.current += 1;
      setCode(null);
      setPicking(false);
      return undefined;
    }
    dragY.setValue(0);
    issue();
    return undefined;
  }, [visible, selected?.id]);

  // 남은 시간 표시, 앱이 백그라운드로 가면 시간만 갱신
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    const subscription = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [visible]);

  // 휴대폰에서는 결제 코드가 보이는 동안 화면 캡처를 막고 밝기를 올립니다(결제 화면과 같음).
  useEffect(() => {
    if (!visible) return undefined;
    let stopped = false;
    let cleanup;
    protectScreen().then(callback => {
      if (stopped) callback(); else cleanup = callback;
    }).catch(() => {});
    return () => {
      stopped = true;
      if (cleanup) cleanup();
    };
  }, [visible]);

  const seconds = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0;
  const expired = !code || seconds === 0 || code.cardId !== selected?.id;

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="결제 닫기" activeOpacity={1} style={s.backdropTouch} onPress={onClose} />
      <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]} accessibilityViewIsModal>
        <View {...pan.panHandlers} style={s.handleArea}><View style={s.handle} /></View>

        {!selected ? <View style={s.empty}>
          <Text style={s.emptyText}>결제에 사용할 수 있는 카드가 없어요. 카드 탭에서 카드를 등록해주세요.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.close}><Text style={s.closeText}>닫기</Text></TouchableOpacity>
        </View> : <>
          <View style={s.headRow}>
            <Text accessibilityRole="header" style={s.heading}>QR · 바코드 결제</Text>
            <Text style={[s.timer, expired && s.timerExpired]} accessibilityLiveRegion="polite">
              {generating ? '발급 중' : expired ? '만료됨' : `${seconds}초`}
            </Text>
          </View>

          {!picking && <>
          {!!context?.title && <Text style={s.context} numberOfLines={2}>
            📅 {context.title}{context.benefitName ? ' · ' + context.benefitName : ''}
          </Text>}

          <View style={s.codeBox}>
            {generating ? <ActivityIndicator color="#245DE5" style={s.loading} />
              : code ? <Codes value={code.value} inactive={expired} /> : null}
          </View>
          <Text style={s.notice}>QR·바코드는 예시이며 실제 결제에 사용할 수 없어요.</Text>
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

          <View style={s.actions}>
            <TouchableOpacity accessibilityRole="button" disabled={generating} onPress={issue} style={[s.secondary, generating && s.dim]}>
              <Ionicons name="refresh" size={16} color="#245DE5" />
              <Text style={s.secondaryText}>{expired ? '새 코드 받기' : '코드 다시 발급'}</Text>
            </TouchableOpacity>
            {!!onOpenDetails && <TouchableOpacity accessibilityRole="button" onPress={onOpenDetails} style={s.secondary}>
              <Ionicons name="stats-chart-outline" size={16} color="#245DE5" />
              <Text style={s.secondaryText}>혜택 자세히 보기</Text>
            </TouchableOpacity>}
          </View>
          </>}
          {/* 결제 카드 + 카드 변경 */}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={'결제 카드 ' + selected.name + (options.length > 1 ? ', 눌러서 카드 변경' : '')}
            disabled={options.length < 2} onPress={() => setPicking(value => !value)} style={s.cardRow}>
            {!!selected.image && <Image source={typeof selected.image === 'string' ? { uri: selected.image } : selected.image} resizeMode="contain" style={s.cardImage} />}
            <View style={s.cardInfo}>
              <Text style={s.cardLabel}>결제 카드</Text>
              <Text style={s.cardName} numberOfLines={1}>{selected.name}</Text>
            </View>
            {options.length > 1 && <View style={s.change}>
              <Text style={s.changeText}>카드 변경</Text>
              <Ionicons name={picking ? 'chevron-up' : 'chevron-down'} size={14} color="#245DE5" />
            </View>}
          </TouchableOpacity>

          {/* 카드를 고르는 동안에는 QR 대신 카드 목록을 보여줍니다. */}
          {picking && <ScrollView style={s.pickList} contentContainerStyle={s.pickContent}>
            {options.filter(card => card.id !== selected.id).map(card => <TouchableOpacity key={card.id} accessibilityRole="button"
                onPress={() => { setPicking(false); onSelectCard?.(card.id); }} style={s.pickRow}>
              {!!card.image && <Image source={typeof card.image === 'string' ? { uri: card.image } : card.image} resizeMode="contain" style={s.pickImage} />}
              <Text style={s.pickName} numberOfLines={1}>{card.name}</Text>
            </TouchableOpacity>)}
          </ScrollView>}

          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.close}><Text style={s.closeText}>닫기</Text></TouchableOpacity>
        </>}
      </Animated.View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '92%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, gap: 12 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D3DBE7' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '800', color: '#14213D' },
  timer: { fontSize: 18, fontWeight: '800', color: '#245DE5' },
  timerExpired: { color: '#C53D56' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: '#F4F7FF' },
  cardImage: { width: 56, height: 36 },
  cardInfo: { flex: 1, gap: 2 },
  cardLabel: { fontSize: 11, color: '#687B97', fontWeight: '600' },
  cardName: { fontSize: 15, color: '#14213D', fontWeight: '700' },
  change: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  changeText: { color: '#245DE5', fontSize: 13, fontWeight: '700' },
  pickList: { flexGrow: 0, flexShrink: 0, maxHeight: 320 },
  pickContent: { gap: 4 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E3EAF4' },
  pickImage: { width: 48, height: 30 },
  pickName: { flex: 1, fontSize: 14, color: '#14213D', fontWeight: '600' },
  context: { fontSize: 13, lineHeight: 19, color: '#3D5170' },
  codeBox: { minHeight: 290, justifyContent: 'center' },
  loading: { marginVertical: 40 },
  notice: { fontSize: 12, color: '#687B97', textAlign: 'center' },
  error: { fontSize: 13, color: '#C53D56', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#D6E2FA' },
  secondaryText: { color: '#245DE5', fontSize: 14, fontWeight: '700' },
  dim: { opacity: 0.5 },
  close: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F4F9' },
  closeText: { color: '#104FE7', fontSize: 14, fontWeight: '700' },
  empty: { gap: 14, paddingVertical: 12 },
  emptyText: { fontSize: 14, lineHeight: 22, color: '#5A6E89', textAlign: 'center' },
});
