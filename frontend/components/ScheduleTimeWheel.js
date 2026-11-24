import React, { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const ROW_HEIGHT = 36;
const MINUTE_STEP = 5;          // 분 휠은 5분 단위 (2026-11-24 사용자 요청)
const SETTLE_MS = 140;          // 웹: 마지막 스크롤 뒤 이만큼 멈추면 값 확정 (웹에는 관성 끝 이벤트가 없다)
const WEB = Platform.OS === 'web';
const pad = value => String(value).padStart(2, '0');
const webScrollStyle = WEB ? { scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' } : null;
const webRowStyle = WEB ? { scrollSnapAlign: 'center' } : null;
const range = (max, step = 1) => Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
// 목록에 없는 값(예: 예전에 넣은 13:07)은 가장 가까운 칸을 가리킨다
const nearestIndex = (values, value) => values.reduce((best, item, i) =>
  (Math.abs(item - value) < Math.abs(values[best] - value) ? i : best), 0);

// 휠 하나. 굴리는 동안에는 이 휠의 강조만 바꾸고(가볍게), 멈췄을 때 한 번만 onChange 로 값을 올린다.
// 예전에는 한 칸 지날 때마다 onChange → 입력 창 전체가 다시 그려져 스크롤이 딱딱 끊겼다 (2026-11-24).
function Wheel({ label, values, value, disabled, onChange }) {
  const scroll = useRef(null);
  const settleTimer = useRef(null);
  const dragging = useRef(false);
  const ignoreUntil = useRef(0);   // 바깥 값이 바뀌어 휠을 코드로 옮길 때 생기는 스크롤은 사용자 조작이 아니므로 무시
  const laidOut = useRef(false);
  const committed = useRef(nearestIndex(values, value));
  const [shown, setShown] = useState(committed.current);
  const initialOffset = useRef({ x: 0, y: committed.current * ROW_HEIGHT }).current;
  const last = values.length - 1;
  const latestValue = useRef(value);
  latestValue.current = value;

  const scrollToIndex = (index, animated = false) => {
    ignoreUntil.current = Date.now() + (animated ? 450 : 250);
    clearTimeout(settleTimer.current);
    scroll.current?.scrollTo({ y: index * ROW_HEIGHT, animated });
  };
  // 바깥에서 값이 바뀌면(시작을 옮겨 종료가 밀릴 때 등) 휠도 그 자리로
  useEffect(() => {
    const index = nearestIndex(values, value);
    if (index !== committed.current && !dragging.current) {
      committed.current = index;
      setShown(index);
      scrollToIndex(index);
    }
  }, [value, values]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  const indexAt = y => Math.max(0, Math.min(last, Math.round(y / ROW_HEIGHT)));
  const commit = index => {
    if (disabled) return;
    setShown(index);
    if (index !== committed.current) {
      committed.current = index;
      onChange(values[index]);
      // 바깥에서 값을 받아들이지 않고 고쳐 버린 경우(예: 종료를 시작보다 앞으로 → 시작 + 1시간) 휠을 실제 값으로 되돌린다
      setTimeout(() => {
        const actual = nearestIndex(values, latestValue.current);
        if (actual !== committed.current) {
          committed.current = actual;
          setShown(actual);
          scrollToIndex(actual, true);
        }
      }, 60);
    }
  };
  const choose = index => {
    commit(index);
    scrollToIndex(index, true);
  };
  const move = offset => choose(Math.max(0, Math.min(last, committed.current + offset)));
  const webKeys = WEB ? {
    tabIndex: disabled ? -1 : 0,
    'aria-valuemin': values[0],
    'aria-valuemax': values[last],
    'aria-valuenow': values[shown],
    'aria-orientation': 'vertical',
    onKeyDown: event => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      move(event.key === 'ArrowUp' ? -1 : 1);
    },
  } : {};

  return <View style={s.wheel} accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityValue={{ min: values[0], max: values[last], now: values[shown] }} accessibilityState={{ disabled }}
    accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
    onAccessibilityAction={event => move(event.nativeEvent.actionName === 'increment' ? 1 : -1)} {...webKeys}>
    <View pointerEvents="none" style={s.selection} />
    <ScrollView ref={scroll} style={[s.scroll, webScrollStyle]} contentContainerStyle={s.track}
      contentOffset={initialOffset} snapToInterval={ROW_HEIGHT} decelerationRate="normal"
      scrollEnabled={!disabled} nestedScrollEnabled showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
      onContentSizeChange={() => {
        if (laidOut.current) return;
        laidOut.current = true;
        scrollToIndex(committed.current);
      }}
      onScrollBeginDrag={() => { dragging.current = true; }}
      onScrollEndDrag={event => {
        // 손을 뗄 때 관성이 없으면 여기서 확정 (관성이 있으면 onMomentumScrollEnd 에서)
        const velocity = Math.abs(event.nativeEvent.velocity?.y || 0);
        if (velocity < 0.05) { dragging.current = false; commit(indexAt(event.nativeEvent.contentOffset.y)); }
      }}
      onMomentumScrollEnd={event => { dragging.current = false; commit(indexAt(event.nativeEvent.contentOffset.y)); }}
      onScroll={event => {
        if (disabled || !laidOut.current || Date.now() < ignoreUntil.current) return;
        const y = event.nativeEvent.contentOffset.y;
        const index = indexAt(y);
        if (index !== shown) setShown(index);           // 굴리는 동안은 강조만
        if (WEB) {                                      // 웹: 멈추면 확정
          clearTimeout(settleTimer.current);
          settleTimer.current = setTimeout(() => { dragging.current = false; commit(indexAt(y)); }, SETTLE_MS);
        }
      }}>
      {values.map((number, index) => <TouchableOpacity key={number}
        disabled={disabled} accessible={false} focusable={false} onPress={() => choose(index)}
        style={[s.row, webRowStyle]}>
        <Text style={[s.number, index === shown && s.active]}>{pad(number)}</Text>
      </TouchableOpacity>)}
    </ScrollView>
  </View>;
}

const HOURS = range(23);
const HOURS_WITH_MIDNIGHT = range(24);
const MINUTES = range(55, MINUTE_STEP);

export default function ScheduleTimeWheel({ label, value, setValue, disabled, allowMidnight = false }) {
  const [hour, minute] = (value || '00:00').split(':').map(Number);
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    <View style={s.columns}>
      <Wheel label={label + ' 시'} values={allowMidnight ? HOURS_WITH_MIDNIGHT : HOURS} value={hour} disabled={disabled}
        onChange={next => setValue(previous => pad(next) + ':' + (next === 24 ? '00' : previous.slice(3) || '00'))} />
      <Text accessible={false} style={s.colon}>:</Text>
      {hour === 24
        ? <View style={s.fixedMinute}><Text style={[s.number, s.active]}>00</Text></View>
        : <Wheel label={label + ' 분'} values={MINUTES} value={minute} disabled={disabled}
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
