import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  EVENT_OPTIONS,
  confirmToday,
  dateKey,
  deleteEvent,
  eventLabel,
  readEvents,
  saveEvent,
  shiftDate,
  validDate,
} from '../utils/routineData';

export default function SpecialScheduleModal({
  visible,
  onClose,
  onChanged,
  onConfirmed,
  readOnly = false,
}) {
  const [date, setDate] = useState(dateKey);
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [types, setTypes] = useState([]);
  const [memo, setMemo] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const lock = useRef(false);

  useEffect(() => {
    if (!visible) return;

    let active = true;

    setLoading(true);
    setLoadError('');

    readEvents()
      .then(value => {
        if (active) setEvents(value);
      })
      .catch(() => {
        if (active) {
          setLoadError(
            '일정을 불러오지 못했습니다. 기존 기록 보호를 위해 변경을 중지했습니다.'
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [visible, reload]);

  const clear = () => {
    setEditing(null);
    setTypes([]);
    setMemo('');
  };

  const run = async action => {
    if (readOnly || lock.current || loading || loadError) return;

    lock.current = true;
    setBusy(true);
    setMessage('');

    try {
      await action();
    } catch (error) {
      setMessage(
        error?.message || '처리에 실패했습니다. 다시 시도해주세요.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await saveEvent({
        id: editing,
        date,
        types,
        memo,
      });

      clear();
      setEvents(await readEvents());
      setMessage('일정을 저장했습니다.');
      onChanged?.();
    });

  const remove = id =>
    run(async () => {
      await deleteEvent(id);

      if (editing === id) {
        clear();
      }

      setEvents(await readEvents());
      setMessage('일정을 삭제했습니다.');
      onChanged?.();
    });

  const confirm = () =>
    run(async () => {
      if (date !== dateKey()) {
        throw Error('오늘 날짜로 이동한 후 확인해주세요.');
      }

      if (editing || types.length || memo.trim()) {
        throw Error(
          '작성 중인 일정을 먼저 저장하거나 입력 취소해주세요.'
        );
      }

      await confirmToday();
      onConfirmed?.();
      onClose?.();
    });

  const disabled =
    busy || loading || Boolean(loadError) || readOnly;

  const list = validDate(date)
    ? events.filter(event => event.date === date)
    : [];

  const close = () => {
    if (!lock.current) {
      onClose?.();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            <Text style={styles.title}>오늘과 앞으로의 일정</Text>

            <Text style={styles.hint}>
              날짜별로 일정을 관리하고 오늘의 카드 혜택에 반영하세요.
            </Text>

            <View style={styles.row}>
              <TouchableOpacity
                disabled={busy}
                style={styles.small}
                onPress={() => setDate(shiftDate(date, -1))}
              >
                <Text>← 전날</Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={busy}
                style={styles.small}
                onPress={() => setDate(dateKey())}
              >
                <Text>오늘</Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={busy}
                style={styles.small}
                onPress={() => setDate(shiftDate(date, 1))}
              >
                <Text>다음 날 →</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              accessibilityLabel="일정 날짜"
              style={styles.input}
              value={date}
              onChangeText={setDate}
              editable={!busy}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              autoCapitalize="none"
            />

            {!validDate(date) && (
              <Text style={styles.error}>
                실제 존재하는 날짜를 YYYY-MM-DD로 입력해주세요.
              </Text>
            )}

            {loading && (
              <ActivityIndicator color="#245DE5" />
            )}

            {!!loadError && (
              <>
                <Text style={styles.error}>{loadError}</Text>

                <TouchableOpacity
                  style={styles.small}
                  onPress={() => setReload(value => value + 1)}
                >
                  <Text>다시 불러오기</Text>
                </TouchableOpacity>
              </>
            )}

            {!loading && !loadError && (
              <>
                <Text style={styles.heading}>
                  {date} · 등록 일정 {list.length}건
                </Text>

                {!list.length && (
                  <Text style={styles.hint}>
                    등록된 특별 일정이 없습니다.
                  </Text>
                )}

                {list.map(event => (
                  <View key={event.id} style={styles.record}>
                    <Text style={styles.label}>
                      {event.types.map(eventLabel).join(' · ')}
                    </Text>

                    {!!event.memo && (
                      <Text style={styles.hint}>{event.memo}</Text>
                    )}

                    <View style={styles.row}>
                      <TouchableOpacity
                        disabled={disabled}
                        style={styles.small}
                        onPress={() => {
                          setEditing(event.id);
                          setTypes(event.types);
                          setMemo(event.memo || '');
                          setMessage('');
                        }}
                      >
                        <Text>수정</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        disabled={disabled}
                        style={styles.small}
                        onPress={() => remove(event.id)}
                      >
                        <Text style={styles.error}>삭제</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                <Text style={styles.heading}>
                  {editing ? '선택한 일정 수정' : '새 일정 등록'}
                </Text>

                <View style={styles.options}>
                  {EVENT_OPTIONS.map(([value, label]) => (
                    <TouchableOpacity
                      key={value}
                      disabled={disabled}
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: types.includes(value),
                      }}
                      style={[
                        styles.option,
                        types.includes(value) && styles.selected,
                      ]}
                      onPress={() =>
                        setTypes(previous =>
                          previous.includes(value)
                            ? previous.filter(item => item !== value)
                            : [...previous, value]
                        )
                      }
                    >
                      <Text style={styles.label}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TextInput
                  accessibilityLabel="일정 메모"
                  style={styles.input}
                  value={memo}
                  onChangeText={setMemo}
                  editable={!disabled}
                  placeholder="선택 메모 · 개인정보는 적지 마세요"
                  maxLength={80}
                  multiline
                />

                <TouchableOpacity
                  disabled={disabled || !validDate(date)}
                  style={[
                    styles.primary,
                    disabled && styles.dim,
                  ]}
                  onPress={save}
                >
                  <Text style={styles.white}>
                    {busy
                      ? '처리 중…'
                      : editing
                        ? '수정 내용 저장'
                        : '일정 추가'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={busy || readOnly}
                  style={styles.small}
                  onPress={() => {
                    clear();
                    setMessage('');
                  }}
                >
                  <Text>입력 취소</Text>
                </TouchableOpacity>

                {date === dateKey() && (
                  <TouchableOpacity
                    disabled={disabled}
                    style={styles.primary}
                    onPress={confirm}
                  >
                    <Text style={styles.white}>
                      오늘 일정 확인 완료
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            {!!message && (
              <Text
                accessibilityLiveRegion="polite"
                style={styles.message}
              >
                {message}
              </Text>
            )}

            <TouchableOpacity
              disabled={busy}
              style={styles.small}
              onPress={close}
            >
              <Text>닫기</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#0007',
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  body: {
    padding: 20,
    paddingBottom: 36,
    gap: 12,
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: '#152B50',
  },
  heading: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
    color: '#152B50',
  },
  hint: {
    fontSize: 13,
    color: '#67758C',
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  small: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5FA',
    alignItems: 'center',
  },
  input: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CCD7E7',
    color: '#152B50',
    fontSize: 15,
  },
  record: {
    backgroundColor: '#F5F8FD',
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DFE5EF',
  },
  selected: {
    borderColor: '#245DE5',
    backgroundColor: '#EAF1FF',
  },
  label: {
    fontSize: 13,
    color: '#243D61',
    lineHeight: 20,
  },
  primary: {
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#245DE5',
  },
  white: {
    color: '#FFF',
    fontWeight: '800',
  },
  error: {
    color: '#BB3048',
    fontSize: 13,
  },
  message: {
    color: '#245196',
    fontSize: 13,
    lineHeight: 20,
  },
  dim: {
    opacity: 0.5,
  },
});