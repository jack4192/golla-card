// '이 카드로 결제' QR 결제 바텀시트
// 결제 화면으로 넘어가지 않고, 화면 아래에서 QR·바코드만 간결하게 보여줍니다.
// - 열리면 60초짜리 결제 코드를 발급하고, 시간이 지나면 '새 코드 받기'로 다시 발급합니다.
//   서버 모드는 서버가 발급한 코드(2026-11-24, 결제 API)이고, 데모 모드는 기기에서 만든 예시 코드입니다.
// - 서버 모드: 2초마다 코드 상태를 확인해 가상 POS 에서 결제되면 알아채고, 결과를 보여 준 뒤 onPaid 로 홈을 새로 고칩니다.
//   앱에서 바로 결제하는 '이 코드로 결제(시연)' 버튼은 최종본에서 뺐습니다 (2026-11-24 팀 피드백). 결제는 가상 POS 로만.
// - 카드 변경은 시트 안에서 바로 하고, 자세한 혜택 비교는 '혜택 자세히 보기'로 기존 결제 화면을 엽니다.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Image, Modal, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Codes, makeDemoCode, protectScreen, realWalletCards, reward, useBenefitEstimate } from '../screens/PaymentScreen';
import { loadPlacementPreview } from '../utils/aiPlacement';
import { cardReason } from '../utils/cardReasonCore';
import { SERVER_MODE, api } from '../utils/api';
import { serverCardLinks } from '../utils/serverCards';
import { POLL_MS, codeFromServer, receiptFromRecent, shouldPoll } from '../utils/paymentCodeCore';

const CODE_SECONDS = 60;
const CLOSE_DISTANCE = 80;

const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';

// '선정 이유'에 쓸 배치 미리보기(홈 카드 뒷면과 같은 AI 미리보기, 기록 없음).
// 결제 창을 열기 전에 미리 계산해 두고, 열 때마다 새로 묻되 새 답이 올 때까지 지난 답을 그대로 쓴다.
// 창이 열린 뒤 칸이 늦게 생기면 화면 아래에 붙은 결제 창이 커지면서 QR 이 위로 밀린다 (2026-11-24 PR #12 보완)
function usePlacementPreview(options, visible) {
  const walletKey = options.map(card => String(card.id)).sort().join(',');
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [opened, setOpened] = useState(0);
  useEffect(() => { if (visible) setOpened(count => count + 1); }, [visible]);
  const [placement, setPlacement] = useState({ status: SERVER_MODE ? 'loading' : 'off', result: null });
  useEffect(() => {
    if (!SERVER_MODE || !walletKey) return undefined;
    let stopped = false;
    loadPlacementPreview(optionsRef.current)
      .then(result => { if (!stopped) setPlacement({ status: result ? 'ready' : 'off', result }); })
      .catch(() => { if (!stopped) setPlacement(previous => previous.result ? previous : { status: 'failed', result: null }); });
    return () => { stopped = true; };
  }, [walletKey, opened]);
  return placement;
}

