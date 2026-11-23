import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const offsets = [[-10, '−10분'], [-30, '−30분'], [-60, '−1시간'], [10, '+10분'], [30, '+30분'], [60, '+1시간']];

export default function ScheduleTimeFields({ disabled, onAdjust, inputProps, endLabel = '종료' }) {
  return [['start', '시작'], ['end', endLabel]].map(([field, label]) => {
    const buttons = list => list.map(([delta, text]) => (
      <TouchableOpacity key={delta} accessibilityRole="button" accessibilityLabel={label + ' ' + text}
        disabled={disabled} onPress={() => onAdjust(field, delta)} style={s.adjustButton}>
        <Text style={s.adjustText}>{text}</Text>
      </TouchableOpacity>
    ));
    return <View key={field} style={s.block}>
      <Text style={s.label}>{label}</Text>
      <View style={s.row}>
        {buttons(offsets.slice(0, 3))}
        <TextInput accessibilityLabel={label + ' 시간 입력'} style={s.input} editable={!disabled}
          keyboardType="number-pad" placeholder="09:30" placeholderTextColor="#9AAAC0" maxLength={5}
          returnKeyType="done" {...inputProps(field)} />
        {buttons(offsets.slice(3))}
      </View>
    </View>;
  });
}

const s = StyleSheet.create({
  block: { gap: 4 },
  label: { color: '#5A6E89', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, flexWrap: 'wrap' },
  input: { width: 70, minHeight: 40, marginHorizontal: 3, borderRadius: 12, borderWidth: 1, borderColor: '#C9D8F2', backgroundColor: '#FFFFFF', textAlign: 'center', color: '#152D50', fontSize: 17, fontWeight: '800' },
  adjustButton: { paddingHorizontal: 5, minHeight: 28, justifyContent: 'center', borderRadius: 8, backgroundColor: '#F1F5FD' },
  adjustText: { color: '#1854D8', fontSize: 11, fontWeight: '700' },
});
