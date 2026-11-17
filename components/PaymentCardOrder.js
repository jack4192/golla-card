import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import * as Store from '../utils/demoStore';

export const CARD_ORDER_KEY = 'solpay_payment_card_order_v1';

export function validateCardOrder(raw) {
  if (raw === null) return [];

  const value = JSON.parse(raw);

  if (
    value?.version !== 1 ||
    !Array.isArray(value.ids) ||
    value.ids.length > 200 ||
    value.ids.some(
      id => typeof id !== 'string' || id.length > 100
    )
  ) {
    throw Error('저장된 카드 순서 형식을 확인해주세요.');
  }

  return [...new Set(value.ids)];
}

export function orderCards(cards, ids) {
  const rank = new Map(
    ids.map((id, index) => [String(id), index])
  );

  return cards
    .map((card, index) => ({ card, index }))
    .sort(
      (a, b) =>
        (rank.get(String(a.card.id)) ?? Infinity) -
          (rank.get(String(b.card.id)) ?? Infinity) ||
        a.index - b.index
    )
    .map(row => row.card);
}

export function moveCard(ids, index, direction) {
  const next = [...ids];
  const destination = index + direction;

  if (destination < 0 || destination >= next.length) {
    return next;
  }

  [next[index], next[destination]] = [
    next[destination],
    next[index],
  ];

  return next;
}

export async function persistCardOrder(ids) {
  const value = {
    version: 1,
    ids: [...new Set(ids.map(String))],
  };

  validateCardOrder(JSON.stringify(value));

  await Store.setItemAsync(
    CARD_ORDER_KEY,
    JSON.stringify(value)
  );

  return value.ids;
}

function CardThumb({ card }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [card.id, card.image]);

  return (
    <View style={s.thumb}>
      {card.image && !failed ? (
        <Image
          source={
            typeof card.image === 'string'
              ? { uri: card.image }
              : card.image
          }
          style={s.image}
          resizeMode="contain"
          accessibilityLabel={card.name + ' 카드 이미지'}
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={s.hint}>이미지 확인 필요</Text>
      )}
    </View>
  );
}

