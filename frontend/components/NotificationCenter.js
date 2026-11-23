// 앱 내 알림함: 상단 🔔 버튼(안 읽은 수 표시) + 알림 목록 창
import React, { useEffect, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { clearInbox, markAllRead, markRead, readInbox, subscribeInbox, unreadCount } from '../utils/notifications';

const ICONS = {
  schedule: 'calendar-outline',
  card: 'card-outline',
  benefit: 'gift-outline',
  savings: 'stats-chart-outline',
  info: 'information-circle-outline',
};

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function useInbox() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let active = true;
    readInbox().then(value => { if (active) setItems(value); });
    const unsubscribe = subscribeInbox(value => { if (active) setItems(value); });
    return () => { active = false; unsubscribe(); };
  }, []);
  return items;
}

export function NotificationBell({ items, onPress, color = '#244E9C' }) {
  const count = unreadCount(items);
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={count ? `알림 ${count}개 안 읽음` : '알림'} onPress={onPress} style={s.bell}>
    <Ionicons name="notifications-outline" size={21} color={color} />
    {count > 0 && <View style={s.badge}><Text style={s.badgeText}>{count > 9 ? '9+' : count}</Text></View>}
  </TouchableOpacity>;
}

export default function NotificationCenter({ visible, items, onClose, onOpenTarget }) {
  const open = item => {
    markRead(item.id).catch(() => {});
    if (item.target) onOpenTarget?.(item.target);
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} style={s.headerButton}>
          <Ionicons name="arrow-back" size={24} color="#1B2C47" />
        </TouchableOpacity>
        <Text accessibilityRole="header" style={s.headerTitle}>알림</Text>
        <TouchableOpacity accessibilityRole="button" disabled={!unreadCount(items)} onPress={() => markAllRead().catch(() => {})} style={s.headerAction}>
          <Text style={[s.headerActionText, !unreadCount(items) && s.muted]}>모두 읽음</Text>
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={s.content}>
        {!items.length ? <View style={s.empty}>
          <Ionicons name="notifications-off-outline" size={36} color="#9AAAC0" />
          <Text style={s.emptyText}>새 알림이 없어요. 일정과 맞춤 카드 소식이 생기면 여기에 알려드려요.</Text>
        </View> : items.map(item => <TouchableOpacity key={item.id} accessibilityRole="button"
            accessibilityLabel={(item.read ? '' : '안 읽음 ') + item.title} onPress={() => open(item)}
            style={[s.item, !item.read && s.unread]}>
          <View style={s.itemIcon}><Ionicons name={ICONS[item.type] || ICONS.info} size={20} color="#1459F5" /></View>
          <View style={s.itemText}>
            <View style={s.itemHead}>
              <Text style={s.itemTitle} numberOfLines={2}>{item.title}</Text>
              {!item.read && <View style={s.dot} />}
            </View>
            {!!item.body && <Text style={s.itemBody}>{item.body}</Text>}
            <Text style={s.itemTime}>{timeAgo(item.createdAt)}</Text>
          </View>
        </TouchableOpacity>)}
        {items.length > 0 && <TouchableOpacity accessibilityRole="button" onPress={() => clearInbox().catch(() => {})} style={s.clear}>
          <Text style={s.clearText}>알림 모두 지우기</Text>
        </TouchableOpacity>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8EFFD', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#E5484D', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: '#F4F7FF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1B2C47' },
  headerAction: { minWidth: 64, height: 44, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 6 },
  headerActionText: { fontSize: 13, fontWeight: '700', color: '#1459F5' },
  muted: { color: '#9AAAC0' },
  content: { padding: 16, gap: 10, width: '100%', maxWidth: 640, alignSelf: 'center', paddingBottom: 40 },
  empty: { alignItems: 'center', gap: 12, marginTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 14, lineHeight: 22, color: '#5A6E89', textAlign: 'center' },
  item: { flexDirection: 'row', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14 },
  unread: { backgroundColor: '#EEF4FF' },
  itemIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E4EDFF', alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, gap: 4 },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: '#1D304D' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5484D' },
  itemBody: { fontSize: 13, lineHeight: 19, color: '#3D5170' },
  itemTime: { fontSize: 11, color: '#7A8AA0' },
  clear: { alignSelf: 'center', padding: 12 },
  clearText: { fontSize: 13, color: '#6A7A91', fontWeight: '600' },
});
