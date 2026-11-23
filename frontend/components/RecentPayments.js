// 홈 '최근 이용내역' (서버 모드): 최근 결제 3건과, 제목을 누르면 여는 전체 화면 '카드이용내역'.
// 2026-11-24 사용자 결정 '실제 신한처럼': 신한 SOL페이 앱의 최근 이용내역·카드이용내역(매출전표) 모양을 따르되
// 우리 서비스에 중요한 '쓴 카드'와 '할인액'은 남긴다 (B안). 카드이용내역은 지난 한 달 기간·합계·총 건수와 그 기간 결제 목록
// (분할납부·즉시결제·리볼빙 버튼과 안내 상자는 우리 앱에서 쓰지 않아 뺀다). 서버가 기준 시각 이후 결제는 빼고 준다.
// 글자 모양은 dayTimelineCore.paymentRowText, 머리 글자는 paymentHistoryCore.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Modal, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadMonthSummary, loadRecentPayments } from '../utils/payments';
import { paymentRowText } from '../utils/dayTimelineCore';
import { countLabel, periodLabel, rowsInPeriod, totalLabel } from '../utils/paymentHistoryCore';

const HOME_COUNT = 3;
const PAGE_COUNT = 20;

function PaymentRow({ payment, divided = false }) {
  const row = paymentRowText(payment);
  return <View style={[s.row, divided && s.rowDivided]} accessible
    accessibilityLabel={`${row.when} ${row.merchant} ${row.amount} ${row.card}${row.benefit ? ' ' + row.benefit : ''}`}>
    <View style={s.rowMain}>
      <Text style={s.merchant} numberOfLines={1}>{row.merchant}</Text>
      <Text style={s.sub} numberOfLines={1}>{row.when} · {row.card}</Text>
    </View>
    <View style={s.rowSide}>
      <Text style={s.amount}>{row.amount}</Text>
      {Boolean(row.benefit) && <Text style={s.benefit}>{row.benefit}</Text>}
    </View>
  </View>;
}

function Status({ status, empty, onRetry }) {
  if (status === 'loading') return <ActivityIndicator style={s.status} color="#245DE5" />;
  if (status === 'failed') return <View style={s.statusRow}>
    <Text style={s.statusText}>이용내역을 불러오지 못했어요</Text>
    <TouchableOpacity accessibilityRole="button" onPress={onRetry} hitSlop={8}>
      <Text style={s.link}>다시 시도</Text>
    </TouchableOpacity>
  </View>;
  if (empty) return <Text style={[s.statusText, s.status]}>이용내역이 없어요</Text>;
  return null;
}

// 전체 화면 카드이용내역: 머리(기간·합계·총 건수)는 month-summary, 목록은 최근순 20건씩 읽어 기간 안 결제만
function PaymentHistory({ visible, onClose }) {
  const [summary, setSummary] = useState({ state: 'loading', data: null });
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('ready');
  const [ended, setEnded] = useState(false);
  const busy = useRef(false);

  const loadPage = useCallback(async (from, current) => {
    if (busy.current) return;
    busy.current = true;
    setStatus('loading');
    try {
      const page = await loadRecentPayments({ beforeId: current[current.length - 1]?.paymentId, limit: PAGE_COUNT });
      const inside = rowsInPeriod(page, from);
      setRows([...current, ...inside.rows]);
      setEnded(inside.ended || page.length < PAGE_COUNT);
      setStatus('ready');
    } catch {
      setStatus('failed');
    } finally {
      busy.current = false;
    }
  }, []);

  const open = useCallback(async () => {
    setRows([]);
    setEnded(false);
    setSummary({ state: 'loading', data: null });
    let from = null;
    try {
      const data = await loadMonthSummary();
      from = data?.from || null;
      setSummary({ state: 'ready', data });
    } catch {
      setSummary({ state: 'failed', data: null });
    }
    loadPage(from, []);
  }, [loadPage]);

  useEffect(() => { if (visible) open(); }, [visible, open]);

  const data = summary.data;
  const from = data?.from || null;
  const loadMore = () => {
    if (!ended && status === 'ready' && rows.length) loadPage(from, rows);
  };

  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="뒤로" onPress={onClose} style={s.headerButton} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color="#1B2433" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={s.headerTitle} numberOfLines={1}>카드이용내역</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="홈으로" onPress={onClose} style={s.headerButton} hitSlop={8}>
          <Ionicons name="home-outline" size={24} color="#1B2433" />
        </TouchableOpacity>
      </View>
      <FlatList style={s.list} contentContainerStyle={s.listContent}
        data={rows} keyExtractor={payment => String(payment.paymentId)}
        renderItem={({ item, index }) => <PaymentRow payment={item} divided={index > 0} />}
        onEndReached={loadMore} onEndReachedThreshold={0.4}
        ListHeaderComponent={<View style={s.summary}>
          {summary.state === 'loading' && <ActivityIndicator style={s.status} color="#245DE5" />}
          {summary.state === 'failed' && <Text style={s.statusText}>이용 합계를 불러오지 못했어요</Text>}
          {data && <>
            <Text style={s.period}>{periodLabel(data)}</Text>
            <Text style={s.total} accessibilityLabel={`${periodLabel(data)} 이용 금액 ${totalLabel(data)}`}>{totalLabel(data)}</Text>
          </>}
          <View style={s.countRow}>
            <Text style={s.count}>{data ? countLabel(data) : '이용내역'}</Text>
          </View>
        </View>}
        ListFooterComponent={<Status status={status} empty={status === 'ready' && ended && !rows.length}
          onRetry={() => loadPage(from, rows)} />}
      />
    </SafeAreaView>
  </Modal>;
}