export default function PaymentCardOrder({
  cards = [],
  selectedId,
  onSelect,
}) {
  const [savedIds, setSavedIds] = useState([]);
  const [draftIds, setDraftIds] = useState([]);

  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [readError, setReadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const mounted = useRef(true);
  const lock = useRef(false);
  const revision = useRef(0);

  const ordered = useMemo(
    () => orderCards(cards, savedIds),
    [cards, savedIds]
  );

  const draft = useMemo(
    () => orderCards(cards, draftIds),
    [cards, draftIds]
  );

  const load = async () => {
    const ticket = ++revision.current;

    setLoading(true);
    setReadError('');

    try {
      const ids = validateCardOrder(
        await Store.getItemAsync(CARD_ORDER_KEY)
      );

      if (
        mounted.current &&
        ticket === revision.current
      ) {
        setSavedIds(ids);
      }
    } catch (problem) {
      if (
        mounted.current &&
        ticket === revision.current
      ) {
        setReadError(
          problem.message || '순서를 읽지 못했습니다.'
        );
      }
    } finally {
      if (
        mounted.current &&
        ticket === revision.current
      ) {
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

  const begin = () => {
    if (loading || readError || lock.current) return;

    setDraftIds(
      ordered.map(card => String(card.id))
    );

    setError('');
    setNotice('');
    setEditing(true);
  };

  const cancel = () => {
    if (lock.current) return;

    setEditing(false);
    setDraftIds([]);
    setError('');
  };

  const move = (index, direction) => {
    if (lock.current) return;

    setDraftIds(
      moveCard(
        draft.map(card => String(card.id)),
        index,
        direction
      )
    );

    setError('');
  };

  const save = async () => {
    if (lock.current) return;

    lock.current = true;
    setSaving(true);
    setError('');

    try {
      const ids = await persistCardOrder(
        draft.map(card => String(card.id))
      );

      if (!mounted.current) return;

      setSavedIds(ids);
      setEditing(false);

      setNotice(
        '카드 순서를 저장했습니다. 결제 카드는 그대로 유지됩니다.'
      );
    } catch (problem) {
      if (mounted.current) {
        setError(
          problem.message ||
            '순서를 저장하지 못했습니다. 다시 시도해주세요.'
        );
      }
    } finally {
      lock.current = false;

      if (mounted.current) {
        setSaving(false);
      }
    }
  };

  return (
    <View style={s.box}>
      <View style={s.header}>
        <Text style={s.heading}>
          내 카드 · {cards.length}장
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          disabled={
            loading || !!readError || !cards.length
          }
          style={s.edit}
          onPress={begin}
        >
          <Text style={s.link}>수정</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.hint}>
        카드를 누르면 결제 카드가 바뀝니다. 수정에서 표시 순서를 바꿀 수 있습니다.
      </Text>

      {loading && (
        <ActivityIndicator color="#245DE5" />
      )}

      {!!readError && (
        <View>
          <Text style={s.error}>{readError}</Text>

          <TouchableOpacity
            style={s.edit}
            onPress={load}
          >
            <Text style={s.link}>
              순서 다시 불러오기
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {ordered.map((card, index) => (
        <TouchableOpacity
          key={card.id}
          accessibilityRole="button"
          accessibilityLabel={
            index + 1 +
            '번 ' +
            card.name +
            (card.id === selectedId ? ' 선택됨' : '')
          }
          accessibilityState={{
            selected: card.id === selectedId,
          }}
          onPress={() => onSelect?.(card)}
          style={[
            s.item,
            card.id === selectedId && s.selected,
          ]}
        >
          <Text style={s.number}>{index + 1}</Text>

          <CardThumb card={card} />

          <View style={s.copy}>
            <Text style={s.name}>{card.name}</Text>
            <Text style={s.hint}>{card.issuer}</Text>

            {card.id === selectedId && (
              <Text style={s.link}>
                ✓ 현재 결제 카드
              </Text>
            )}
          </View>
        </TouchableOpacity>
      ))}

      {!!notice && (
        <Text
          style={s.hint}
          accessibilityLiveRegion="polite"
        >
          {notice}
        </Text>
      )}

      <Modal
        visible={editing}
        transparent
        animationType="slide"
        onRequestClose={cancel}
      >
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.modalHeader}>
              <Text style={s.heading}>
                내 카드 순서 수정
              </Text>

              <Text style={s.hint}>
                위·아래 버튼으로 이동하세요. 선택된 결제 카드는 바뀌지 않습니다.
              </Text>
            </View>

            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.list}
              keyboardShouldPersistTaps="handled"
            >
              {draft.map((card, index) => (
                <View
                  key={card.id}
                  style={s.draftItem}
                >
                  <View style={s.row}>
                    <Text style={s.number}>
                      {index + 1}
                    </Text>

                    <CardThumb card={card} />

                    <View style={s.copy}>
                      <Text style={s.name}>
                        {card.name}
                      </Text>

                      {card.id === selectedId && (
                        <Text style={s.link}>
                          현재 결제 카드
                        </Text>
                      )}
                    </View>
                  </View>

                  <View style={s.actions}>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={
                        card.name + ' 위로 이동'
                      }
                      disabled={saving || index === 0}
                      onPress={() => move(index, -1)}
                      style={[
                        s.arrow,
                        (saving || index === 0) &&
                          s.disabled,
                      ]}
                    >
                      <Text style={s.link}>↑ 위로</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={
                        card.name + ' 아래로 이동'
                      }
                      disabled={
                        saving ||
                        index === draft.length - 1
                      }
                      onPress={() => move(index, 1)}
                      style={[
                        s.arrow,
                        (saving ||
                          index === draft.length - 1) &&
                          s.disabled,
                      ]}
                    >
                      <Text style={s.link}>
                        ↓ 아래로
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={s.footer}>
              {!!error && (
                <Text
                  style={s.error}
                  accessibilityRole="alert"
                >
                  {error}
                </Text>
              )}

              <View style={s.footerRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={cancel}
                  style={[
                    s.cancel,
                    saving && s.disabled,
                  ]}
                >
                  <Text style={s.link}>취소</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={save}
                  style={[
                    s.save,
                    saving && s.disabled,
                  ]}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={s.white}>
                      순서 저장
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: '#E7EDF7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#233E63',
  },
  edit: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#EDF3FF',
    borderRadius: 10,
  },
  link: {
    color: '#245DE5',
    fontSize: 12,
    fontWeight: '700',
  },
  hint: {
    fontSize: 12,
    lineHeight: 20,
    color: '#8391A7',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E6EDF7',
    borderRadius: 14,
  },
  selected: {
    borderColor: '#245DE5',
    backgroundColor: '#F0F5FF',
  },
  number: {
    width: 20,
    fontSize: 13,
    fontWeight: '800',
    color: '#91A0B8',
  },
  thumb: {
    width: 72,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  name: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '700',
    color: '#2C466D',
  },
  overlay: {
    flex: 1,
    backgroundColor: '#0007',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: '86%',
    backgroundColor: '#F5F7FC',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  modalHeader: {
    padding: 20,
    gap: 8,
    backgroundColor: '#FFF',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  draftItem: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  arrow: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: '#EDF3FF',
    borderRadius: 10,
  },
  footer: {
    flexShrink: 0,
    padding: 18,
    paddingBottom: 32,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderColor: '#DEE6F1',
    gap: 10,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancel: {
    flex: 1,
    padding: 16,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    borderRadius: 12,
  },
  save: {
    flex: 2,
    padding: 16,
    backgroundColor: '#245DE5',
    alignItems: 'center',
    borderRadius: 12,
  },
  white: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '800',
  },
  error: {
    color: '#B93751',
    fontSize: 13,
    lineHeight: 22,
  },
  disabled: {
    opacity: 0.35,
  },
});
