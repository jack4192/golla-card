import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Store from '../utils/demoStore';
import { CARD_ORDER_KEY, saveWalletCardOrder } from '../utils/wallet';
export function validateCardOrder(raw) {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.ids) || value.ids.length > 200 || value.ids.some(id => typeof id !== 'string' || id.length > 100)) {
    throw Error('저장된 카드 순서 형식을 확인해주세요.');
  }
  return [...new Set(value.ids)];
}
export function orderCards(cards, ids) {
  const rank = new Map(ids.map((id, index) => [String(id), index]));
  return cards.map((card, index) => ({
    card,
    index
  })).sort((a, b) => (rank.get(String(a.card.id)) ?? Infinity) - (rank.get(String(b.card.id)) ?? Infinity) || a.index - b.index).map(row => row.card);
}
export function moveCard(ids, index, direction) {
  const next = [...ids];
  const destination = index + direction;
  if (destination < 0 || destination >= next.length) {
    return next;
  }
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
export async function persistCardOrder(ids) {
  const value = {
    version: 1,
    ids: [...new Set(ids.map(String))]
  };
  validateCardOrder(JSON.stringify(value));
  await saveWalletCardOrder(value);
  return value.ids;
}
function CardThumb({
  card
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [card.id, card.image]);
  return <View style={s.thumb}>
      {card.image && !failed ? <Image source={typeof card.image === 'string' ? {
      uri: card.image
    } : card.image} style={s.image} resizeMode="contain" accessibilityLabel={card.name + ' 카드 이미지'} onError={() => setFailed(true)} /> : <Text style={s.hint}>이미지 확인 필요</Text>}
    </View>;
}
export default function PaymentCardOrder({
  cards = [],
  selectedId,
  onSelect,
  aiOrder = null   // AI 가 정한 순서(카드 id 목록). 사용자가 직접 끌어 옮기기 전까지 이 순서로 보여 준다
}) {
  const [savedIds, setSavedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  // 드래그 중인 카드와 이동 거리(px)
  const [drag, setDrag] = useState(null);
  const rowHeight = useRef(84);
  const mounted = useRef(true);
  const revision = useRef(0);
  const [manual, setManual] = useState(false);
  const usingAi = !manual && Array.isArray(aiOrder) && aiOrder.length > 0;
  const ordered = useMemo(() => orderCards(cards, usingAi ? aiOrder : savedIds), [cards, savedIds, usingAi, aiOrder]);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const load = async () => {
    const ticket = ++revision.current;
    setLoading(true);
    setReadError('');
    try {
      const ids = validateCardOrder(await Store.getItemAsync(CARD_ORDER_KEY));
      if (mounted.current && ticket === revision.current) {
        setSavedIds(ids);
      }
    } catch (problem) {
      if (mounted.current && ticket === revision.current) {
        setReadError(problem.message || '순서를 읽지 못했습니다.');
      }
    } finally {
      if (mounted.current && ticket === revision.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      revision.current++;
    };
  }, []);

  const targetIndex = (from, dy) => Math.max(0, Math.min(orderedRef.current.length - 1, from + Math.round(dy / rowHeight.current)));

  // 놓으면 바로 새 순서를 저장합니다. 결제 카드는 바뀌지 않습니다.
  const drop = async (from, dy) => {
    setDrag(null);
    const to = targetIndex(from, dy);
    if (to === from) return;
    const ids = orderedRef.current.map(card => String(card.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setManual(true);
    setSavedIds(ids);
    setError('');
    try {
      await persistCardOrder(ids);
    } catch (problem) {
      if (mounted.current) setError(problem.message || '순서를 저장하지 못했습니다. 다시 시도해주세요.');
    }
  };

  const responders = useRef({});
  const handleFor = (id, index) => {
    const key = id + ':' + index;
    if (!responders.current[key]) {
      responders.current[key] = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setDrag({ id, index, dy: 0 }),
        onPanResponderMove: (_, gesture) => setDrag({ id, index, dy: gesture.dy }),
        onPanResponderRelease: (_, gesture) => drop(index, gesture.dy),
        onPanResponderTerminate: () => setDrag(null),
      });
    }
    return responders.current[key].panHandlers;
  };
  useEffect(() => {
    responders.current = {};
  }, [ordered]);

  // 드래그 중 다른 카드들이 비켜나는 거리
  const shiftOf = index => {
    if (!drag) return 0;
    if (index === drag.index) return drag.dy;
    const to = targetIndex(drag.index, drag.dy);
    if (drag.index < to && index > drag.index && index <= to) return -rowHeight.current;
    if (drag.index > to && index < drag.index && index >= to) return rowHeight.current;
    return 0;
  };

  return <View style={s.box}>
      <Text style={s.heading}>
        내 카드 · {cards.length}장
      </Text>

      <Text style={s.hint}>
        카드를 누르면 결제 카드가 바뀌어요. 오른쪽 ☰ 를 눌러 위아래로 끌면 순서를 바꿀 수 있어요.
      </Text>

      {usingAi && <Text style={s.link}>
          AI가 지금 결제에 맞춰 정한 순서예요.
        </Text>}

      {loading && <ActivityIndicator color="#245DE5" />}

      {!!readError && <View>
          <Text style={s.error}>{readError}</Text>

          <TouchableOpacity style={s.edit} onPress={load}>
            <Text style={s.link}>
              순서 다시 불러오기
            </Text>
          </TouchableOpacity>
        </View>}

      {ordered.map((card, index) => {
        const dragging = drag?.id === card.id;
        return <View key={card.id}
            onLayout={index === 0 ? event => { rowHeight.current = event.nativeEvent.layout.height + 12; } : undefined}
            style={[s.dragRow, { transform: [{ translateY: shiftOf(index) }] }, dragging && s.dragging]}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={index + 1 + '번 ' + card.name + (card.id === selectedId ? ' 선택됨' : '')} accessibilityState={{
            selected: card.id === selectedId
          }} disabled={!!drag} onPress={() => onSelect?.(card)} style={[s.item, s.itemFlex, card.id === selectedId && s.selected]}>
              <CardThumb card={card} />

              <View style={s.copy}>
                <Text style={s.name}>{card.name}</Text>
                <Text style={s.hint}>{card.issuer}</Text>

                {card.id === selectedId && <Text style={s.link}>
                    ✓ 현재 결제 카드
                  </Text>}
              </View>

              <View {...handleFor(card.id, index)} accessibilityRole="adjustable" accessibilityLabel={card.name + ' 순서 이동 손잡이'} style={s.handle}>
                <Text style={s.handleText}>☰</Text>
              </View>
            </TouchableOpacity>
          </View>;
      })}

      {!!error && <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>}
    </View>;
}
const s = StyleSheet.create({
  dragRow: {
    zIndex: 1
  },
  dragging: {
    zIndex: 10,
    opacity: 0.95,
    shadowColor: '#0B2A6F',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6
  },
  itemFlex: {
    alignItems: 'center'
  },
  handle: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    cursor: 'grab',
    userSelect: 'none',
    touchAction: 'none'
  },
  handleText: {
    fontSize: 22,
    color: '#8A9BB4',
    userSelect: 'none'
  },
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  heading: {
    fontSize: 17,
    fontWeight: '800',
    color: "#142D4E"
  },
  edit: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#EDF3FF",
    borderRadius: 10,
    minHeight: 44
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: "#5A6E89"
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 16
  },
  selected: {
    borderColor: "#245DE5",
    backgroundColor: "#EDF3FF"
  },
  number: {
    width: 20,
    fontSize: 13,
    fontWeight: '800',
    color: '#91A0B8'
  },
  thumb: {
    width: 72,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center'
  },
  image: {
    width: '100%',
    height: '100%'
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 5
  },
  name: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: '#2C466D'
  },
  overlay: {
    flex: 1,
    backgroundColor: '#0007',
    justifyContent: 'flex-end'
  },
  sheet: {
    height: '86%',
    backgroundColor: "#F4F7FB",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden'
  },
  modalHeader: {
    padding: 22,
    gap: 8,
    backgroundColor: "#FFFFFF"
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  list: {
    padding: 18,
    gap: 14
  },
  draftItem: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    gap: 12
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  arrow: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: "#EDF3FF",
    borderRadius: 10,
    minHeight: 44
  },
  footer: {
    flexShrink: 0,
    padding: 18,
    paddingBottom: 30,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderColor: "#E3EAF4",
    gap: 10
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center"
  },
  cancel: {
    flex: 1,
    padding: 16,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 44
  },
  save: {
    flex: 2,
    padding: 16,
    backgroundColor: "#245DE5",
    alignItems: 'center',
    borderRadius: 12,
    minHeight: 44
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    lineHeight: 22
  },
  disabled: {
    opacity: 0.35
  }
});
