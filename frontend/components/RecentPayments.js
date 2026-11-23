// 홈 '최근 결제' (서버 모드, 2026-11-23 설계서 home-day-timeline): 최근 결제 5건과 '더 보기' 시트(20건씩).
// 서버가 기준 시각 이후 결제는 빼고 준다. 글자 모양은 dayTimelineCore.paymentRowText.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { loadRecentPayments } from '../utils/payments';
import { paymentRowText } from '../utils/dayTimelineCore';

const HOME_COUNT = 5;
const PAGE_COUNT = 20;

function PaymentRow({ payment, today }) {
  const row = paymentRowText(payment, today);
  return <View style={s.row} accessible accessibilityLabel={`${row.when} ${row.merchant} ${row.amount} ${row.card}${row.benefit ? ' 혜택 ' + row.benefit : ''}`}>
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
    <Text style={s.statusText}>결제 내역을 불러오지 못했어요</Text>
    <TouchableOpacity accessibilityRole="button" onPress={onRetry} hitSlop={8}>
      <Text style={s.link}>다시 시도</Text>
    </TouchableOpacity>
  </View>;
  if (empty) return <Text style={[s.statusText, s.status]}>아직 결제 내역이 없어요</Text>;
  return null;
}

export default function RecentPayments({ today, refreshKey = 0 }) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState('loading');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetRows, setSheetRows] = useState([]);
  const [sheetStatus, setSheetStatus] = useState('ready');
  const [hasMore, setHasMore] = useState(true);
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

  const loadPage = useCallback(async (beforeId, current) => {
    setSheetStatus('loading');
    try {
      const found = await loadRecentPayments({ beforeId, limit: PAGE_COUNT });
      setSheetRows([...current, ...found]);
      setHasMore(found.length === PAGE_COUNT);
      setSheetStatus('ready');
    } catch {
      setSheetStatus('failed');
    }
  }, []);

  const openSheet = () => {
    setSheetOpen(true);
    setSheetRows([]);
    setHasMore(true);
    loadPage(undefined, []);
  };
  const last = sheetRows[sheetRows.length - 1];

  return <View style={s.card}>
    <View style={s.head}>
      <Text accessibilityRole="header" style={s.title}>최근 결제</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="결제 내역 더 보기" style={s.more} onPress={openSheet}>
        <Text style={s.link}>더 보기</Text>
        <Ionicons name="chevron-forward" size={14} color="#245DE5" />
      </TouchableOpacity>
    </View>
    {status === 'ready' && rows.map(payment => <PaymentRow key={payment.paymentId} payment={payment} today={today} />)}
    <Status status={status} empty={status === 'ready' && !rows.length} onRetry={() => setRevision(value => value + 1)} />

    <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
      <View style={s.backdrop}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="결제 내역 닫기" activeOpacity={1}
          style={s.backdropTouch} onPress={() => setSheetOpen(false)} />
        <View style={s.sheet} accessibilityViewIsModal>
          <View style={s.handleArea}><View style={s.handle} /></View>
          <View style={s.head}>
            <Text accessibilityRole="header" style={s.sheetTitle}>결제 내역</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" onPress={() => setSheetOpen(false)} hitSlop={8}>
              <Ionicons name="close" size={22} color="#4B5D78" />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.sheetList} contentContainerStyle={s.sheetListContent}>
            {sheetRows.map(payment => <PaymentRow key={payment.paymentId} payment={payment} today={today} />)}
            <Status status={sheetStatus === 'ready' ? 'ready' : sheetStatus}
              empty={sheetStatus === 'ready' && !sheetRows.length}
              onRetry={() => loadPage(last?.paymentId, sheetRows)} />
            {sheetStatus === 'ready' && hasMore && sheetRows.length > 0 && <TouchableOpacity accessibilityRole="button"
              style={s.loadMore} onPress={() => loadPage(last.paymentId, sheetRows)}>
              <Text style={s.link}>더 보기</Text>
            </TouchableOpacity>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  card: { gap: 2, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 20, borderWidth: 1, borderColor: '#E4ECFA', backgroundColor: '#FFFFFF' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  title: { fontSize: 16, fontWeight: '800', color: '#142D4E' },
  more: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 36, paddingLeft: 10 },
  link: { color: '#245DE5', fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, borderTopWidth: 1, borderTopColor: '#F0F3F8' },
  rowMain: { flex: 1, minWidth: 0, gap: 2 },
  merchant: { fontSize: 14, fontWeight: '700', color: '#1C2B45' },
  sub: { fontSize: 12, color: '#6A7C96', fontVariant: ['tabular-nums'] },
  rowSide: { alignItems: 'flex-end', gap: 2 },
  amount: { fontSize: 14, fontWeight: '800', color: '#1C2B45', fontVariant: ['tabular-nums'] },
  benefit: { fontSize: 12, fontWeight: '700', color: '#245DE5', fontVariant: ['tabular-nums'] },
  status: { paddingVertical: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10 },
  statusText: { fontSize: 13, color: '#526783', textAlign: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '86%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 24, gap: 6 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D3DBE7' },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: '#14213D' },
  sheetList: { flexGrow: 0 },
  sheetListContent: { paddingBottom: 8 },
  loadMore: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 6, borderRadius: 14, backgroundColor: '#F1F6FE' },
});
