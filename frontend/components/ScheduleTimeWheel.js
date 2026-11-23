import React, { useEffect, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const ROW_HEIGHT = 36;
const WEB = Platform.OS === 'web';
const pad = value => String(value).padStart(2, '0');
const webScrollStyle = WEB ? { scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' } : null;
const webRowStyle = WEB ? { scrollSnapAlign: 'center' } : null;

function Wheel({ label, value, max, disabled, onChange }) {
  const scroll = useRef(null);
  const current = useRef(value);
  const laidOut = useRef(false);
  const initialOffset = useRef({ x: 0, y: value * ROW_HEIGHT }).current;

  const scrollToValue = next => scroll.current?.scrollTo({ y: next * ROW_HEIGHT, animated: false });
  useEffect(() => {
    if (current.current !== value) {
      current.current = value;
      scrollToValue(value);
    }
  }, [value]);

  const choose = next => {
    if (disabled || next === current.current) return;
    current.current = next;
    onChange(next);
    scrollToValue(next);
  };
  const move = offset => choose(Math.max(0, Math.min(max, current.current + offset)));
  const webKeys = WEB ? {
    tabIndex: disabled ? -1 : 0,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuenow': value,
    'aria-orientation': 'vertical',
    onKeyDown: event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      move(event.key === 'ArrowUp' ? -1 : 1);
    },
  } : {};

  return <View style={s.wheel} accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max, now: value }} accessibilityState={{ disabled }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={event => move(event.nativeEvent.actionName === 'increment' ? 1 : -1)} {...webKeys}>
    <View pointerEvents="none" style={s.selection} />
    <ScrollView ref={scroll} style={[s.scroll, webScrollStyle]} contentContainerStyle={s.track}
      contentOffset={initialOffset} snapToInterval={ROW_HEIGHT} decelerationRate="fast"
      scrollEnabled={!disabled} nestedScrollEnabled showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (laidOut.current) return;
        laidOut.current = true;
        scrollToValue(current.current);
      }}
      onScroll={event => {
        if (disabled || !laidOut.current) return;
        const next = Math.max(0, Math.min(max, Math.round(event.nativeEvent.contentOffset.y / ROW_HEIGHT)));
        if (next !== current.current) {
          current.current = next;
          onChange(next);
        }
      }}>
      {Array.from({ length: max + 1 }, (_, number) => <TouchableOpacity key={number}
        disabled={disabled} accessible={false} focusable={false} onPress={() => choose(number)}
        style={[s.row, webRowStyle]}>
        <Text style={[s.number, number === value && s.active]}>{pad(number)}</Text>
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
}

export default function ScheduleTimeWheel({ label, value, setValue, disabled, allowMidnight = false }) {
  const [hour, minute] = (value || '00:00').split(':').map(Number);
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <View style={s.columns}>
      <Wheel label={label + ' 시'} value={hour} max={allowMidnight ? 24 : 23} disabled={disabled}
        onChange={next => setValue(previous => pad(next) + ':' + (next === 24 ? '00' : previous.slice(3) || '00'))} />
      <Text accessible={false} style={s.colon}>:</Text>
      {hour === 24
        ? <View style={s.fixedMinute}><Text style={[s.number, s.active]}>00</Text></View>
        : <Wheel label={label + ' 분'} value={minute} max={59} disabled={disabled}
            onChange={next => setValue(previous => previous.startsWith('24:') ? previous : (previous.slice(0, 2) || '00') + ':' + pad(next))} />}
    </View>
  </View>;
}

const s = StyleSheet.create({
  field: { flex: 1, minWidth: 0, gap: 5, alignItems: 'center' },
  label: { color: '#385988', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  columns: { flexDirection: 'row', alignItems: 'center', gap: 4, width: '100%', maxWidth: 145 },
  wheel: { flex: 1, minWidth: 0, height: 3 * ROW_HEIGHT, overflow: 'hidden' },
  scroll: { flex: 1 },
  track: { paddingVertical: ROW_HEIGHT },
  selection: { position: 'absolute', top: ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT, backgroundColor: '#EDF3FF', borderRadius: 10 },
  row: { height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  fixedMinute: { flex: 1, height: ROW_HEIGHT, backgroundColor: '#EDF3FF', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  number: { color: '#667892', fontSize: 17, fontVariant: ['tabular-nums'] },
  active: { color: '#142D4E', fontWeight: '800', fontSize: 21 },
  colon: { color: '#385988', fontSize: 18, fontWeight: '800' },
});
