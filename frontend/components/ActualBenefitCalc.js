// 업종과 결제 금액을 직접 넣어 이 카드의 혜택을 계산한다.
// - 서버 모드: AI 엔진 계산(이번 달 실적·한도·행사 반영). AI 가 답하지 못하면, 데모 모드: 앱 계산(결제 화면과 같은 estimatePayment).
// - 내 다른 카드가 더 많이 주면 그 카드도 알려 준다.
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { estimatePayment, realWalletCards, reward, won } from '../screens/PaymentScreen';
import { makeSchedulePaymentScenario, typicalAmount } from '../utils/schedulePayment';
import { loadAiEstimates } from '../utils/aiEstimate';
import { SERVER_MODE } from '../utils/api';

// 고를 수 있는 업종 (schedulePayment 의 예시 업종). 마트는 쇼핑 업종 중 대형마트로 계산한다
const CATEGORIES = [
  { key: 'cafe', label: '카페', icon: 'cafe-outline' },
  { key: 'convenience', label: '편의점', icon: 'storefront-outline' },
  { key: 'restaurant', label: '음식점', icon: 'restaurant-outline' },
  { key: 'transport', label: '교통', icon: 'bus-outline' },
  // 마트: 앱 계산은 쇼핑 업종의 대형마트 혜택, AI 계산은 실제 가맹점 '이마트'로 묻는다 (업종 코드만 보내면 대형마트 혜택이 안 잡힘)
  { key: 'mart', label: '마트', icon: 'cart-outline', schedule: { category: 'shopping', benefitName: '대형마트' }, aiMerchant: '이마트', aiCategory: 'MART' },
  { key: 'delivery', label: '배달', icon: 'bicycle-outline' },
  { key: 'fuel', label: '주유', icon: 'car-outline' },
  { key: 'medical', label: '병원·약국', icon: 'medkit-outline' },
];
const MAX_AMOUNT = 10000000;
const digits = text => String(text || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
const comma = text => (text ? Number(text).toLocaleString('ko-KR') : '');

export default function ActualBenefitCalc({ card, cards, onClose }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState(String(typicalAmount(CATEGORIES[0].key)));
  const [result, setResult] = useState(null);     // { benefit, best, bestCard, source, merchant, amount }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(0);
  const options = useMemo(() => realWalletCards(card, cards), [card, cards]);
  const selected = options.find(item => item.id === card?.id) || options[0];

  const pick = next => {
    setCategory(next);
    setAmount(String(typicalAmount(next.schedule?.category || next.key)));
    setResult(null);
    setError('');
  };
  const calculate = async () => {
    const value = Number(amount);
    if (!selected) { setError('등록된 카드가 없어요.'); return; }
    if (!value || value > MAX_AMOUNT) { setError('결제 금액을 1원 ~ 1,000만 원 사이로 넣어 주세요.'); return; }
    const base = makeSchedulePaymentScenario(category.schedule || { category: category.key });
    if (!base) { setError('이 업종은 아직 계산할 수 없어요.'); return; }
    const scenario = { ...base, id: 'actual:' + category.key + ':' + value, amount: value };
    const ticket = ++run.current;
    setBusy(true);
    setError('');
    try {
      const aiScenario = category.aiMerchant
        ? { id: scenario.id + ':' + category.aiMerchant, merchant: category.aiMerchant, namedMerchant: true, categoryCode: category.aiCategory, amount: value }
        : scenario;
      const aiRows = SERVER_MODE ? await loadAiEstimates(aiScenario) : null;
      if (ticket !== run.current) return;
      const now = new Date();
      const rows = options.map(item => ({ card: item, benefit: aiRows?.[item.id] || estimatePayment(item, scenario, true, now) }));
      const mine = rows.find(row => row.card.id === selected.id)?.benefit;
      const better = rows.filter(row => row.card.id !== selected.id && Number.isFinite(row.benefit?.value)
        && (!Number.isFinite(mine?.value) || row.benefit.value > mine.value))
        .sort((a, b) => b.benefit.value - a.benefit.value)[0];
      setResult({ benefit: mine, better, ai: Boolean(aiRows), merchant: aiRows && category.aiMerchant ? category.aiMerchant : scenario.merchant, amount: value });
    } catch {
      if (ticket === run.current) setError('계산하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (ticket === run.current) setBusy(false);
    }
  };

  const known = Number.isFinite(result?.benefit?.value);
  return <View style={s.panel}>
    <View style={s.head}>
      <Text accessibilityRole="header" style={s.title}>실제 혜택 계산하기</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="실제 혜택 계산 닫기" hitSlop={10}
        onPress={() => { run.current += 1; onClose(); }}>
        <Ionicons name="close" size={20} color="#4A5A75" />
      </TouchableOpacity>
    </View>
    <Text style={s.caption}>{selected ? selected.name + '로 결제했을 때' : ''}</Text>

    <Text style={s.label}>어디서 결제하나요?</Text>
    <View style={s.chips}>
      {CATEGORIES.map(item => {
        const active = item.key === category.key;
        return <TouchableOpacity key={item.key} accessibilityRole="radio" accessibilityState={{ selected: active }}
          onPress={() => pick(item)} style={[s.chip, active && s.chipActive]}>
          <Ionicons name={item.icon} size={14} color={active ? '#FFFFFF' : '#1D55D9'} />
          <Text style={[s.chipText, active && s.chipTextActive]}>{item.label}</Text>
        </TouchableOpacity>;
      })}
    </View>

    <Text style={s.label}>얼마를 결제하나요?</Text>
    <View style={s.amountRow}>
      <TextInput accessibilityLabel="결제 금액" value={comma(amount)} keyboardType="number-pad" inputMode="numeric"
        onChangeText={text => { setAmount(digits(text)); setResult(null); setError(''); }}
        onSubmitEditing={calculate} returnKeyType="done" placeholder="예: 15,000" placeholderTextColor="#8A97AA" style={s.input} />
      <Text style={s.won}>원</Text>
    </View>

    <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={calculate} style={[s.calcButton, busy && s.dim]}>
      {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.calcText}>계산하기</Text>}
    </TouchableOpacity>

    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {result && <View accessibilityLiveRegion="polite" style={s.result}>
      <Text style={s.resultHead}>{result.merchant} · {won(result.amount)} 결제</Text>
      <Text style={[s.resultAmount, !known && s.resultUnknown]}>{known ? reward(result.benefit) + ' 혜택' : '혜택 조건 확인 필요'}</Text>
      {!known && !!result.benefit?.reason && <Text style={s.resultNote}>{result.benefit.reason}</Text>}
      {known && !!result.benefit?.name && <Text style={s.resultNote}>{result.benefit.name}</Text>}
      {result.better && <Text style={s.better}>
        내 카드 중 {result.better.card.name}이(가) {reward(result.better.benefit)}로 더 많이 줘요
      </Text>}
      <Text style={s.basis}>{result.ai ? '이번 달 실적·한도와 진행 중인 행사를 반영했어요.' : '카드 혜택 규칙으로 계산한 값이에요. 실적·한도에 따라 달라질 수 있어요.'}</Text>
    </View>}
  </View>;
}

const s = StyleSheet.create({
  panel: { alignSelf: 'stretch', marginTop: 10, padding: 14, gap: 8, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DCE6FA' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '800', color: '#13254A' },
  caption: { fontSize: 12, color: '#5A6E89', marginTop: -4 },
  label: { marginTop: 4, fontSize: 13, fontWeight: '800', color: '#29456B' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, minHeight: 34, borderRadius: 17, backgroundColor: '#EDF3FF' },
  chipActive: { backgroundColor: '#1D55D9' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#1D55D9' },
  chipTextActive: { color: '#FFFFFF' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#D9E5F7',
    backgroundColor: '#F8FAFF', color: '#13254A', fontSize: 18, fontWeight: '800', textAlign: 'right',
  },
  won: { fontSize: 16, fontWeight: '800', color: '#29456B' },
  calcButton: { marginTop: 4, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#104FE7' },
  calcText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  dim: { opacity: 0.5 },
  error: { fontSize: 13, fontWeight: '700', color: '#B4384D', textAlign: 'center' },
  result: { marginTop: 4, padding: 14, gap: 4, borderRadius: 14, backgroundColor: '#F3F7FF', alignItems: 'center' },
  resultHead: { fontSize: 12, fontWeight: '700', color: '#4A5A75' },
  resultAmount: { fontSize: 26, fontWeight: '900', color: '#1D55D9' },
  resultUnknown: { fontSize: 17 },
  resultNote: { fontSize: 12, color: '#4A5A75', textAlign: 'center' },
  better: { marginTop: 2, fontSize: 13, fontWeight: '800', color: '#0E7A4F', textAlign: 'center' },
  basis: { marginTop: 2, fontSize: 11, color: '#7A889C', textAlign: 'center' },
});
