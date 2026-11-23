// 연말 결산: 카드 추천 기록으로 "올해 아낀 금액 / 놓친 금액"과 월별 추천 내역을 보여줍니다.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { readSavingsRecords, summarizeSavings, waitForSavingsWrites } from '../utils/savingsRecords';

const won = value => Math.round(value || 0).toLocaleString('ko-KR') + '원';
const monthTitle = month => Number(month.slice(5, 7)) + '월';
const dayText = date => Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));

function RecordRow({ item }) {
  const { recommended, ownedBest } = item;
  const missed = item.missed > 0;
  return <View style={s.row}>
    <View style={s.rowHead}>
      <Text style={s.rowDate}>{dayText(item.date)}</Text>
      <Text style={s.rowCategory}>{item.categoryLabel}</Text>
      <Text style={[s.rowAmount, missed ? s.minus : s.plus]}>
        {missed ? '−' + won(item.missed) : item.saved > 0 ? '+' + won(item.saved) : '0원'}
      </Text>
    </View>
    <Text style={s.rowText}>
      {recommended.owned
        ? `내 카드 ${recommended.name}로 ${won(item.saved)} 아꼈어요`
        : missed
          ? `${recommended.name}을(를) 추천했어요. 발급하지 않아 ${won(item.missed)} 못 아꼈어요`
          : `${recommended.name}을(를) 추천했어요`}
    </Text>
    {!recommended.owned && ownedBest && <Text style={s.rowSub}>
      대신 내 카드 {ownedBest.name}로 {won(ownedBest.value)} 혜택
    </Text>}
    <Text style={s.rowSub}>{item.categoryLabel} {won(item.amount)} 결제 기준{item.reason ? ' · ' + item.reason : ''}</Text>
  </View>;
}

export default function YearEndReport({ visible, onClose }) {
  const [summary, setSummary] = useState(null);
  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setSummary(null);
    waitForSavingsWrites().then(readSavingsRecords).then(records => {
      if (active) setSummary(summarizeSavings(records));
    });
    return () => { active = false; };
  }, [visible]);

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={s.headerButton}>
          <Ionicons name="arrow-back" size={24} color="#1B2C47" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={s.headerTitle}>연말 결산</Text>
        <View style={s.headerButton} />
      </View>
      {!summary ? <ActivityIndicator style={s.loading} color="#1459F5" /> : <ScrollView contentContainerStyle={s.content}>
        <Text style={s.year}>{summary.year}년 카드 결산</Text>
        <View style={s.totals}>
          <View style={[s.totalBox, s.savedBox]}>
            <Text style={s.totalLabel}>내 카드로 아낀 금액</Text>
            <Text style={[s.totalValue, s.plus]}>+{won(summary.saved)}</Text>
          </View>
          <View style={[s.totalBox, s.missedBox]}>
            <Text style={s.totalLabel}>추천 카드가 없어 놓친 금액</Text>
            <Text style={[s.totalValue, s.minus]}>−{won(summary.missed)}</Text>
          </View>
        </View>
        {summary.topMissedCard && <View style={s.tip}>
          <Ionicons name="bulb-outline" size={18} color="#B4580B" />
          <Text style={s.tipText}>
            {summary.topMissedCard.name}을(를) 발급했다면 올해 {won(summary.topMissedCard.missed)}을 더 아낄 수 있었어요
            (추천 {summary.topMissedCard.count}번).
          </Text>
        </View>}

        {summary.count === 0 ? <Text style={s.empty}>
          아직 추천 기록이 없어요. 일정을 추가하고 맞춤 카드를 확인하면 여기에 쌓여요.
        </Text> : summary.months.map(([month, items]) => {
          const saved = items.reduce((sum, item) => sum + (item.saved || 0), 0);
          const missed = items.reduce((sum, item) => sum + (item.missed || 0), 0);
          return <View key={month} style={s.month}>
            <View style={s.monthHead}>
              <Text style={s.monthTitle}>{monthTitle(month)}</Text>
              <Text style={s.monthSum}>
                <Text style={s.plus}>+{won(saved)}</Text>{'  '}<Text style={s.minus}>−{won(missed)}</Text>
              </Text>
            </View>
            {items.map(item => <RecordRow key={item.id} item={item} />)}
          </View>;
        })}

        <Text style={s.note}>
          카드를 추천한 시점의 예상 금액이에요(업종별 예시 결제 금액, 전월 실적 충족 가정). 실제 결제 내역과는 다를 수 있어요.
        </Text>
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F7FF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1B2C47' },
  loading: { marginTop: 40 },
  content: { padding: 20, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  year: { fontSize: 24, fontWeight: '800', color: '#16305A' },
  totals: { flexDirection: 'row', gap: 10 },
  totalBox: { flex: 1, borderRadius: 16, padding: 14, gap: 6 },
  savedBox: { backgroundColor: '#E6F6EE' },
  missedBox: { backgroundColor: '#FDECEC' },
  totalLabel: { fontSize: 12, color: '#4A5D7A', fontWeight: '600' },
  totalValue: { fontSize: 22, fontWeight: '800' },
  plus: { color: '#087D54' },
  minus: { color: '#C53D56' },
  tip: { flexDirection: 'row', gap: 8, backgroundColor: '#FFF4E5', borderRadius: 14, padding: 12, alignItems: 'flex-start' },
  tipText: { flex: 1, fontSize: 13, lineHeight: 20, color: '#7A4510' },
  empty: { fontSize: 14, lineHeight: 22, color: '#5A6E89', textAlign: 'center', marginTop: 24 },
  month: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, gap: 10 },
  monthHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthTitle: { fontSize: 17, fontWeight: '800', color: '#1B2C47' },
  monthSum: { fontSize: 13, fontWeight: '700' },
  row: { borderTopWidth: 1, borderTopColor: '#EEF2F8', paddingTop: 10, gap: 3 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowDate: { fontSize: 12, color: '#6A7A91', fontWeight: '700' },
  rowCategory: { flex: 1, fontSize: 13, color: '#243D61', fontWeight: '700' },
  rowAmount: { fontSize: 14, fontWeight: '800' },
  rowText: { fontSize: 13, lineHeight: 19, color: '#243D61' },
  rowSub: { fontSize: 12, lineHeight: 18, color: '#6A7A91' },
  note: { fontSize: 12, lineHeight: 18, color: '#6A7A91', marginTop: 8 },
});
