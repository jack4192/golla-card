import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Alert } from '../utils/demoAlert';
import { Ionicons } from '@expo/vector-icons';
import { selectionFeedback, successFeedback, makePaymentScreenBright } from '../utils/deviceFeatures';
import DemoConfetti from '../components/DemoConfetti';
import { DEMO_WALLET_CARDS } from '../data/cards';

const PAYMENT_SECONDS = 180;
// 기존 결제 완료 화면의 예시 금액. 실제 결제 데이터가 아님.
const DEMO_RECEIPT_AMOUNT = 9500;
const DEFAULT_CARD_IDS = new Set(DEMO_WALLET_CARDS.map((item) => item.id));

// 추천만 받은 카드는 결제 시연 대상에서 제외.
const canPayInDemo = (item) =>
  Boolean(item?.id) &&
  item.isRecommendedOnly !== true &&
  (DEFAULT_CARD_IDS.has(item.id) || item.isOwned === true);

const formatWon = (value) => `${value.toLocaleString('ko-KR')}원`;

export default function PaymentScreen({
  onClose,
  card,
  cards = DEMO_WALLET_CARDS,
  onSelectCard,
}) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [paidCardName, setPaidCardName] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_SECONDS);
  const deadlineRef = useRef(Date.now() + PAYMENT_SECONDS * 1000);

  // App.js와 MainScreen.js에서 관리하는 지갑을 그대로 활용.
  const wallet = useMemo(() => {
    const source = Array.isArray(cards) && cards.length > 0 ? cards : DEMO_WALLET_CARDS;
    const unique = new Map();

    [...source, card].forEach((item) => {
      if (canPayInDemo(item) && !unique.has(item.id)) {
        unique.set(item.id, item);
      }
    });

    return [...unique.values()];
  }, [cards, card]);

  const [selectedCardId, setSelectedCardId] = useState(
    canPayInDemo(card) ? card.id : null
  );

  // 홈 지갑/카드 탭에서 카드가 변경되면 결제 카드도 동기화.
  useEffect(() => {
    if (canPayInDemo(card)) {
      setSelectedCardId(card.id);
    } else {
      setSelectedCardId((previous) =>
        wallet.some((item) => item.id === previous)
          ? previous
          : wallet[0]?.id ?? null
      );
    }
  }, [card?.id, wallet]);

  const selectedCard =
    wallet.find((item) => item.id === selectedCardId) ||
    wallet[0] ||
    null;

  const isRecommendationOnly =
    Boolean(card?.id) && !canPayInDemo(card);

  const resetTimer = () => {
    deadlineRef.current = Date.now() + PAYMENT_SECONDS * 1000;
    setSecondsLeft(PAYMENT_SECONDS);
  };

  const chooseCard = (item) => {
    if (!canPayInDemo(item)) return;

    setSelectedCardId(item.id);
    setPickerVisible(false);
    setIsPaid(false);
    resetTimer();
    onSelectCard?.(item.id);
    selectionFeedback();
  };

  // Native uses brightness/haptics; web runs without requesting unsupported permissions.
  useEffect(() => {
    successFeedback();
    let cancelled = false;
    let restore = () => {};
    makePaymentScreenBright().then((cleanup) => {
      if (cancelled) cleanup();
      else restore = cleanup;
    }).catch(() => {});
    return () => { cancelled = true; restore(); };
  }, []);

  // 기존 바코드 유효시간 3분 유지.
  useEffect(() => {
    if (isPaid) return;
    const timer = setInterval(() => {
      const remaining = Math.ceil((deadlineRef.current - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, remaining));
    }, 500);
    return () => clearInterval(timer);
  }, [isPaid]);

  const simulatePayment = () => {
    if (!selectedCard) {
      Alert.alert('결제 카드 선택', '먼저 결제 시연에 사용할 카드를 선택해주세요.');
      return;
    }
    if (secondsLeft <= 0) {
      Alert.alert('유효시간 만료', '바코드 유효시간을 다시 시작해주세요.');
      return;
    }

    // 결제 완료 시점의 카드명을 고정해 영수증에 표시.
    setPaidCardName(selectedCard.name);
    setIsPaid(true);
    successFeedback();
  };

  const timerLabel = `${String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerTitleRow}>
          <Text style={styles.headerTitle}>SOL 스마트 결제</Text>
          <Text style={styles.demoTag}>DEMO</Text>
        </View>
        <TouchableOpacity
          accessibilityLabel="결제 화면 닫기"
          onPress={onClose}
          style={styles.headerClose}
        >
          <Ionicons name="close" size={25} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
      >
        {isRecommendationOnly && (
          <View style={styles.noticeBanner}>
            <Ionicons name="information-circle-outline" size={19} color="#946321" />
            <Text style={styles.noticeText}>
              '{card.name}'은 AI 추천 후보예요. 결제 시연에는 데모 지갑의 보유 카드만 사용할 수 있어요.
            </Text>
          </View>
        )}

        {/* 결제 카드, 바코드, QR이 첫 화면에 바로 노출됩니다. */}
        <View style={styles.payPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>결제 · 바코드 · QR</Text>
            <TouchableOpacity
              style={styles.changeButton}
              onPress={() => setPickerVisible(true)}
              accessibilityLabel="결제 카드 변경"
            >
              <Ionicons name="swap-horizontal" size={17} color="#225DE1" />
              <Text style={styles.changeButtonText}>카드 변경</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.cardPreview, { backgroundColor: selectedCard?.color || '#215DE5' }]}
            onPress={() => setPickerVisible(true)}
            activeOpacity={0.88}
            accessibilityLabel="현재 카드, 눌러서 결제 카드 변경"
          >
            <View style={styles.cardPreviewTop}>
              <Text style={[styles.cardCaption, { color: selectedCard?.textColor || '#FFFFFF' }]}>
                현재 결제 카드
              </Text>
              <Ionicons name="chevron-down" color={selectedCard?.textColor || '#FFFFFF'} size={19} />
            </View>
            <View style={styles.cardPreviewInfo}>
              {selectedCard?.image ? (
                <Image source={selectedCard.image} resizeMode="contain" style={styles.cardImage} />
              ) : (
                <Ionicons name="card" size={34} color={selectedCard?.textColor || '#FFFFFF'} />
              )}
              <View style={styles.cardNameArea}>
                <Text
                  numberOfLines={2}
                  style={[styles.cardName, { color: selectedCard?.textColor || '#FFFFFF' }]}
                >
                  {selectedCard?.name || '선택 가능한 카드 없음'}
                </Text>
                <Text style={[styles.cardNumber, { color: selectedCard?.textColor || '#FFFFFF' }]}>
                  {selectedCard?.number || '—'}
                </Text>
              </View>
            </View>
          </TouchableOpacity>

          <View style={styles.timerRow}>
            <Ionicons name="time-outline" size={17} color="#C75143" />
            <Text style={styles.timerLabel}>바코드 남은 시간</Text>
            <Text style={styles.timerValue}>{timerLabel}</Text>
          </View>

          {secondsLeft === 0 ? (
            <TouchableOpacity style={styles.expired} onPress={resetTimer}>
              <Ionicons name="refresh" size={20} color="#225DE1" />
              <Text style={styles.expiredText}>유효시간 만료 · 새로 시작</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.codePanel}>
              <Text style={styles.barcode} numberOfLines={1} adjustsFontSizeToFit>
                |||||| || ||| | ||| |||
              </Text>
              <Text style={styles.barcodeDigits}>8813 1790 3132 8742</Text>
              <View style={styles.qrBox}>
                <Ionicons name="qr-code-outline" size={63} color="#23334D" />
              </View>
              <Text style={styles.codeHint}>시연용 표시 · 실제 스캔 결제 불가</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.payButton, (!selectedCard || secondsLeft === 0) && styles.disabledButton]}
            onPress={simulatePayment}
            disabled={!selectedCard || secondsLeft === 0}
            accessibilityLabel="시연용 결제 승인"
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#FFFFFF" />
            <Text style={styles.payButtonText}>시연용 결제 승인</Text>
          </TouchableOpacity>
        </View>

        {/* 결제 외 데이터 입력은 AI 연동 전까지 제공하지 않습니다. */}
        <View style={styles.aiInfo}>
          <Ionicons name="sparkles-outline" color="#315FB9" size={21} />
          <View style={styles.aiInfoBody}>
            <Text style={styles.aiInfoTitle}>SOL AI 자동 혜택 분석</Text>
            <Text style={styles.aiInfoText}>
              결제금액과 전월 실적은 추후 AI·마이데이터 연동 시 자동으로 확인할 예정이에요. 지금은 결제 흐름만 시연합니다.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* 기존 카드 직접 변경 기능 유지 */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <View style={styles.dim}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>결제 카드 선택</Text>
              <TouchableOpacity
                accessibilityLabel="카드 선택 닫기"
                onPress={() => setPickerVisible(false)}
              >
                <Ionicons name="close" size={25} color="#2A3B58" />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetDescription}>
              데모 지갑에 있는 카드 중 결제에 사용할 카드를 골라주세요.
            </Text>
            <ScrollView style={styles.cardsScroll} showsVerticalScrollIndicator={false}>
              {wallet.map((item) => {
                const active = selectedCard?.id === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.choiceRow, active && styles.choiceRowActive]}
                    onPress={() => chooseCard(item)}
                  >
                    <View style={[styles.choiceColor, { backgroundColor: item.color || '#245DDD' }]}>
                      <Ionicons name="card-outline" size={23} color={item.textColor || '#FFFFFF'} />
                    </View>
                    <View style={styles.choiceInfo}>
                      <Text style={styles.choiceName} numberOfLines={2}>{item.name}</Text>
                      <Text style={styles.choiceNumber}>
                        {item.number || '데모 카드'} · {item.pdfVerified ? 'PDF 시연 카드' : '데모 보유 카드'}
                      </Text>
                    </View>
                    <Ionicons
                      name={active ? 'checkmark-circle' : 'ellipse-outline'}
                      size={23}
                      color={active ? '#245DDD' : '#B6C1D0'}
                    />
                  </TouchableOpacity>
                );
              })}
              {wallet.length === 0 && <Text style={styles.emptyText}>선택 가능한 카드가 없어요.</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 결제 완료: 기존 애니메이션 유지, AI 혜택 추정값은 표시하지 않음 */}
      <Modal visible={isPaid} transparent animationType="slide" onRequestClose={onClose}>
        <View style={styles.receiptDim}>
          {isPaid && (
            <DemoConfetti
              count={120}
              origin={{ x: 180, y: 0 }}
              fadeOut
              fallSpeed={2500}
            />
          )}
          <View style={styles.receipt}>
            <Ionicons name="checkmark-circle" color="#245DDD" size={54} />
            <Text style={styles.receiptTitle}>시연용 결제 완료!</Text>
            <Text style={styles.receiptAmount}>{formatWon(DEMO_RECEIPT_AMOUNT)}</Text>
            <Text style={styles.receiptExample}>시연 예시 금액 · 실제 결제 내역 아님</Text>
            <View style={styles.receiptDivider} />
            <Text style={styles.receiptKey}>결제 선택 카드</Text>
            <Text style={styles.receiptCard}>{paidCardName || selectedCard?.name || '미선택'}</Text>
            <Text style={styles.receiptNotice}>
              결제금액과 카드 실적은 향후 AI 연동 시 자동 조회할 예정이에요. 실제 승인·청구·적립은 발생하지 않았습니다.
            </Text>
            <TouchableOpacity style={styles.receiptClose} onPress={onClose}>
              <Text style={styles.receiptCloseText}>홈으로 돌아가기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FC' },
  header: {
    height: 58, backgroundColor: '#173E8B', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18,
  },
  headerTitleRow: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '900' },
  demoTag: {
    color: '#DDE9FF', fontSize: 10, borderWidth: 1,
    borderColor: '#90B6F7', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3,
  },
  headerClose: { padding: 5 },
  scroll: { flex: 1 },
  body: { padding: 16, paddingBottom: 30 },
  noticeBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 9,
    backgroundColor: '#FFF7E9', borderColor: '#F0D9B3',
    borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 12,
  },
  noticeText: { color: '#835C26', flex: 1, fontSize: 11, lineHeight: 17 },
  payPanel: {
    backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#E3EAF5',
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  panelTitle: { fontSize: 16, fontWeight: '900', color: '#243550' },
  changeButton: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 4 },
  changeButtonText: { color: '#225DE1', fontSize: 12, fontWeight: '800' },
  cardPreview: { borderRadius: 14, padding: 16, minHeight: 106, marginBottom: 15 },
  cardPreviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardCaption: { fontSize: 11, fontWeight: '700', opacity: 0.86 },
  cardPreviewInfo: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  cardImage: { width: 55, height: 55 },
  cardNameArea: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '900' },
  cardNumber: { fontSize: 12, fontWeight: '600', marginTop: 5 },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  timerLabel: { flex: 1, fontSize: 12, color: '#6D7990' },
  timerValue: { color: '#C75143', fontWeight: '900', fontSize: 13 },
  codePanel: {
    borderWidth: 1, borderColor: '#E4EAF4', borderRadius: 13,
    paddingVertical: 15, paddingHorizontal: 10, alignItems: 'center',
  },
  barcode: { fontSize: 34, letterSpacing: -1, fontWeight: '900', color: '#1A2B43' },
  barcodeDigits: { color: '#283A55', fontWeight: '800', fontSize: 13, letterSpacing: 1, marginTop: 5 },
  qrBox: {
    width: 92, height: 92, borderWidth: 1.5, borderColor: '#D4DCE8',
    alignItems: 'center', justifyContent: 'center', marginTop: 14, borderRadius: 9,
  },
  codeHint: { color: '#97A3B4', fontSize: 10, marginTop: 10, textAlign: 'center' },
  expired: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 180 },
  expiredText: { color: '#225DE1', fontWeight: '800', fontSize: 13 },
  payButton: {
    marginTop: 15, backgroundColor: '#245DDD', borderRadius: 13,
    paddingVertical: 15, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8,
  },
  disabledButton: { opacity: 0.4 },
  payButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 15 },
  aiInfo: {
    flexDirection: 'row', gap: 11, backgroundColor: '#EAF2FF',
    marginTop: 14, padding: 15, borderRadius: 14,
  },
  aiInfoBody: { flex: 1 },
  aiInfoTitle: { color: '#2457AC', fontSize: 13, fontWeight: '900' },
  aiInfoText: { color: '#5875A4', fontSize: 11, lineHeight: 18, marginTop: 5 },
  dim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    maxHeight: '82%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24,
    borderTopRightRadius: 24, padding: 20,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: '#1F3250' },
  sheetDescription: { fontSize: 12, lineHeight: 18, color: '#7D8A9E', marginTop: 8, marginBottom: 15 },
  cardsScroll: { maxHeight: 420 },
  choiceRow: {
    flexDirection: 'row', gap: 11, alignItems: 'center', padding: 11,
    borderRadius: 12, borderWidth: 1, borderColor: '#E4EAF4', marginBottom: 9,
  },
  choiceRowActive: { backgroundColor: '#F0F5FF', borderColor: '#245DDD' },
  choiceColor: { width: 58, height: 40, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  choiceInfo: { flex: 1 },
  choiceName: { fontSize: 13, color: '#23364F', fontWeight: '800' },
  choiceNumber: { fontSize: 10, color: '#8291A6', marginTop: 5 },
  emptyText: { color: '#8B96A8', textAlign: 'center', padding: 22 },
  receiptDim: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.62)', padding: 22 },
  receipt: { width: '100%', padding: 24, borderRadius: 23, backgroundColor: '#FFFFFF', alignItems: 'center' },
  receiptTitle: { color: '#253B5E', fontWeight: '900', fontSize: 18, marginTop: 9 },
  receiptAmount: { color: '#172E53', fontWeight: '900', fontSize: 31, marginTop: 8 },
  receiptExample: { color: '#9BA7B6', fontSize: 10, marginTop: 3 },
  receiptDivider: { width: '100%', height: 1, backgroundColor: '#E5EBF3', marginVertical: 18 },
  receiptKey: { color: '#8895A9', fontSize: 11 },
  receiptCard: { color: '#234F9C', fontSize: 15, fontWeight: '800', marginTop: 7, textAlign: 'center' },
  receiptNotice: { fontSize: 11, color: '#8C99A9', lineHeight: 18, textAlign: 'center', marginVertical: 19 },
  receiptClose: { width: '100%', backgroundColor: '#18324E', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  receiptCloseText: { fontSize: 14, color: '#FFFFFF', fontWeight: '900' },
});
