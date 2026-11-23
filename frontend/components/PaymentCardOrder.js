import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Store from '../utils/demoStore';
import { CARD_ORDER_KEY, saveWalletCardOrder } from '../utils/wallet';

const ROW_GAP = 12;
const CARDS_PER_PAGE = 5;
const IS_WEB = Platform.OS === 'web';

export function validateCardOrder(raw) {
  if (raw === null) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.ids) || value.ids.some(id => typeof id !== 'string' || id.length > 100)) {
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
  syncSelection = true,
  aiOrder = null   // AI 가 정한 순서(카드 id 목록). 사용자가 직접 끌어 옮기기 전까지 이 순서로 보여 준다
}) {
  const [savedIds, setSavedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const drag = useRef(null);
  const rows = useRef(new Map());
  const writeRevision = useRef(0);
  const mounted = useRef(true);
  const revision = useRef(0);
  const [manual, setManual] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CARDS_PER_PAGE);
  const usingAi = !manual && Array.isArray(aiOrder) && aiOrder.length > 0;
  const ordered = useMemo(() => orderCards(cards, usingAi ? aiOrder : savedIds), [cards, savedIds, usingAi, aiOrder]);
  const visibleCards = ordered.slice(0, visibleCount);
  const nextPageSize = Math.min(CARDS_PER_PAGE, ordered.length - visibleCards.length);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const firstId = ordered[0]?.id;

  useEffect(() => {
    if (syncSelection && !loading && !readError && firstId != null && firstId !== selectedId) {
      onSelect?.(firstId);
    }
  }, [firstId, loading, onSelect, readError, selectedId, syncSelection]);
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

  const saveMove = async (cards, from, to) => {
    if (from === to && !error) return;
    const ticket = ++writeRevision.current;
    const ids = cards.map(card => String(card.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setManual(true);
    setSavedIds(ids);
    setError('');
    try {
      await persistCardOrder(ids);
    } catch (problem) {
      if (mounted.current && ticket === writeRevision.current) {
        setError(problem.message || '순서를 저장하지 못했습니다. 다시 시도해주세요.');
      }
    }
  };

  const rowFor = id => {
    if (!rows.current.has(id)) {
      rows.current.set(id, { y: new Animated.Value(0), height: 88 });
    }
    return rows.current.get(id);
  };

  const animate = (row, toValue) => Animated.timing(row.y, {
    toValue,
    duration: 150,
    useNativeDriver: !IS_WEB,
    isInteraction: false,
  });

  const startDrag = (id, pointerId, startY = 0) => {
    if (drag.current || loading || readError) return false;
    const cards = orderedRef.current;
    const from = cards.findIndex(card => card.id === id);
    if (from < 0) return false;

    const measuredRows = cards.slice(0, visibleCount).map(card => rowFor(card.id));
    let top = 0;
    const tops = measuredRows.map(row => {
      const position = top;
      top += row.height + ROW_GAP;
      return position;
    });
    drag.current = { id, pointerId, startY, cards, rows: measuredRows, tops, from, to: from, settling: false };
    setDraggedId(id);
    return true;
  };

  const moveDrag = dy => {
    const session = drag.current;
    if (!session || session.settling) return;
    const { rows, tops, from } = session;
    const last = rows.length - 1;
    const distance = Math.max(-tops[from], Math.min(topForDrop(session, last), dy));
    rows[from].y.setValue(distance);

    let to = from;
    while (to > 0 && distance < (topForDrop(session, to - 1) + topForDrop(session, to)) / 2) to -= 1;
    while (to < last && distance > (topForDrop(session, to + 1) + topForDrop(session, to)) / 2) to += 1;
    if (to === session.to) return;
    session.to = to;
    rows.forEach((row, index) => {
      if (index !== from) animate(row, shiftForDrop(session, index)).start();
    });
  };

  const finishDrag = (cancel = false) => {
    const session = drag.current;
    if (!session || session.settling) return;
    session.settling = true;
    const { cards, rows, from } = session;
    const to = cancel ? from : session.to;
    session.to = to;
    Animated.parallel(rows.map((row, index) => animate(row,
      index === from ? topForDrop(session, to) : shiftForDrop(session, index)
    ))).start(() => {
      if (!mounted.current || drag.current !== session) return;
      const currentCards = orderedRef.current;
      if (currentCards.length === cards.length && cards.every((card, index) => card.id === currentCards[index].id)) {
        saveMove(cards, from, to);
      }
      setDraggedId(null);
    });
  };

  // Clear transforms after React applies the new list order.
  useLayoutEffect(() => {
    if (draggedId !== null || !drag.current) return;
    for (const row of drag.current.rows) row.y.setValue(0);
    drag.current = null;
  }, [draggedId]);

  const dragCallbacks = useRef(null);
  dragCallbacks.current = { startDrag, moveDrag, finishDrag };
  const moveWithArrow = (index, direction) => {
    const destination = index + direction;
    if (!drag.current && !loading && !readError && destination >= 0 && destination < visibleCards.length) {
      saveMove(ordered, index, destination);
    }
  };
  const handleFor = (id, index) => {
    if (IS_WEB) {
      return {
        tabIndex: 0,
        onKeyDown: event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault();
          moveWithArrow(index, event.key === 'ArrowUp' ? -1 : 1);
        },
        onPointerDown: event => {
          if (event.button !== 0 || !event.isPrimary || !startDrag(id, event.pointerId, event.clientY)) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
        },
        onPointerMove: event => {
          const session = drag.current;
          if (session?.pointerId === event.pointerId) moveDrag(event.clientY - session.startY);
        },
        onPointerUp: event => {
          const session = drag.current;
          if (session?.pointerId !== event.pointerId) return;
          moveDrag(event.clientY - session.startY);
          finishDrag();
        },
        onLostPointerCapture: event => {
          if (drag.current?.pointerId === event.pointerId) finishDrag(true);
        },
      };
    }
    const row = rowFor(id);
    if (!row.pan) {
      row.pan = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => dragCallbacks.current.startDrag(id),
        onPanResponderMove: (_, gesture) => dragCallbacks.current.moveDrag(gesture.dy),
        onPanResponderRelease: () => dragCallbacks.current.finishDrag(),
        onPanResponderTerminate: () => dragCallbacks.current.finishDrag(true),
      });
    }
    return row.pan.panHandlers;
  };

  return <View style={s.box}>
      <Text style={s.heading}>
        내 카드 · {cards.length}장
      </Text>

      <Text style={s.hint}>
        카드를 눌러 선택하고, ☰를 끌어 순서를 바꿔요.
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

      {visibleCards.map((card, index) => {
        const row = rowFor(card.id);
        const selected = index === 0;
        return <Animated.View key={card.id}
            onLayout={event => { row.height = event.nativeEvent.layout.height; }}
            style={[s.item, { transform: [{ translateY: row.y }] }, draggedId === card.id && s.dragging]}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={index + 1 + '번 ' + card.name} accessibilityState={{ selected }}
              disabled={draggedId !== null || loading || Boolean(readError)} onPress={() => saveMove(ordered, index, 0)} style={s.itemButton}>
              <CardThumb card={card} />

              <View style={s.copy}>
                <Text style={s.name}>{card.name}</Text>
                <Text style={s.hint}>{card.issuer}</Text>

                <Text style={s.link}>{selected ? '✓ 현재 결제 카드' : '\u00A0'}</Text>
              </View>
            </TouchableOpacity>

              <View {...handleFor(card.id, index)} accessibilityRole="adjustable" accessibilityLabel={card.name + ' 순서 이동 손잡이'}
                accessibilityValue={{ min: 1, max: visibleCards.length, now: index + 1 }}
                accessibilityActions={[{ name: 'decrement' }, { name: 'increment' }]}
                onAccessibilityAction={event => moveWithArrow(index, event.nativeEvent.actionName === 'decrement' ? -1 : 1)}
                style={[s.handle, draggedId === card.id && s.grabbing]}>
                <Text style={s.handleText}>☰</Text>
              </View>
          </Animated.View>;
      })}

      {nextPageSize > 0 && <TouchableOpacity accessibilityRole="button" disabled={draggedId !== null}
        onPress={() => setVisibleCount(count => count + CARDS_PER_PAGE)} style={s.moreButton}>
        <Text style={s.link}>{nextPageSize}장 더 보기</Text>
      </TouchableOpacity>}

      {!!error && <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>}
    </View>;
}

function topForDrop({ rows, tops, from }, to) {
  const heightDelta = to > from ? rows[to].height - rows[from].height : 0;
  return tops[to] - tops[from] + heightDelta;
}

function shiftForDrop({ rows, from, to }, index) {
  const stride = rows[from].height + ROW_GAP;
  if (from < index && index <= to) return -stride;
  if (to <= index && index < from) return stride;
  return 0;
}

const s = StyleSheet.create({
  moreButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#E3EAF4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
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
  itemButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  grabbing: {
    cursor: 'grabbing'
  },
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    gap: ROW_GAP,
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
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 16
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
