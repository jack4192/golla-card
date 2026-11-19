import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { matchesScheduleBenefit } from '../utils/schedulePayment';

const filters = [
  { id: 'convenience', label: 'CU', merchant: /\bCU\b|씨유/i },
  { id: 'cafe', label: '카페' },
  { id: 'restaurant', label: '외식' },
  { id: 'shopping', label: '장보기·쇼핑' },
  { id: 'transport', label: '교통' },
];
const won = amount => amount.toLocaleString('ko-KR') + '원';

function summarize(card, filter) {
  const categoryRows = card.benefits.filter(benefit => (
    matchesScheduleBenefit(benefit.name, filter.id) || filter.merchant?.test(benefit.name)
  ));
  const benefit = filter.merchant
    ? categoryRows.find(row => filter.merchant.test(row.name) || row.note?.split('\n').some(line => line.startsWith('대상 ') && filter.merchant.test(line)))
    : categoryRows[0];

  const tiers = (benefit?.note || '').split('\n').flatMap(line => {
    const match = /^전월 ([\d,]+)원 이상 · ([\d,.]+(?:%|원|P))(?: · |$)/.exec(line);
    return match ? [{ spend: Number(match[1].replace(/,/g, '')), amount: match[2], line }] : [];
  });
  tiers.sort((a, b) => a.spend - b.spend);
  const tier = tiers[0];
  const cap = tier?.line.match(/(?:^| · )월 혜택 한도 ([\d,]+(?:원|P))(?: · |$)/)?.[1];
  return {
    benefit: benefit?.name || '대상 혜택 확인 필요',
    amount: tier?.amount || '상품 조건 확인',
    spend: tier ? tier.spend > 0 ? won(tier.spend) + ' 이상' : '실적 조건 없음' : '조건 확인',
    cap: cap || '상세 조건 확인',
    note: benefit?.note,
  };
}

