// 연말 결산: 올해 '내 카드로 아낀 금액'과 월별 절약 내역,
// '그때 카드를 만들었다면?'(추천 카드를 발급하지 않아 놓친 금액)을 아래에서 올라오는 창으로 보여준다.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { readSavingsRecords, summarizeSavings, waitForSavingsWrites } from '../utils/savingsRecords';
import { INDUSTRY_ICONS } from '../utils/routineDetails';
import { isCustomCategory } from '../utils/routineData';

const won = value => Math.round(value || 0).toLocaleString('ko-KR') + '원';
const monthTitle = month => Number(month.slice(5, 7)) + '월';
const dayText = date => Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));
const iconOf = category => (isCustomCategory(category) ? 'pricetag-outline' : INDUSTRY_ICONS[category] || 'card-outline');

// 기록에 남은 추천 이유('특별 일정 · 메가커피 09:00~10:00')에서 장소 이름을 꺼낸다. 없으면 업종 이름.
function placeName(item) {
  const fromReason = String(item.reason || '').match(/^특별 일정 · (.+?)(?:\s+\d{2}:\d{2}~.*)?$/);
  return (fromReason?.[1] || String(item.categoryLabel || '').replace(/'/g, '')).trim();
}

function Row({ item, kind }) {
  const saved = kind === 'saved';
  return <View style={s.row}>
    <View style={s.rowIcon}><Ionicons name={iconOf(item.category)} size={20} color="#3A5A8C" /></View>
    <View style={s.rowText}>
      <Text style={s.rowTitle} numberOfLines={1}>{dayText(item.date)} {placeName(item)}</Text>
      <Text style={s.rowSub} numberOfLines={1}>
        {saved ? `카드 혜택으로 ${won(item.saved)} 절약` : `${String(item.categoryLabel || '').replace(/'/g, '')} ${won(item.amount)} 결제 기준`}
      </Text>
    </View>
    <Text style={[s.rowAmount, saved ? s.plus : s.minusBlue]}>{saved ? '+' : '−'}{won(saved ? item.saved : item.missed)}</Text>
  </View>;
}

// '그때 카드를 만들었다면?' 아래에서 올라오는 창
function MissedSheet({ visible, onClose, missed, items }) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" activeOpacity={1} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={s.sheet} accessibilityViewIsModal>
        <View style={s.handle} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={s.sheetClose}>
          <Ionicons name="close" size={24} color="#1B2C47" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={s.sheetTitle}>그때 카드를 만들었다면?</Text>
        <Text style={s.sheetSub}>아쉽게 놓친 혜택을 확인해보세요.</Text>

        <View style={s.missedBox}>
          <Ionicons name="card-outline" size={36} color="#8C9CB8" />
          <View style={s.flex}>
            <Text style={s.missedLabel}>예상 추가 절약 금액</Text>
            <Text style={s.missedValue}>−{won(missed)}</Text>
          </View>
        </View>

        <Text style={s.sheetSection}>상세 내역</Text>
        <ScrollView style={s.sheetList} contentContainerStyle={s.listCard}>
          {items.length
            ? items.map((item, index) => <View key={item.id}>
                {index > 0 && <View style={s.divider} />}
                <Row item={item} kind="missed" />
              </View>)
            : <Text style={s.empty}>놓친 혜택이 없어요. 추천 카드를 잘 쓰고 계세요!</Text>}
        </ScrollView>

        <View style={s.info}>
          <Ionicons name="information-circle-outline" size={20} color="#5A6E89" />
          <Text style={s.infoText}>해당 시점에 추천된 카드를 발급했다면{'\n'}이만큼 더 절약할 수 있었어요.</Text>
        </View>
      </View>
    </View>
  </Modal>;
}

export default function YearEndReport({ visible, onClose }) {
  const [summary, setSummary] = useState(null);
  const [missedOpen, setMissedOpen] = useState(false);
  useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    setSummary(null);
    setMissedOpen(false);
    waitForSavingsWrites().then(readSavingsRecords).then(records => {
      if (active) setSummary(summarizeSavings(records));
    });
    return () => { active = false; };
  }, [visible]);

  const savedMonths = summary ? summary.months
    .map(([month, items]) => [month, items.filter(item => item.saved > 0)])
    .filter(([, items]) => items.length) : [];
  const missedItems = summary ? summary.months.flatMap(([, items]) => items.filter(item => item.missed > 0)) : [];

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

        {/* 아낀 금액 */}
        <View style={s.savedCard}>
          <View style={s.savedHead}>
            <View style={s.leaf}><Ionicons name="leaf" size={20} color="#22A060" /></View>
            <View>
              <Text style={s.savedTitle}>아낀 금액</Text>
              <Text style={s.savedSub}>{summary.year}년 누적 절약 금액</Text>
            </View>
          </View>
          <View style={s.savedBody}>
            <Text style={s.savedValue} adjustsFontSizeToFit numberOfLines={1}>+{won(summary.saved)}</Text>
            <View style={s.coins} accessible={false}>
              <View style={[s.coin, s.coinBack]} />
              <View style={[s.coin, s.coinMid]} />
              <View style={[s.coin, s.coinFront]}><Text style={s.coinMark}>₩</Text></View>
            </View>
          </View>
        </View>

        {/* 월별 절약 내역 */}
        {savedMonths.length === 0
          ? <View style={s.listCard}><Text style={s.empty}>아직 절약 내역이 없어요. 일정을 추가하고 맞춤 카드를 확인하면 여기에 쌓여요.</Text></View>
          : savedMonths.map(([month, items]) => <View key={month} style={s.listCard}>
              <Text style={s.listTitle}>{monthTitle(month)} 절약 내역</Text>
              {items.map((item, index) => <View key={item.id}>
                {index > 0 && <View style={s.divider} />}
                <Row item={item} kind="saved" />
              </View>)}
            </View>)}

        {/* 그때 카드를 만들었다면? */}
        <TouchableOpacity accessibilityRole="button" onPress={() => setMissedOpen(true)} style={s.whatIf}>
          <View style={s.whatIfIcon}><Ionicons name="card" size={26} color="#3B7BF5" /></View>
          <View style={s.flex}>
            <Text style={s.whatIfTitle}>그때 카드를 만들었다면?</Text>
            <Text style={s.whatIfSub}>놓쳤을 수 있는 추가 혜택을 확인해보세요.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#3A5A8C" />
        </TouchableOpacity>

        <Text style={s.note}>추천 시점의 예상 금액이에요(업종별 예시 결제 금액, 전월 실적 충족 가정). 실제 결제 내역과 다를 수 있어요.</Text>
      </ScrollView>}

      <MissedSheet visible={missedOpen} onClose={() => setMissedOpen(false)} missed={summary?.missed || 0} items={missedItems} />
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8FC' },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1B2C47' },
  loading: { marginTop: 40 },
  content: { padding: 20, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  year: { fontSize: 26, fontWeight: '800', color: '#16305A' },

  savedCard: { backgroundColor: '#E8F6EC', borderRadius: 22, padding: 18, gap: 10 },
  savedHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  leaf: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  savedTitle: { fontSize: 18, fontWeight: '800', color: '#1B2C47' },
  savedSub: { fontSize: 13, color: '#4A5D7A', marginTop: 2 },
  savedBody: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  savedValue: { flex: 1, fontSize: 34, fontWeight: '900', color: '#178A4A' },
  coins: { width: 70, height: 64 },
  coin: { position: 'absolute', width: 52, height: 18, borderRadius: 26, backgroundColor: '#F2C14E', borderWidth: 1, borderColor: '#D9A22E', left: 9 },
  coinBack: { top: 40 },
  coinMid: { top: 30 },
  coinFront: { top: 8, height: 30, width: 46, left: 12, borderRadius: 23, backgroundColor: '#F6CF62', alignItems: 'center', justifyContent: 'center' },
  coinMark: { color: '#B07A12', fontSize: 14, fontWeight: '900' },

  listCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, gap: 4 },
  listTitle: { fontSize: 17, fontWeight: '800', color: '#1B2C47', marginBottom: 6 },
  divider: { height: 1, backgroundColor: '#EEF2F8', marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#F1F5FB', alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '800', color: '#1B2C47' },
  rowSub: { fontSize: 12, color: '#6A7A91' },
  rowAmount: { fontSize: 15, fontWeight: '800' },
  plus: { color: '#178A4A' },
  minusBlue: { color: '#2F5FD8' },
  empty: { fontSize: 13, lineHeight: 20, color: '#6A7A91', textAlign: 'center', paddingVertical: 10 },

  whatIf: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#EAF0FC', borderRadius: 18, padding: 16 },
  whatIfIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  whatIfTitle: { fontSize: 16, fontWeight: '800', color: '#1B2C47' },
  whatIfSub: { fontSize: 12, color: '#4A5D7A', marginTop: 3 },
  note: { fontSize: 11, lineHeight: 17, color: '#8A99AE' },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '85%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingTop: 10, gap: 12 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#D3DBE7', marginBottom: 6 },
  sheetClose: { position: 'absolute', right: 14, top: 18, width: 40, height: 40, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  sheetTitle: { fontSize: 22, fontWeight: '800', color: '#1B2C47', paddingRight: 44 },
  sheetSub: { fontSize: 14, color: '#4A5D7A', marginTop: -6 },
  missedBox: { flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: '#EEF2FC', borderRadius: 18, padding: 18 },
  missedLabel: { fontSize: 14, fontWeight: '700', color: '#1B2C47' },
  missedValue: { fontSize: 30, fontWeight: '900', color: '#2F5FD8', marginTop: 2 },
  sheetSection: { fontSize: 16, fontWeight: '800', color: '#1B2C47', marginTop: 4 },
  sheetList: { flexGrow: 0 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F1F5FB', borderRadius: 14, padding: 14 },
  infoText: { flex: 1, fontSize: 13, lineHeight: 20, color: '#3D5170' },
});
