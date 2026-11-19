import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
export function createWalletWheelHandler(getState, select, clock = Date.now) {
  let amount = 0;
  let lastMove = -Infinity;
  let lastEvent = -Infinity;
  return event => {
    if (event.ctrlKey || event.metaKey || event.defaultPrevented || event.cancelable === false) {
      return false;
    }
    const {
      cards,
      index
    } = getState();
    if (cards.length < 2) return false;
    const x = Number(event.deltaX) || 0;
    const y = Number(event.deltaY) || 0;
    const raw = Math.abs(x) > Math.abs(y) ? x : y;
    if (!raw || !Number.isFinite(raw)) return false;
    const direction = Math.sign(raw);
    const next = index + direction;

    // 처음·마지막 카드에서는 바깥 페이지 스크롤을 허용합니다.
    if (next < 0 || next >= cards.length) {
      amount = 0;
      return false;
    }
    const now = clock();
    const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 200 : 1);
    if (now - lastEvent > 180 || Math.sign(amount) !== direction) {
      amount = 0;
    }
    lastEvent = now;
    event.preventDefault();

    // 휠 한 번에 여러 카드가 빠르게 넘어가는 것을 방지합니다.
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
  const root = useRef(null);
  const latest = useRef(null);
  const position = useRef(0);
  const index = Math.max(0, cards.findIndex(card => card.id === selectedId));
  latest.current = {
    cards,
    onSelect
  };
  position.current = index;
  const go = next => {
    const value = latest.current;
    if (next < 0 || next >= value.cards.length || next === position.current) {
      return;
    }
    position.current = next;
    value.onSelect?.(value.cards[next].id);
  };
  const move = useRef(go);
  move.current = go;
  useEffect(() => {
    // Expo Go에서는 기존 손가락 스와이프를 사용합니다.
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
    return () => {
      node.removeEventListener('wheel', wheel, options);
    };
  }, []);
  const previousDisabled = !cards.length || index === 0;
  const nextDisabled = !cards.length || index === cards.length - 1;
  return <View ref={root} style={s.root} onLayout={onLayout}>
      {children}

      <View style={s.controls}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="이전 지갑 카드" disabled={previousDisabled} onPress={() => move.current(position.current - 1)} style={[s.button, previousDisabled && s.disabled]}>
          <Text style={s.blue}>
            ‹ 이전 카드
          </Text>
        </TouchableOpacity>

        <Text style={s.count} accessibilityLiveRegion="polite">
          {cards.length ? index + 1 : 0} / {cards.length}
        </Text>

        <TouchableOpacity accessibilityRole="button" accessibilityLabel="다음 지갑 카드" disabled={nextDisabled} onPress={() => move.current(position.current + 1)} style={[s.button, nextDisabled && s.disabled]}>
          <Text style={s.blue}>
            다음 카드 ›
          </Text>
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