export default function QuickPaySheet({ visible, cards = [], cardId, context, autoOn = true, onSelectCard, onClose, onOpenDetails, onPaid }) {
  const options = useMemo(() => realWalletCards(cards.find(card => card.id === cardId), cards), [cards, cardId]);
  const selected = options.find(card => card.id === cardId) || options[0];
  // 결제 카드 아래 '선정 이유' (2026-11-24 팀 결정 '맞을 때만 보이기'): 규칙은 utils/cardReasonCore.js
  const [pickedId, setPickedId] = useState(null);   // 이 결제 창에서 직접 바꾼 카드
  const placement = usePlacementPreview(options, visible);
  const baseline = options.find(item => item.id !== selected?.id) || selected;
  const { scenario, selectedBenefit } = useBenefitEstimate({ options, selected, baseline, placement });
  const reasonBenefit = scenario?.aiExample && Number.isFinite(selectedBenefit?.value) && selectedBenefit.value > 0
    ? scenario.merchant + '에서 ' + reward(selectedBenefit) + ' 혜택' : '';
  const reasonText = cardReason({
    selectedId: selected?.id,
    ai: placement.status === 'ready' ? placement.result : null,
    autoOn,
    pickedHere: pickedId != null && pickedId === selected?.id,
    fromSchedule: Boolean(context?.title),
    benefit: reasonBenefit,
    cardName: selected?.name,
  });
  const [code, setCode] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [picking, setPicking] = useState(false);
  const [receipt, setReceipt] = useState(null);   // 결제가 끝나면 { merchantName, amount, totalDiscount, ... }
  const sequence = useRef(0);
  const codeRef = useRef(null);       // 지금 보여 주는 코드 (닫을 때 서버 코드 취소용)
  const finished = useRef(null);      // 결과를 보여 준 코드 번호 (상태 확인이 겹쳐도 한 번만)
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 위쪽 손잡이를 잡고 내리면 닫는다 (2026-11-24: 폰에서 잡히도록 손잡이 영역을 넓히고, 닫힐 때 아래로 미끄러지게)
  const springBack = () => Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > CLOSE_DISTANCE || gesture.vy > 1.0) {
        Animated.timing(dragY, { toValue: 700, duration: 180, useNativeDriver: false }).start(() => onCloseRef.current?.());
      } else springBack();
    },
    onPanResponderTerminate: springBack,
  })).current;

  const showCode = next => {
    codeRef.current = next;
    setCode(next);
  };

  // 서버 코드를 보여 주다 닫거나 다시 발급하기 전에 취소한다(결제 안 된 코드만, 실패해도 60초면 만료).
  const cancelServerCode = () => {
    const current = codeRef.current;
    codeRef.current = null;
    if (SERVER_MODE && current?.server && finished.current !== current.tokenId) {
      api.cancelPaymentToken(current.tokenId).catch(() => {});
    }
  };

  const finish = (tokenId, result) => {
    if (finished.current === tokenId) return;
    finished.current = tokenId;
    setReceipt(result);
    setError('');
    onPaidRef.current?.(result);
  };

  const issue = async () => {
    if (!selected) return;
    const ticket = ++sequence.current;
    setCode(null);
    codeRef.current = null;
    setReceipt(null);
    setGenerating(true);
    setError('');
    try {
      if (SERVER_MODE) {
        // 서버 모드: 서버가 발급한 코드. 지갑 카드 → 서버 userCardId (다시 발급하면 이전 코드는 서버가 취소한다)
        const userCardId = serverCardLinks()[String(selected.id)];
        if (userCardId === undefined) throw Error('서버에 등록된 카드가 아니라 결제 코드를 받을 수 없어요. 카드 탭에서 다시 불러와 주세요.');
        const res = await api.issuePaymentToken(userCardId);
        if (ticket !== sequence.current) {
          api.cancelPaymentToken(res?.paymentTokenId).catch(() => {});
          return;
        }
        showCode(codeFromServer(res, selected.id));
      } else {
        const value = await makeDemoCode();
        if (ticket !== sequence.current) return;
        showCode({ value, cardId: selected.id, expiresAt: Date.now() + CODE_SECONDS * 1000 });
      }
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
      cancelServerCode();
      setCode(null);
      setReceipt(null);
      setPicking(false);
      setPickedId(null);
      return undefined;
    }
    dragY.setValue(0);
    issue();
    return undefined;
  }, [visible, selected?.id]);

  // 화면이 사라질 때도 결제 안 된 서버 코드는 취소한다.
  useEffect(() => () => cancelServerCode(), []);

  // 서버 모드: 2초마다 코드 상태를 확인해 가상 POS(다른 기기)에서 결제되면 결과를 보여 준다.
  useEffect(() => {
    if (!SERVER_MODE || !visible || !shouldPoll(code, receipt)) return undefined;
    let stopped = false;
    const tokenId = code.tokenId;
    const timer = setInterval(async () => {
      if (stopped || !shouldPoll(codeRef.current, null) || codeRef.current?.tokenId !== tokenId) return;
      try {
        const status = await api.paymentTokenStatus(tokenId);
        if (stopped || status?.status !== 'COMPLETED' || finished.current === tokenId) return;
        const recent = await api.paymentsRecent({ limit: 5 }).catch(() => []);
        if (!stopped) finish(tokenId, receiptFromRecent(recent, status.paymentId));
      } catch {
        // 상태를 못 읽어도 코드는 그대로 보여 준다 (다음 확인 때 다시)
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [visible, code?.tokenId, receipt]);

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
  const paid = Boolean(receipt);

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="결제 닫기" activeOpacity={1} style={s.backdropTouch} onPress={onClose} />
      <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]} accessibilityViewIsModal>
        <View {...pan.panHandlers} style={s.handleArea} accessibilityLabel="아래로 끌어 닫기"><View style={s.handle} /></View>

        {/* 작은 폰(375×667)에서 창이 화면보다 길어 '닫기'·선정 이유가 밖으로 잘렸다 → 창 안을 스크롤 (2026-11-25 점검) */}
        <ScrollView style={s.body} contentContainerStyle={s.bodyContent} bounces={false} keyboardShouldPersistTaps="handled">
        {!selected ? <View style={s.empty}>
          <Text style={s.emptyText}>결제에 사용할 수 있는 카드가 없어요. 카드 탭에서 카드를 등록해주세요.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.close}><Text style={s.closeText}>닫기</Text></TouchableOpacity>
        </View> : <>
          <View style={s.headRow}>
            <Text accessibilityRole="header" style={s.heading}>QR · 바코드 결제</Text>
            <Text style={[s.timer, expired && !paid && s.timerExpired, paid && s.timerPaid]} accessibilityLiveRegion="polite">
              {paid ? '결제 완료' : generating ? '발급 중' : expired ? '만료됨' : `${seconds}초`}
            </Text>
          </View>

          {!picking && <>
          {!!context?.title && <Text style={s.context} numberOfLines={2}>
            📅 {context.title}{context.benefitName ? ' · ' + context.benefitName : ''}
          </Text>}

          {paid ? <View style={s.receipt} accessibilityLiveRegion="polite">
            <View style={s.receiptHead}>
              <Ionicons name="checkmark-circle" size={26} color="#1E8E5A" />
              <Text accessibilityRole="header" style={s.receiptTitle}>결제가 완료됐어요</Text>
            </View>
            {receipt.merchantName ? <Text style={s.receiptMain}>{receipt.merchantName} · {won(receipt.amount)}</Text>
              : <Text style={s.receiptMain}>다른 기기(가상 POS)에서 결제됐어요</Text>}
            <Text style={s.receiptLine}>
              받은 혜택 {won(receipt.totalDiscount)}
              {receipt.benefitAmount > 0 ? ' · 카드 혜택 ' + won(receipt.benefitAmount) + (receipt.benefitName ? ' (' + receipt.benefitName + ')' : '') : ''}
              {receipt.promotionAmount > 0 ? ' · 행사 ' + won(receipt.promotionAmount) : ''}
            </Text>
            {!!receipt.approvalNo && <Text style={s.receiptSub}>승인번호 {receipt.approvalNo}</Text>}
            <Text style={s.receiptSub}>가상 결제라 실제 카드 승인·출금은 없어요. 결제 내역에서 다시 볼 수 있어요.</Text>
          </View> : <>
          <View style={s.codeBox}>
            {generating ? <ActivityIndicator color="#245DE5" style={s.loading} />
              : code ? <Codes value={code.value} inactive={expired} /> : null}
          </View>
          {/* 서버 모드의 '가상 결제용 코드예요…' 안내는 뺀다 (2026-11-24 팀 피드백). 서버 없는 예시 모드만 안내 */}
          {!SERVER_MODE && <Text style={s.notice}>QR·바코드는 예시이며 실제 결제에 사용할 수 없어요.</Text>}
          </>}
          {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

          <View style={s.actions}>
            <TouchableOpacity accessibilityRole="button" disabled={generating} onPress={issue} style={[s.secondary, generating && s.dim]}>
              <Ionicons name="refresh" size={16} color="#245DE5" />
              <Text style={s.secondaryText}>{paid ? '새 결제 코드 받기' : expired ? '새 코드 받기' : '코드 다시 발급'}</Text>
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
          {!picking && !paid && !!reasonText && <View style={s.reason}>
            <Ionicons name="bulb-outline" size={14} color="#B26A00" />
            <Text style={s.reasonText} numberOfLines={2}><Text style={s.reasonHead}>선정 이유 </Text>{reasonText}</Text>
          </View>}

          {/* 카드를 고르는 동안에는 QR 대신 카드 목록을 보여줍니다. */}
          {picking && <ScrollView style={s.pickList} contentContainerStyle={s.pickContent} nestedScrollEnabled>
            {options.filter(card => card.id !== selected.id).map(card => <TouchableOpacity key={card.id} accessibilityRole="button"
                onPress={() => { setPicking(false); setPickedId(card.id); onSelectCard?.(card.id); }} style={s.pickRow}>
              {!!card.image && <Image source={typeof card.image === 'string' ? { uri: card.image } : card.image} resizeMode="contain" style={s.pickImage} />}
              <Text style={s.pickName} numberOfLines={1}>{card.name}</Text>
            </TouchableOpacity>)}
          </ScrollView>}

          <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.close}><Text style={s.closeText}>닫기</Text></TouchableOpacity>
        </>}
        </ScrollView>
      </Animated.View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '82%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24 },
  body: { flexShrink: 1 },
  bodyContent: { gap: 12 },
  // 손잡이 둘레를 넓게(시트 폭 전체·높이 약 36px) 잡을 수 있게
  handleArea: { alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', marginHorizontal: -20, paddingTop: 14, paddingBottom: 14, marginBottom: -10 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D3DBE7' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '800', color: '#14213D' },
  timer: { fontSize: 18, fontWeight: '800', color: '#245DE5' },
  timerExpired: { color: '#C53D56' },
  timerPaid: { color: '#1E8E5A' },
  receipt: { borderRadius: 16, backgroundColor: '#F1FAF5', borderWidth: 1, borderColor: '#CDEBDB', padding: 16, gap: 6 },
  receiptHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  receiptTitle: { fontSize: 17, fontWeight: '800', color: '#16324F' },
  receiptMain: { fontSize: 16, fontWeight: '700', color: '#16324F' },
  receiptLine: { fontSize: 14, lineHeight: 20, color: '#1E5E3F', fontWeight: '600' },
  receiptSub: { fontSize: 12, lineHeight: 18, color: '#5A6E89' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, backgroundColor: '#F4F7FF' },
  cardImage: { width: 56, height: 36 },
  cardInfo: { flex: 1, gap: 2 },
  cardLabel: { fontSize: 11, color: '#687B97', fontWeight: '600' },
  cardName: { fontSize: 15, color: '#14213D', fontWeight: '700' },
  change: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  changeText: { color: '#245DE5', fontSize: 13, fontWeight: '700' },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: -4, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFF9EC', borderWidth: 1, borderColor: '#F6E3B5' },
  reasonText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#33445F' },
  reasonHead: { fontWeight: '800', color: '#B26A00' },
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