export default function RecentPayments({ refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let stopped = false;
    setStatus('loading');
    loadRecentPayments({ limit: HOME_COUNT })
      .then(found => { if (!stopped) { setRows(found); setStatus('ready'); } })
      .catch(() => { if (!stopped) setStatus('failed'); });
    return () => { stopped = true; };
  }, [refreshKey, revision]);

  // 앱이 다시 앞으로 오면 지나간 결제가 새로 보이게 다시 읽는다
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setRevision(value => value + 1);
    });
    return () => subscription.remove();
  }, []);

  return <View style={s.section}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="최근 이용내역 전체 보기" style={s.head}
      onPress={() => setHistoryOpen(true)}>
      <Text accessibilityRole="header" style={s.title}>최근 이용내역</Text>
      <Ionicons name="chevron-forward" size={20} color="#1B2433" />
    </TouchableOpacity>
    <View style={s.card}>
      {status === 'ready' && rows.map(payment => <PaymentRow key={payment.paymentId} payment={payment} />)}
      <Status status={status} empty={status === 'ready' && !rows.length} onRetry={() => setRevision(value => value + 1)} />
    </View>
    <PaymentHistory visible={historyOpen} onClose={() => setHistoryOpen(false)} />
  </View>;
}

const s = StyleSheet.create({
  section: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, minHeight: 36, paddingRight: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#1B2433' },
  card: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#E3E7EE', backgroundColor: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: '#EEF1F5' },
  rowMain: { flex: 1, minWidth: 0, gap: 5 },
  merchant: { fontSize: 16, fontWeight: '600', color: '#1B2433' },
  sub: { fontSize: 13, color: '#6B7685', fontVariant: ['tabular-nums'] },
  rowSide: { alignItems: 'flex-end', gap: 5 },
  amount: { fontSize: 16, fontWeight: '800', color: '#1B2433', fontVariant: ['tabular-nums'] },
  benefit: { fontSize: 12, fontWeight: '700', color: '#245DE5', fontVariant: ['tabular-nums'] },
  link: { color: '#245DE5', fontSize: 13, fontWeight: '700' },
  status: { paddingVertical: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  statusText: { fontSize: 13, color: '#6B7685', textAlign: 'center' },
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 19, fontWeight: '700', color: '#1B2433' },
  list: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  listContent: { paddingHorizontal: 22, paddingBottom: 32 },
  summary: { paddingTop: 18 },
  period: { fontSize: 15, color: '#4E5968', fontVariant: ['tabular-nums'] },
  total: { marginTop: 4, fontSize: 32, fontWeight: '800', color: '#1B2433', fontVariant: ['tabular-nums'] },
  countRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginTop: 24, borderBottomWidth: 1.5, borderBottomColor: '#4E5968' },
  count: { fontSize: 15, fontWeight: '600', color: '#333D4B' },
});
