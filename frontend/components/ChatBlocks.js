// 챗봇 답 아래 표 (2026-11-24 사용자 결정 '앱에서 표 그리기').
// view 모양은 utils/chatBlocks.js 의 chatBlockViews 가 만든다. 결제 화면 챗봇(PaymentBenefitChat)과 홈 챗봇(MainScreen)이 함께 쓴다.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ChatBlocks({ views, onPay, payLabel = '이 카드로 결제' }) {
  if (!views?.length) return null;
  return <View style={s.wrap}>
    {views.map((view, index) => <Block key={view.kind + index} view={view} onPay={onPay} payLabel={payLabel} />)}
  </View>;
}

function Block({ view, onPay, payLabel }) {
  if (view.kind === 'pay') {
    if (!onPay) return null;
    return <Pressable accessibilityRole="button" accessibilityLabel={`${view.name} ${payLabel}`} onPress={() => onPay(view.walletId)} style={s.payButton}>
      <Ionicons name="qr-code-outline" size={16} color="#FFF" />
      <Text style={s.payText}>{payLabel}</Text>
    </Pressable>;
  }
  return <View style={s.card}>
    <View style={s.head}>
      <Text style={[s.title, s.headTitle]}>{view.title}</Text>
      {!!view.total && <Text style={s.total}>{view.total}</Text>}
    </View>
    {!!view.sub && <Text style={s.caption}>{view.sub}</Text>}
    {!!view.previous && <Text style={s.caption}>{view.previous}</Text>}
    {view.kind === 'spending' ? view.rows.map(row => <BarRow key={row.name} name={`${row.name} · ${row.count}건`} amount={row.amount} ratio={row.ratio} />)
      : view.kind === 'review' ? view.rows.map((row, i) => <View key={row.label + i} style={s.status}>
          <View style={s.statusHead}>
            <Text style={s.name}>{row.label}</Text>
            <Text style={s.value}>{row.amount}</Text>
          </View>
          <Text style={s.caption}>낸 카드 {row.used}</Text>
          <Text style={[s.caption, s.best]}>{row.best}</Text>
        </View>)
      : view.kind === 'benefitSummary' ? <>
          {view.rows.map(row => <View key={row.name} style={s.row}>
            <View style={s.rowMain}><Text style={s.name}>{row.name}</Text></View>
            <Text style={s.value}>{row.amount}</Text>
          </View>)}
          {view.months.map(m => <BarRow key={m.label} name={m.label} amount={m.amount} ratio={m.ratio} />)}
          {view.lines.map(line => <Text key={line} style={s.caption}>{line}</Text>)}
        </>
      : view.kind === 'dayPlan' ? <>
          {view.rows.map(row => <View key={row.time} style={s.row}>
            <Ionicons name="time-outline" size={15} color="#536581" />
            <View style={s.rowMain}><Text style={s.name}>{row.time}</Text></View>
            <Text style={s.value}>{row.card}</Text>
          </View>)}
          {view.schedules.map(sch => <Text key={sch.time + sch.label} style={s.caption}>일정 {sch.time} · {sch.label}</Text>)}
        </>
      : view.kind === 'rules' ? view.rows.map(row => <View key={row.summary} style={s.status}>
          <Text style={s.name}>{row.summary}</Text>
          {!!row.sub && <Text style={s.caption}>{row.sub}</Text>}
        </View>)
      : view.kind === 'status' ? view.rows.map(row => <StatusRow key={row.name} row={row} />)
      : view.kind === 'benefits' ? view.rows.map(row => <View key={row.name} style={s.row}>
          <View style={s.rowMain}>
            <Text style={s.name}>{row.name}</Text>
            {!!row.where && <Text style={s.caption} numberOfLines={1}>{row.where}</Text>}
          </View>
          <Text style={s.value}>{row.value}</Text>
        </View>)
      : view.kind === 'promotions' ? <>
          {view.rows.map(row => <View key={row.brand + row.until} style={s.row}>
            <Ionicons name="storefront-outline" size={15} color="#536581" />
            <View style={s.rowMain}>
              <Text style={s.name}>{row.brand}</Text>
              <Text style={s.caption}>{row.kind} · {row.until}</Text>
            </View>
            <Text style={s.value}>{row.benefit}</Text>
          </View>)}
          {view.more > 0 && <Text style={s.caption}>그 밖에 {view.more}개는 혜택 탭에서 볼 수 있어요.</Text>}
        </>
      : view.rows.map(row => <View key={row.name} style={[s.row, row.highlight && s.rowHighlight]}>
          {row.rank != null && <Text style={s.rank}>{row.rank}</Text>}
          <View style={s.rowMain}>
            <Text style={[s.name, row.highlight && s.nameStrong]}>{row.name}</Text>
            {!!row.sub && <Text style={s.caption}>{row.sub}</Text>}
          </View>
          {row.highlight && <Text style={s.tag}>추천</Text>}
          {(row.tags || []).map(tag => <Text key={tag} style={s.tag}>{tag}</Text>)}
          <Text style={[s.value, row.highlight && s.nameStrong]}>{row.amount}</Text>
        </View>)}
  </View>;
}

function BarRow({ name, amount, ratio }) {
  return <View style={s.status}>
    <View style={s.statusHead}>
      <Text style={s.name}>{name}</Text>
      <Text style={s.value}>{amount}</Text>
    </View>
    <View style={s.track}><View style={[s.fill, { width: `${Math.round(ratio * 100)}%` }]} /></View>
  </View>;
}

function StatusRow({ row }) {
  return <View style={s.status}>
    <View style={s.statusHead}>
      <Text style={s.name}>{row.name}</Text>
      <Text style={s.value}>{row.perf}{row.goal ? ` / ${row.goal}` : ''}</Text>
    </View>
    <View style={s.track} accessibilityLabel={`${row.name} 다음 구간까지 ${Math.round(row.ratio * 100)}%`}>
      <View style={[s.fill, { width: `${Math.round(row.ratio * 100)}%` }]} />
    </View>
    <Text style={s.caption}>{row.left} · {row.benefit}</Text>
  </View>;
}

const s = StyleSheet.create({
  wrap: { gap: 8, marginTop: 4 },
  card: { backgroundColor: '#FFF', borderRadius: 12, borderWidth: 1, borderColor: '#DCE6F5', padding: 10, gap: 6 },
  title: { fontSize: 12, fontWeight: '800', color: '#3A4E6E' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headTitle: { flex: 1, minWidth: 0 },
  total: { fontSize: 15, fontWeight: '800', color: '#142D4E' },
  best: { color: '#0B7A43' },
  caption: { fontSize: 11, lineHeight: 16, color: '#61728C' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 8 },
  rowHighlight: { backgroundColor: '#EEF4FF' },
  rowMain: { flex: 1, minWidth: 0, gap: 1 },
  rank: { width: 18, textAlign: 'center', fontSize: 12, fontWeight: '800', color: '#1756DF' },
  name: { fontSize: 13, fontWeight: '600', color: '#142D4E' },
  nameStrong: { fontWeight: '800' },
  value: { fontSize: 13, fontWeight: '700', color: '#164EBE', textAlign: 'right', maxWidth: '48%' },
  tag: { fontSize: 10, fontWeight: '800', color: '#0B7A43', backgroundColor: '#E3F6EC', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' },
  status: { gap: 3, paddingVertical: 4 },
  statusHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E4EBF5', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: '#1756DF' },
  payButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: 20, backgroundColor: '#1756DF' },
  payText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
});
