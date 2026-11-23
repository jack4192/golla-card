// 화면 아래에서 올라오는 '내 카드 선택' 바텀시트
// - 바깥(어두운 부분)을 누르거나, 위쪽 손잡이를 아래로 끌면 닫힙니다.
// - 카드를 고르면 결제 카드가 바뀌고 시트가 닫힙니다.
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Modal, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const CLOSE_DISTANCE = 80;

export default function CardPickerSheet({ visible, cards = [], selectedId, onSelect, onClose, onAddCard, title = '결제할 카드 선택' }) {
  const dragY = useRef(new Animated.Value(0)).current;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (visible) dragY.setValue(0);
  }, [visible, dragY]);

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderMove: (_, gesture) => dragY.setValue(Math.max(0, gesture.dy)),
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy > CLOSE_DISTANCE || gesture.vy > 1.2) {
        onCloseRef.current?.();
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  })).current;

  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={s.backdrop}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="카드 선택 닫기" activeOpacity={1} style={s.backdropTouch} onPress={onClose} />
      <Animated.View style={[s.sheet, { transform: [{ translateY: dragY }] }]} accessibilityViewIsModal>
        <View {...pan.panHandlers} style={s.handleArea}>
          <View style={s.handle} />
        </View>
        <View style={s.headRow}>
          <Text accessibilityRole="header" style={s.heading}>{title}</Text>
          <Text style={s.count}>내 카드 {cards.length}장</Text>
        </View>
        <ScrollView style={s.list} contentContainerStyle={s.listContent}>
          {cards.map(card => {
            const active = card.id === selectedId;
            return <TouchableOpacity key={card.id} accessibilityRole="radio" accessibilityState={{ selected: active }}
              accessibilityLabel={card.name + (active ? ', 지금 결제 카드' : '')}
              onPress={() => { onSelect?.(card.id); onClose?.(); }} style={[s.row, active && s.rowActive]}>
              {card.image
                ? <Image source={typeof card.image === 'string' ? { uri: card.image } : card.image} resizeMode="contain" style={s.image} />
                : <View style={[s.image, s.imagePlaceholder]}><Ionicons name="card-outline" size={22} color="#9AAAC0" /></View>}
              <View style={s.info}>
                <Text style={s.name} numberOfLines={1}>{card.name}</Text>
                <Text style={s.issuer}>{[card.issuer, card.type].filter(Boolean).join(' · ')}</Text>
              </View>
              {active ? <View style={s.activeBadge}><Text style={s.activeText}>결제 카드</Text></View>
                : <Ionicons name="chevron-forward" size={16} color="#9AAAC0" />}
            </TouchableOpacity>;
          })}
        </ScrollView>
        {!!onAddCard && <TouchableOpacity accessibilityRole="button" onPress={() => { onClose?.(); onAddCard(); }} style={s.add}>
          <Ionicons name="add-circle-outline" size={18} color="#245DE5" />
          <Text style={s.addText}>카드 추가 등록</Text>
        </TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" onPress={onClose} style={s.close}>
          <Text style={s.closeText}>닫기</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  backdropTouch: { ...StyleSheet.absoluteFillObject },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', maxHeight: '75%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 4 },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#D3DBE7' },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 18, fontWeight: '800', color: '#14213D' },
  count: { fontSize: 13, color: '#687B97', fontWeight: '600' },
  list: { flexGrow: 0 },
  listContent: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  rowActive: { backgroundColor: '#F1F6FF', borderColor: '#245DE5' },
  image: { width: 64, height: 42 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F4F9', borderRadius: 6 },
  info: { flex: 1, gap: 2 },
  name: { color: '#14213D', fontSize: 15, fontWeight: '700' },
  issuer: { color: '#687B97', fontSize: 12 },
  activeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#E4EDFF' },
  activeText: { color: '#245DE5', fontSize: 12, fontWeight: '700' },
  add: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#D6E2FA' },
  addText: { color: '#245DE5', fontSize: 14, fontWeight: '700' },
  close: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F1F4F9' },
  closeText: { color: '#104FE7', fontSize: 14, fontWeight: '700' },
});
