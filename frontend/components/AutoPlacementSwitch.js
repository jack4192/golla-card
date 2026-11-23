// 홈 '내 지갑' 옆 카드 자동 배치 스위치 (2026-11-24 수정사항). 끌 때만 확인 창을 띄운다.
import React, { useState } from 'react';
import { Modal, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

export default function AutoPlacementSwitch({ on, onChange }) {
  const [asking, setAsking] = useState(false);
  const change = next => {
    if (next) onChange?.(true);
    else setAsking(true);
  };
  return <View style={s.row}>
    <Text style={[s.label, on && s.labelOn]}>자동 배치</Text>
    <Switch value={Boolean(on)} onValueChange={change} accessibilityLabel="카드 자동 배치"
      trackColor={{ false: '#C9D3E3', true: '#245DE5' }} thumbColor="#FFFFFF" activeThumbColor="#FFFFFF" />
    <Modal visible={asking} transparent animationType="fade" onRequestClose={() => setAsking(false)}>
      <View style={s.backdrop}>
        <View style={s.dialog} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={s.title}>자동 배치를 끌까요?</Text>
          <Text style={s.text}>끄시면 할인과 프로모션 혜택을 못 받으실 수 있어요!</Text>
          <View style={s.actions}>
            <TouchableOpacity accessibilityRole="button" onPress={() => setAsking(false)} style={[s.button, s.cancel]}>
              <Text style={s.cancelText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => { setAsking(false); onChange?.(false); }} style={[s.button, s.confirm]}>
              <Text style={s.confirmText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: '#62738D', fontSize: 13, fontWeight: '800' },
  labelOn: { color: '#245DE5' },
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  dialog: { width: '100%', maxWidth: 360, gap: 12, padding: 20, borderRadius: 20, backgroundColor: '#FFFFFF' },
  title: { color: '#142D4E', fontSize: 17, fontWeight: '800' },
  text: { color: '#526783', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  button: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD3FA' },
  confirm: { backgroundColor: '#245DE5' },
  cancelText: { color: '#245DE5', fontSize: 15, fontWeight: '800' },
  confirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
