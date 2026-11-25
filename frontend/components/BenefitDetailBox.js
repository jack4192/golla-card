// '이 거래의 예상 혜택' 상세 상자 (결제 화면 '혜택 자세히 보기', 2026-11-24. 홈 카드 뒷면은 AI 추천 문구 — CardBenefitFlip).
// 값은 useBenefitEstimate(결제 화면) 결과를 그대로 받는다. 가맹점·금액, 예상 혜택, 비교 카드와 그 혜택, 얼마 절약되는지.
// '카드 선정 이유'(why)와 '상세 내역'(details)도 이 상자 안에 합쳐 보여 준다 (2026-11-24).
// status: 추천을 불러오는 중·못 불러옴 같은 한 줄 안내 (없으면 '').
// 모양 (2026-11-24 다듬음): 큰 금액 → 절약 배지 → 이 카드 vs 비교 카드 두 칸 → 고른 이유 → 상세 내역.
// 결제 화면과 서로 불러오지 않도록(순환 import 방지) 금액 모양 함수도 여기 따로 둔다.
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { withParticle } from '../utils/josaCore';

const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const reward = row => (Number.isFinite(row?.value)
  ? Number(row.value).toLocaleString('ko-KR') + (row.unit === 'KRW' ? '원' : row.unit === 'POINT' ? 'P' : ' ' + row.unit)
  : '혜택 조건 확인 필요');

export default function BenefitDetailBox({ scenario, selected, baseline, selectedBenefit, baseBenefit, difference, exampleLine, aiRows, scheduleScenario, why, details, status, style }) {
  const [open, setOpen] = useState(false);
  if (!scenario || !selected || !selectedBenefit) return null;
  const rows = (details || []).filter(Boolean);
  const known = Number.isFinite(selectedBenefit.value);
  const compare = !!baseline && selected.id !== baseline.id;
  const hasDiff = compare && difference !== null && difference !== undefined;
  return <View style={[s.box, style]}>
    <View style={s.head}>
      <Text style={s.eyebrow}>이 거래의 예상 혜택</Text>
      <View style={s.chip}>
        <Ionicons name="storefront-outline" size={12} color="#33445F" />
        <Text style={s.chipText}>{scenario.merchant} · {won(scenario.amount)}</Text>
      </View>
    </View>
    {!!status && <Text accessibilityLiveRegion="polite" style={s.statusLine}>{status}</Text>}

    <View style={s.hero}>
      {!!selectedBenefit.name && <Text style={s.name}>{selectedBenefit.name}</Text>}
      {known
        ? <Text style={s.amount}>{reward(selectedBenefit)}</Text>
        : <View style={s.statusRow}>
            <View style={s.status}><Text style={s.statusText}>조건 확인 필요</Text></View>
            {!!selectedBenefit.reason && <Text style={s.reason}>{selectedBenefit.reason}</Text>}
          </View>}
      {hasDiff && <View style={[s.save, difference > 0 ? s.saveGood : s.saveNeutral]}>
        {difference > 0 && <Ionicons name="trending-up" size={14} color="#0E7A4F" />}
        <Text style={[s.saveText, difference > 0 ? s.saveTextGood : s.saveTextNeutral]}>
          {difference > 0 ? baseline.name + '보다 ' + won(difference) + ' 더 아껴요!'
            : difference === 0 ? withParticle(baseline.name, '와') + ' 혜택이 같아요'
            : withParticle(baseline.name, '로') + ' 결제하면 ' + won(-difference) + ' 더 받을 수 있어요!'}
        </Text>
      </View>}
    </View>

    {/* '이 카드 vs 비교 카드' 두 칸은 뺐다 (2026-11-24 팀 피드백). 비교 결과는 위 배지 한 줄로 */}

    {!!exampleLine && <Text style={s.note}>{exampleLine}</Text>}
    {!!why && <View style={s.why}>
      <View style={s.whyHead}>
        <Ionicons name="bulb-outline" size={15} color="#1D55D9" />
        <Text style={s.whyLabel}>이 카드를 고른 이유</Text>
      </View>
      <Text style={s.whyText}>{why}</Text>
    </View>}
    {rows.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? '예상 혜택 상세 내역 접기' : '예상 혜택 상세 내역 보기'}
        onPress={() => setOpen(value => !value)} style={s.toggle}>
        <Text style={s.toggleText}>{open ? '상세 내역 접기' : '상세 내역 보기'}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color="#1D55D9" />
      </TouchableOpacity>}
    {open && <View style={s.detailBody}>
        {rows.map((row, index) => <View key={index} style={s.detailItem}>
          <View style={s.dot} />
          <Text style={s.detailRow}>{row}</Text>
        </View>)}
      </View>}
    {!aiRows && <Text style={s.foot}>
      {scheduleScenario ? '일정 업종에 맞춘 결제 예시예요. 실제 혜택은 가맹점·실적·잔여 한도에 따라 달라요.'
        : '전월 실적 기록이 없으면 40만 원으로 계산한 예시예요.'}
    </Text>}
  </View>;
}

