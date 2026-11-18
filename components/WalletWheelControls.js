import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
export function createWalletWheelHandler(getState, select, clock = Date.now) {
  let amount = 0,
    lastMove = -Infinity,
    lastEvent = -Infinity;
  return event => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented || event.cancelable === false) return false;
    const {
      cards,
      index
    } = getState();
    if (cards.length < 2) return false;
    const x = Number(event.deltaX) || 0,
      y = Number(event.deltaY) || 0;
    const raw = Math.abs(x) > Math.abs(y) ? x : y;
    if (!raw || !Number.isFinite(raw)) return false;
    const direction = Math.sign(raw),
      next = index + direction;
    if (next < 0 || next >= cards.length) {
      amount = 0;
      return false;
    }
    const now = clock();
    const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
    if (now - lastEvent > 180 || Math.sign(amount) !== direction) amount = 0;
    lastEvent = now;
    event.preventDefault();
    if (now - lastMove < 240) {
      amount = 0;
      return true;
    }
    amount += delta;
    if (Math.abs(amount) >= 35) {
      amount = 0;
      lastMove = now;
      select(next);
    }
    return true;
  };
}
export default function WalletWheelControls({
  cards = [],
  selectedId,
  onSelect,
  children,
  onLayout
}) {
  const root = useRef(null),
    latest = useRef(null),
    position = useRef(0);
  const index = Math.max(0, cards.findIndex(card => card.id === selectedId));
  latest.current = {
    cards,
    onSelect
  };
  position.current = index;
  const go = next => {
    const value = latest.current;
    if (next < 0 || next >= value.cards.length || next === position.current) return;
    position.current = next;
    value.onSelect?.(value.cards[next].id);
  };
  const move = useRef(go);
  move.current = go;
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = root.current;
    if (!node?.addEventListener) return;
    const wheel = createWalletWheelHandler(() => ({
      cards: latest.current.cards,
      index: position.current
    }), next => move.current(next));
    const options = {
      passive: false,
      capture: true
    };
    node.addEventListener('wheel', wheel, options);
    return () => node.removeEventListener('wheel', wheel, options);
  }, []);
  return <View ref={root} style={s.root} onLayout={onLayout}>
    {children}
    <View style={s.controls}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="이전 지갑 카드" disabled={!cards.length || index === 0} onPress={() => move.current(position.current - 1)} style={[s.button, (!cards.length || index === 0) && s.disabled]}>
        <Text style={s.blue}>‹ 이전 카드</Text>
      </TouchableOpacity>
      <Text style={s.count} accessibilityLiveRegion="polite">{cards.length ? index + 1 : 0} / {cards.length}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="다음 지갑 카드" disabled={!cards.length || index === cards.length - 1} onPress={() => move.current(position.current + 1)} style={[s.button, (!cards.length || index === cards.length - 1) && s.disabled]}>
        <Text style={s.blue}>다음 카드 ›</Text>
      </TouchableOpacity>
    </View>
    
  </View>;
}
const s = StyleSheet.create({
  root: {
    width: '100%'
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    marginTop: 14
  },
  button: {
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    justifyContent: 'center'
  },
  blue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#245DE5"
  },
  count: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6D83A7',
    minWidth: 50,
    textAlign: 'center'
  },
  hint: {
    fontSize: 12,
    lineHeight: 20,
    color: "#5A6E89",
    textAlign: 'center',
    marginTop: 8
  },
  disabled: {
    opacity: 0.35
  }
});
