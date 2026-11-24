// 결제할 곳(직접 입력)과 결제 금액을 넣어 이 카드의 혜택을 계산한다 (2026-11-24: 업종 버튼 → 직접 입력).
// - 입력한 말: ① 실제 가맹점 이름이면(스타벅스·이마트·GS25…) 그 가맹점으로 AI 에 묻고,
//   ② 아니면 일정 입력과 같은 업종 분류(typedCategoryIds: 주유소→주유, 카페→카페 …)로 계산한다.
// - 서버 모드: AI 엔진 계산(이번 달 실적·한도·행사 반영). AI 가 답하지 못하면, 데모 모드: 앱 계산(결제 화면과 같은 estimatePayment).
// - 내 다른 카드가 더 많이 주면 그 카드도 알려 준다.
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { estimatePayment, realWalletCards, reward, won } from '../screens/PaymentScreen';
import { makeSchedulePaymentScenario } from '../utils/schedulePayment';
import { isCustomCategory, typedCategoryIds } from '../utils/routineData';
import { loadAiEstimates } from '../utils/aiEstimate';
import { SERVER_MODE } from '../utils/api';

const MAX_AMOUNT = 10000000;
const digits = text => String(text || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 8);
const comma = text => (text ? Number(text).toLocaleString('ko-KR') : '');

export default function ActualBenefitCalc({ card, cards, onClose }) {
  const [place, setPlace] = useState('');      // 결제할 곳 (직접 입력)
  const [amount, setAmount] = useState('');
  const [result, setResult] = useState(null);     // { benefit, best, bestCard, source, merchant, amount }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useRef(0);
  const options = useMemo(() => realWalletCards(card, cards), [card, cards]);
  const selected = options.find(item => item.id === card?.id) || options[0];

  const calculate = async () => {
    const where = place.trim();
    const value = Number(amount);
    if (!selected) { setError('등록된 카드가 없어요.'); return; }
    if (!where) { setError('어디서 결제하는지 적어 주세요. 예: 스타벅스, 주유소'); return; }
    if (!value || value > MAX_AMOUNT) { setError('결제 금액을 1원 ~ 1,000만 원 사이로 넣어 주세요.'); return; }
    // 업종 분류 (일정 입력과 같은 규칙). 마트·쇼핑은 입력한 이름으로 대형마트/온라인몰을 가른다
    const categoryId = typedCategoryIds(where)[0];
    const category = categoryId && !isCustomCategory(categoryId) ? categoryId : null;
    const base = category ? makeSchedulePaymentScenario(category === 'shopping' ? { category, benefitName: where } : { category }) : null;
    const scenario = base ? { ...base, id: 'actual:' + category + ':' + value, amount: value } : null;
    const ticket = ++run.current;
    setBusy(true);
    setError('');
    try {
      let aiRows = null;
      if (SERVER_MODE) {
        // ① 가맹점 이름으로 (이마트는 이마트24(편의점)와 헷갈리지 않게 대형마트로 찾는다)
        const mart = /마트/.test(where) && !/24/.test(where);
        aiRows = await loadAiEstimates({ id: 'actual-place:' + where + ':' + value, merchant: where, namedMerchant: true,
          categoryCode: mart ? 'MART' : undefined, amount: value });
        // ② 업종으로
        if (!aiRows && scenario) aiRows = await loadAiEstimates(scenario);
      }
      if (ticket !== run.current) return;
      if (!aiRows && !scenario) {
        setResult(null);
        setError(`'${where}'이(가) 어떤 곳인지 알 수 없어요. 가맹점 이름(예: 스타벅스)이나 업종(예: 카페, 주유소)으로 적어 주세요.`);
        return;
      }
      const now = new Date();
      const rows = options.map(item => ({ card: item, benefit: aiRows?.[item.id] || (scenario ? estimatePayment(item, scenario, true, now) : null) }));
      const mine = rows.find(row => row.card.id === selected.id)?.benefit;
      const better = rows.filter(row => row.card.id !== selected.id && Number.isFinite(row.benefit?.value)
        && (!Number.isFinite(mine?.value) || row.benefit.value > mine.value))
        .sort((x, y) => y.benefit.value - x.benefit.value)[0];
      setResult({ benefit: mine, better, ai: Boolean(aiRows), merchant: where, amount: value });
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
    <TextInput accessibilityLabel="결제할 곳" value={place} maxLength={30} returnKeyType="next"
      onChangeText={text => { setPlace(text); setResult(null); setError(''); }}
      placeholder="예: 스타벅스, 이마트, 주유소" placeholderTextColor="#8A97AA" style={[s.input, s.placeInput]} />

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
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#D9E5F7',
    backgroundColor: '#F8FAFF', color: '#13254A', fontSize: 18, fontWeight: '800', textAlign: 'right',
  },
  placeInput: { flex: 0, alignSelf: 'stretch', textAlign: 'left', fontSize: 16, fontWeight: '700' },
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
