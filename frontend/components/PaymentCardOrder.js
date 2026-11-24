import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Store from '../utils/demoStore';
import { CARD_ORDER_KEY, saveWalletCardOrder } from '../utils/wallet';
import { orderButton, orderHint, syncAction } from '../utils/autoPlacementCore';

const ROW_GAP = 12;
const CARDS_PER_PAGE = 5;
const IS_WEB = Platform.OS === 'web';

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
  syncSelection = true,
  aiOrder = null,  // AI 가 정한 순서(카드 id 목록). 사용자가 직접 끌어 옮기기 전까지 이 순서로 보여 준다
  // 홈 '내 카드' (2026-11-24 수정사항·수정사항2): 자동 배치 ON/OFF. 주면 '순서 변경' 버튼을 쓴다.
  //   ON 이면 AI 순서를 따른다. '순서 변경'을 눌러야만 ☰ 손잡이가 생겨 순서를 바꿀 수 있고(평소엔 카드를 눌러도 안 바뀜),
  //   ON 에서 누르면 먼저 묻고 OFF(onAutoChange(false)) 뒤 편집한다. 결제 화면은 주지 않는다(늘 ☰, 카드를 누르면 선택).
  autoOn,
  onAutoChange,
  // 끄는 동안 true (홈 화면이 스크롤을 잠근다: 폰에서 끌기와 화면 스크롤이 겹쳐 카드가 튀던 문제, 2026-11-24 수정사항2)
  onDragActiveChange
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
  const homeMode = autoOn !== undefined;
  const hasAiOrder = Array.isArray(aiOrder) && aiOrder.length > 0;
  const usingAi = homeMode ? Boolean(autoOn) && hasAiOrder : !manual && hasAiOrder;
  const ordered = useMemo(() => orderCards(cards, usingAi ? aiOrder : savedIds), [cards, savedIds, usingAi, aiOrder]);
  // 홈 '순서 변경' 편집 중인지, 자동 배치 중에 눌러 묻는 창이 열렸는지
  const [editing, setEditing] = useState(false);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const canDrag = !homeMode || editing;
  const button = homeMode ? orderButton({ editing, autoOn: Boolean(autoOn) }) : null;
  // 자동 배치를 끌 때 보이던 AI 순서를 내 순서로 저장한다 (끄는 순간 목록이 갑자기 바뀌지 않게, 편집도 그 순서에서 시작)
  const lastAiShown = useRef(null);
  if (usingAi) lastAiShown.current = ordered.map(card => String(card.id));
  const previousAuto = useRef(autoOn);
  const visibleCards = ordered.slice(0, visibleCount);
  const nextPageSize = Math.min(CARDS_PER_PAGE, ordered.length - visibleCards.length);
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;
  const firstId = ordered[0]?.id;
  // syncSelection 일 때는 '맨 위 카드 = 결제 카드'를 지킵니다.
  // - 이 목록에서 순서를 바꾸면(누르기·끌기) 맨 위 카드를 결제 카드로 고릅니다.
  // - 다른 곳(카드 탭·QR 결제 창·결제 화면)에서 결제 카드를 바꾸면 그 카드를 맨 위로 올려 저장합니다.
  const lastSynced = useRef({ firstId: undefined, selectedId: undefined });

  useEffect(() => {
    if (!syncSelection || loading || readError || firstId == null) return;
    const last = lastSynced.current;
    lastSynced.current = { firstId, selectedId };
    const selectedIndex = ordered.findIndex(card => card.id === selectedId);
    // 자동 배치 중(AI 순서 있음)이면 언제나 AI 1순위가 결제 카드다 (autoPlacementCore.syncAction)
    const action = syncAction({ autoOn: Boolean(autoOn), usingAi, firstId, selectedId, lastSelectedId: last.selectedId, selectedIndex });
    if (action === 'moveSelectedToTop') saveMove(ordered, selectedIndex, 0);
    else if (action === 'selectTop') onSelect?.(firstId);
  }, [firstId, loading, onSelect, readError, selectedId, syncSelection, usingAi, autoOn]);
  useEffect(() => {
    const was = previousAuto.current;
    previousAuto.current = autoOn;
    if (homeMode && autoOn) setEditing(false);       // 편집 중에 스위치로 다시 켜면 편집을 끝낸다
    if (!homeMode || was !== true || autoOn !== false) return;
    const ids = lastAiShown.current;
    if (!ids?.length) return;
    setSavedIds(ids);
    persistCardOrder(ids).catch(problem => { if (mounted.current) setError(problem.message || '순서를 저장하지 못했습니다.'); });
  }, [autoOn]);
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
  const dragActive = useRef(onDragActiveChange);
  dragActive.current = onDragActiveChange;
  useEffect(() => {
    mounted.current = true;
    load();
    return () => {
      mounted.current = false;
      revision.current++;
      if (drag.current) dragActive.current?.(false);   // 끄는 중에 화면을 떠나도 홈 스크롤 잠금을 푼다
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

  // 사용자가 순서를 바꿀 때(끌기·화살표). 홈은 '순서 변경' 편집 중에만 (편집을 시작할 때 자동 배치는 이미 꺼져 있다)
  const requestMove = (cards, from, to) => {
    if (!canDrag) return;
    saveMove(cards, from, to);
    // 결제 화면(syncSelection=false, 2026-11-24 사용자 결정 'PR #10: 맨 위가 바뀔 때만 선택'):
    // 끌어서 맨 위 카드가 실제로 바뀌었을 때만 그 카드를 결제 카드로 고른다. 맨 위가 그대로면 AI·일정이 고른 카드를 지킨다.
    if (!syncSelection && from !== to) {
      const next = [...cards];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      if (next[0] && next[0].id !== cards[0]?.id) onSelect?.(next[0].id);
    }
  };
  const pressOrderButton = () => {
    if (button.action === 'finish') setEditing(false);
    else if (button.action === 'confirm') setConfirmEdit(true);
    else setEditing(true);
  };
  const confirmOrderEdit = () => {
    setConfirmEdit(false);
    onAutoChange?.(false);     // 보이던 AI 순서를 내 순서로 저장한다 (위 효과)
    setEditing(true);
  };

  const rowFor = id => {
    if (!rows.current.has(id)) {
      rows.current.set(id, { y: new Animated.Value(0), height: 88 });
    }
    return rows.current.get(id);
  };

  // 폰에서도 JS 로 움직인다: 끝낼 때 새 순서와 위치 0 을 한 번에 그려야 카드가 두 번 튀지 않는다 (네이티브 드라이버는
  // 값이 따로 반영돼 한 프레임 동안 옛 위치가 남았다, 2026-11-24 수정사항2 'Expo 에서 여러 카드가 움직임')
  const animate = (row, toValue) => Animated.timing(row.y, {
    toValue,
    duration: 150,
    useNativeDriver: false,
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
    onDragActiveChange?.(true);
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
      if (!mounted.current) return;
      onDragActiveChange?.(false);
      if (drag.current !== session) return;
      const currentCards = orderedRef.current;
      if (currentCards.length === cards.length && cards.every((card, index) => card.id === currentCards[index].id)) {
        // 그 사이 목록이 바뀌었으면 저장하지 않는다 (아래 레이아웃 효과가 위치를 되돌려 지금 순서가 보인다)
        requestMove(cards, from, to);
      }
      // 새 순서와 '위치 0'(아래 transform)이 같은 그리기에 들어간다
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
      requestMove(ordered, index, destination);
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
        // 폰 브라우저가 스크롤 등으로 터치를 가져가면 끌기를 취소한다 (PR #10)
        onPointerCancel: event => {
          if (drag.current?.pointerId === event.pointerId) finishDrag(true);
        },
      };
    }
    const row = rowFor(id);
    if (!row.pan) {
      row.pan = PanResponder.create({
        // 손잡이를 잡으면 화면 스크롤보다 먼저 가져간다
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
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
      <View style={s.headRow}>
        <Text style={[s.heading, s.flexOne]}>
          내 카드 · {cards.length}장
        </Text>
        {/* '순서 변경'을 눌러야만 ☰ 로 순서를 바꾼다. 편집 중이면 '완료' (자동 배치 켜고 끄기는 위 '자동 배치' 스위치) */}
        {homeMode && <TouchableOpacity accessibilityRole="button" accessibilityLabel={button.label === '완료' ? '순서 변경 완료' : '카드 순서 변경'}
          disabled={draggedId !== null || loading || Boolean(readError)}
          onPress={pressOrderButton} style={[s.autoPill, editing ? s.autoPillOn : s.autoPillOff]}>
          <Text style={editing ? s.autoPillOnText : s.autoPillOffText}>{button.label}</Text>
        </TouchableOpacity>}
      </View>

      <Text style={s.hint}>
        {homeMode ? orderHint({ editing, autoOn: Boolean(autoOn) }) : '카드를 눌러 선택하고, ☰를 끌어 순서를 바꿔요.'}
      </Text>

      {!homeMode && usingAi && <Text style={s.link}>
          지금 결제에 맞춰 정한 순서예요.
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
        // 결제 화면(syncSelection=false)은 순서와 결제 카드가 따로라서, 실제로 고른 카드에 표시합니다.
        const selected = syncSelection ? index === 0 : card.id === selectedId;
        const body = <>
          <CardThumb card={card} />

          <View style={s.copy}>
            <Text style={s.name}>{card.name}</Text>
            <Text style={s.hint}>{card.issuer}</Text>

            <Text style={s.link}>{selected ? '✓ 현재 결제 카드' : '\u00A0'}</Text>
          </View>
        </>;
        // 끄는 중에만 움직이는 값(row.y)을 붙인다. 끝나면 새 순서와 위치 0 이 한 번에 그려진다
        return <Animated.View key={card.id}
            onLayout={event => { row.height = event.nativeEvent.layout.height; }}
            style={[s.item, { transform: [{ translateY: draggedId !== null ? row.y : 0 }] }, draggedId === card.id && s.dragging]}>
            {/* 홈은 카드를 눌러도 순서가 바뀌지 않는다 ('순서 변경'에서만). 결제 화면은 누르면 그 카드로 결제 */}
            {homeMode ? <View accessible accessibilityLabel={index + 1 + '번 ' + card.name + (selected ? ', 현재 결제 카드' : '')}
                style={s.itemButton}>{body}</View>
              : <TouchableOpacity accessibilityRole="button" accessibilityLabel={index + 1 + '번 ' + card.name} accessibilityState={{ selected }}
                  disabled={draggedId !== null || loading || Boolean(readError)} onPress={() => onSelect?.(card.id)} style={s.itemButton}>
                  {body}
                </TouchableOpacity>}

              {canDrag && <View {...handleFor(card.id, index)} accessibilityRole="adjustable" accessibilityLabel={card.name + ' 순서 이동 손잡이'}
                accessibilityValue={{ min: 1, max: visibleCards.length, now: index + 1 }}
                accessibilityActions={[{ name: 'decrement' }, { name: 'increment' }]}
                onAccessibilityAction={event => moveWithArrow(index, event.nativeEvent.actionName === 'decrement' ? -1 : 1)}
                style={[s.handle, draggedId === card.id && s.grabbing]}>
                <Text style={s.handleText}>☰</Text>
              </View>}
          </Animated.View>;
      })}

      {nextPageSize > 0 && <TouchableOpacity accessibilityRole="button" disabled={draggedId !== null}
        onPress={() => setVisibleCount(count => count + CARDS_PER_PAGE)} style={s.moreButton}>
        <Text style={s.link}>{nextPageSize}장 더 보기</Text>
      </TouchableOpacity>}

      {!!error && <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>}

      {/* 자동 배치 중에 '순서 변경'을 누르면 먼저 묻는다 (2026-11-24 수정사항2 결정) */}
      <Modal visible={confirmEdit} transparent animationType="fade" onRequestClose={() => setConfirmEdit(false)}>
        <View style={s.dialogBackdrop}>
          <View style={s.dialog} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={s.dialogTitle}>카드 순서를 직접 바꿀까요?</Text>
            <Text style={s.dialogText}>직접 순서를 정하면 자동 배치가 꺼지고, 1순위 카드로 결제해요. 위의 '자동 배치' 스위치로 언제든 다시 켤 수 있어요.</Text>
            <View style={s.dialogActions}>
              <TouchableOpacity accessibilityRole="button" onPress={() => setConfirmEdit(false)} style={[s.dialogButton, s.dialogCancel]}>
                <Text style={s.dialogCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={confirmOrderEdit} style={[s.dialogButton, s.dialogConfirm]}>
                <Text style={s.dialogConfirmText}>바꾸기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flexOne: { flex: 1, minWidth: 0 },
  autoPill: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1 },
  autoPillOn: { backgroundColor: '#245DE5', borderColor: '#245DE5' },
  autoPillOff: { backgroundColor: '#FFFFFF', borderColor: '#C9D3E3' },
  autoPillOnText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  autoPillOffText: { color: '#62738D', fontSize: 12, fontWeight: '800' },
  dialogBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(12, 22, 44, 0.45)' },
  dialog: { width: '100%', maxWidth: 360, gap: 12, padding: 20, borderRadius: 20, backgroundColor: '#FFFFFF' },
  dialogTitle: { color: '#142D4E', fontSize: 17, fontWeight: '800' },
  dialogText: { color: '#526783', fontSize: 14, lineHeight: 20 },
  dialogActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  dialogButton: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dialogCancel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#BFD3FA' },
  dialogConfirm: { backgroundColor: '#245DE5' },
  dialogCancelText: { color: '#245DE5', fontSize: 15, fontWeight: '800' },
  dialogConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
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