export default function CardCatalogCompare({ cards, onClose }) {
  const [selection, setSelection] = useState([]);
  const [query, setQuery] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [category, setCategory] = useState(filters[0]);
  const picked = selection.map(code => cards.find(card => card.code === code));
  const visible = cards.filter(card => (card.name + ' ' + card.issuer).toLowerCase().includes(query.trim().toLowerCase()));
  const close = () => showResult ? setShowResult(false) : onClose();

  const toggle = code => setSelection(previous => previous.includes(code)
    ? previous.filter(id => id !== code)
    : previous.length < 2 ? [...previous, code] : previous);

  const results = showResult ? picked.map(card => summarize(card, category)) : [];
  const rows = showResult ? [
    ['국내 연회비', ...picked.map(card => Number.isFinite(card.annualFeeDomestic) ? won(card.annualFeeDomestic) : '조건 확인')],
    ['혜택', ...results.map(row => row.benefit)],
    ['할인·적립', ...results.map(row => row.amount)],
    ['최소 전월 실적', ...results.map(row => row.spend)],
    ['월 혜택 한도', ...results.map(row => row.cap)],
  ] : [];

  return <Modal visible animationType="slide" onRequestClose={close}>
    <View style={s.screen}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel={showResult ? '카드 선택으로 돌아가기' : '상품 비교 닫기'} onPress={close} style={s.icon}>
          <Ionicons name="arrow-back" size={22} color="#164EBE" />
        </Pressable>
        <Text accessibilityRole="header" style={s.title}>{showResult ? '카드 상품 비교' : '비교할 카드 선택'}</Text>
        {showResult && <Pressable accessibilityRole="button" accessibilityLabel="상품 비교 닫기" onPress={onClose} style={s.icon}>
          <Ionicons name="close" size={24} color="#164EBE" />
        </Pressable>}
      </View>

      {!showResult && <View style={s.selectionHeader}>
        <TextInput accessibilityLabel="비교할 카드 검색" onChangeText={setQuery} value={query} placeholder="카드 이름 검색" placeholderTextColor="#536581" style={s.input} />
        <Text style={s.hint}>{picked.length} / 2장 선택</Text>
        {picked.map(card => <Pressable key={card.code} accessibilityRole="button" accessibilityLabel={card.name + ' 선택 해제'} onPress={() => toggle(card.code)} style={s.picked}>
          <Text style={s.link}>{card.name} ×</Text>
        </Pressable>)}
      </View>}

      <ScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {showResult ? <>
          <View style={s.filters}>
            {filters.map(filter => <Pressable key={filter.id} accessibilityRole="button" accessibilityState={{ selected: filter.id === category.id }} onPress={() => setCategory(filter)} style={[s.filter, filter.id === category.id && s.selected]}>
              <Text style={s.link}>{filter.label}</Text>
            </Pressable>)}
          </View>
          <Text style={s.hint}>{category.label} 기준 · 앱 등록 상품 정보 · 최소 실적 구간</Text>
          <View style={s.table}>
            <View style={[s.row, s.tableHeader]}>
              <View style={s.labelCell} />
              {picked.map(card => <View key={card.code} style={s.cell}>
                {!!card.image && <Image source={card.image} resizeMode="contain" style={s.tableImage} accessibilityLabel={card.name + ' 상품 이미지'} />}
                <Text style={s.cardName}>{card.name}</Text>
              </View>)}
            </View>
            {rows.map(([label, ...values]) => <View key={label} style={s.row}>
              <Text style={[s.labelCell, s.cardName]}>{label}</Text>
              {values.map((value, index) => <Text key={picked[index].code} style={s.cell}>{value}</Text>)}
            </View>)}
          </View>
          {results.map((row, index) => row.note ? <View key={picked[index].code} style={s.note}>
            <Text style={s.cardName}>{picked[index].name} 적용 조건</Text>
            <Text style={s.hint}>{row.note}</Text>
          </View> : null)}
        </> : visible.length ? visible.map(card => {
          const checked = selection.includes(card.code);
          const disabled = selection.length === 2 && !checked;
          return <Pressable key={card.code} accessibilityRole="checkbox" accessibilityLabel={card.name} accessibilityState={{ checked, disabled }} disabled={disabled} onPress={() => toggle(card.code)} style={[s.product, checked && s.selected]}>
            <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={23} color="#245DE5" />
            {!!card.image && <Image source={card.image} resizeMode="contain" style={s.listImage} />}
            <Text style={[s.cardName, s.productName]}>{card.name}</Text>
          </Pressable>;
        }) : <Text style={s.hint}>검색 결과가 없어요.</Text>}
      </ScrollView>

      <View style={s.footer}>
        <Pressable accessibilityRole="button" disabled={!showResult && selection.length !== 2}
          onPress={() => setShowResult(!showResult)}
          style={[s.action, !showResult && selection.length !== 2 && s.disabled]}>
          <Text style={s.white}>{showResult ? '다른 카드 선택' : '선택한 카드 ' + selection.length + '장 비교'}</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F7FB' },
  header: { width: '100%', maxWidth: 620, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 6 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 22, fontWeight: '800', color: '#142D4E' },
  selectionHeader: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  input: { borderWidth: 1, borderColor: '#CEDCEE', backgroundColor: '#FFF', padding: 12, borderRadius: 12, minHeight: 44, color: '#142D4E' },
  hint: { fontSize: 13, lineHeight: 20, color: '#536581' },
  picked: { alignSelf: 'flex-start', paddingVertical: 3 },
  link: { color: '#164EBE', fontSize: 13, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 16, gap: 10, paddingBottom: 16 },
  product: { flexDirection: 'row', minHeight: 56, alignItems: 'center', padding: 10, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: '#E0E9F5', backgroundColor: '#FFF' },
  selected: { backgroundColor: '#E3EEFF', borderColor: '#245DE5' },
  productName: { flex: 1 },
  listImage: { width: 45, height: 32 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filter: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10, backgroundColor: '#FFF', borderRadius: 10, borderWidth: 1, borderColor: '#D8E5F7' },
  table: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#DCE7F5', overflow: 'hidden' },
  tableHeader: { backgroundColor: '#E8F1FF' },
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderColor: '#E3EBF7' },
  labelCell: { flexBasis: '25%', paddingVertical: 11, paddingHorizontal: 6 },
  cell: { flex: 1, minWidth: 0, padding: 8, borderLeftWidth: 1, borderColor: '#E3EBF7', fontSize: 13, lineHeight: 20, color: '#142D4E', gap: 6, alignItems: 'center', textAlign: 'center' },
  cardName: { color: '#142D4E', fontWeight: '800', fontSize: 13, lineHeight: 19 },
  tableImage: { width: '100%', maxWidth: 82, height: 48 },
  note: { backgroundColor: '#FFF', padding: 12, borderRadius: 12, gap: 5 },
  footer: { padding: 14, width: '100%', maxWidth: 620, alignSelf: 'center' },
  action: { backgroundColor: '#245DE5', minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.5 },
  white: { color: '#FFF', fontWeight: '800' },
});