const s = StyleSheet.create({
  box: { alignSelf: 'stretch', padding: 18, gap: 12, borderRadius: 20, borderWidth: 1, borderColor: '#DCE6FA', backgroundColor: '#FFFFFF' },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { fontSize: 13, fontWeight: '800', color: '#13254A' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#F1F4F9' },
  chipText: { fontSize: 12, fontWeight: '700', color: '#33445F' },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 14, borderRadius: 16, backgroundColor: '#F3F7FF' },
  name: { fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#5A6E89', textAlign: 'center' },
  amount: { fontSize: 34, fontWeight: '900', color: '#1D55D9', letterSpacing: -0.6, textAlign: 'center' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12 },
  status: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: '#FFF4E5' },
  statusText: { fontSize: 12, fontWeight: '800', color: '#B4560F' },
  reason: { flexShrink: 1, fontSize: 12, color: '#5A6E89' },
  save: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14 },
  saveGood: { backgroundColor: '#E3F6EC' },
  saveNeutral: { backgroundColor: '#EEF1F6' },
  saveText: { fontSize: 13, fontWeight: '800' },
  saveTextGood: { color: '#0E7A4F' },
  saveTextNeutral: { color: '#5A6E89' },
  compare: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tile: { flex: 1, minWidth: 0, padding: 12, gap: 2, borderRadius: 14, borderWidth: 1, borderColor: '#E3EAF4', backgroundColor: '#FAFBFD' },
  tileMine: { borderColor: '#B9CCF2', backgroundColor: '#F3F7FF' },
  tileLabel: { fontSize: 11, fontWeight: '700', color: '#7A889C' },
  tileName: { fontSize: 13, fontWeight: '700', color: '#29456B' },
  tileValue: { marginTop: 2, fontSize: 16, fontWeight: '800', color: '#4A5A75' },
  tileValueMine: { color: '#1D55D9' },
  vs: { fontSize: 12, fontWeight: '800', color: '#9AA6B8' },
  note: { fontSize: 12, lineHeight: 18, color: '#5A6E89' },
  why: { padding: 14, gap: 6, borderRadius: 14, backgroundColor: '#FFF9EC', borderWidth: 1, borderColor: '#F6E3B5' },
  whyHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  whyLabel: { fontSize: 13, fontWeight: '800', color: '#1D55D9' },
  whyText: { fontSize: 14, lineHeight: 22, color: '#22324D' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 14, backgroundColor: '#E6EEFF' },
  toggleText: { fontSize: 13, fontWeight: '800', color: '#1D55D9' },
  detailBody: { gap: 8, padding: 14, borderRadius: 14, backgroundColor: '#F7F9FC' },
  detailItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 5, height: 5, marginTop: 8, borderRadius: 3, backgroundColor: '#1D55D9' },
  detailRow: { flex: 1, fontSize: 13, lineHeight: 20, color: '#33445F' },
  foot: { fontSize: 12, lineHeight: 18, color: '#7A889C' },
  statusLine: { fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#5A6E89' },
});
