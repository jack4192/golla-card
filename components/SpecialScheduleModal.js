import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { EVENT_OPTIONS, confirmToday, dateKey, deleteEvent, eventLabel, readEvents, saveEvent, shiftDate, validDate } from '../utils/routineData';

// 기존 연결을 유지하면서 전체 화면으로 표시합니다.
export default function SpecialScheduleModal({
  visible,
  onClose,
  onChanged,
  onConfirmed,
  readOnly = false
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
  const lock = useRef(false),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    readEvents().then(value => {
      if (active) setEvents(value);
    }).catch(() => {
      if (active) setLoadError('일정을 불러오지 못했습니다. 다시 불러온 후 변경해주세요.');
    }).finally(() => {
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
  const dirty = !!editing || types.length > 0 || !!memo.trim();
  const disabled = busy || loading || !!loadError || readOnly;
  const list = validDate(date) ? events.filter(event => event.date === date) : [];
  const close = () => {
    if (!lock.current) onClose?.();
  };
  const changeDate = next => {
    if (lock.current) return;
    if (dirty) {
      setMessage('작성 중인 일정을 먼저 저장하거나 입력 취소한 후 날짜를 바꿔주세요.');
      return;
    }
    setDate(next);
    setMessage('');
  };
  const run = async action => {
    if (!visible || readOnly || lock.current || loading || loadError) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (problem) {
      if (mounted.current) setMessage(problem.message || '처리에 실패했습니다. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const save = () => run(async () => {
    const saved = await saveEvent({
      id: editing,
      date,
      types,
      memo
    });
    if (!mounted.current) return;
    setEvents(previous => [saved, ...previous.filter(event => event.id !== saved.id)]);
    clear();
    setMessage('일정을 저장했습니다.');
    onChanged?.();
  });
  const remove = id => run(async () => {
    await deleteEvent(id);
    if (!mounted.current) return;
    setEvents(previous => previous.filter(event => event.id !== id));
    if (editing === id) clear();
    setMessage('일정을 삭제했습니다.');
    onChanged?.();
  });
  const confirm = () => run(async () => {
    if (date !== dateKey()) throw Error('오늘 날짜로 이동한 후 확인해주세요.');
    if (dirty) throw Error('작성 중인 일정을 먼저 저장하거나 입력 취소해주세요.');
    await confirmToday();
    if (!mounted.current) return;
    onConfirmed?.();
    onClose?.();
  });
  return <Modal visible={visible} transparent={false} presentationStyle="fullScreen" animationType="slide" onRequestClose={close}>
      <SafeAreaView style={s.screen}>
        <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
          <View style={s.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 화면 뒤로 가기" disabled={busy} onPress={close} style={s.back}>
              <Text style={s.backText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>일정 관리</Text>
            <View style={s.headerSpace} />
          </View>

          <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            <Text style={s.title}>나의 일정</Text>
            <Text style={s.hint}>날짜별 일정을 등록하고, 일상에 맞는 카드 혜택을 확인해보세요.</Text>

            <View style={s.card}>
              <View style={s.dateButtons}>
                <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(shiftDate(date, -1))}><Text style={s.blue}>← 전날</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(dateKey())}><Text style={s.blue}>오늘</Text></TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(shiftDate(date, 1))}><Text style={s.blue}>다음 날 →</Text></TouchableOpacity>
              </View>
              <TextInput accessibilityLabel="일정 날짜" value={date} onChangeText={changeDate} editable={!busy} style={s.input} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" autoCorrect={false} />
              {!validDate(date) && <Text style={s.error}>실제 날짜를 YYYY-MM-DD로 입력해주세요.</Text>}
              {loading && <ActivityIndicator color="#245DE5" />}
              {!!loadError && <><Text accessibilityRole="alert" style={s.error}>{loadError}</Text>
                <TouchableOpacity accessibilityRole="button" disabled={loading} style={s.small} onPress={() => setReload(value => value + 1)}><Text style={s.blue}>다시 불러오기</Text></TouchableOpacity></>}
            </View>

            {!loading && !loadError && <>
              <Text style={s.heading}>{date} · 일정 {list.length}건</Text>
              {!list.length && <View style={s.card}><Text style={s.hint}>아직 등록된 일정이 없어요. 아래에서 새로운 일정을 추가해보세요.</Text></View>}
              {list.map(event => <View key={event.id} style={[s.card, s.agendaEntry]}>
                <Text style={s.recordTitle}>{event.types.map(eventLabel).join(' · ')}</Text>
                {!!event.memo && <Text style={s.hint}>{event.memo}</Text>}
                <View style={s.row}>
                  <TouchableOpacity accessibilityRole="button" disabled={disabled} style={s.small} onPress={() => {
                  setEditing(event.id);
                  setTypes([...event.types]);
                  setMemo(event.memo || '');
                  setMessage('');
                }}>
                    <Text style={s.blue}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" disabled={disabled} style={s.small} onPress={() => remove(event.id)}><Text style={s.error}>삭제</Text></TouchableOpacity>
                </View>
              </View>)}

              <View style={s.card}>
                <Text style={s.heading}>{editing ? '선택한 일정 수정' : '새 일정 등록'}</Text>
                <View style={s.options}>{EVENT_OPTIONS.map(([value, label]) => <TouchableOpacity key={value} disabled={disabled} accessibilityRole="checkbox" accessibilityState={{
                  checked: types.includes(value),
                  disabled
                }} style={[s.option, types.includes(value) && s.selected]} onPress={() => setTypes(previous => previous.includes(value) ? previous.filter(item => item !== value) : [...previous, value])}>
                    <Text style={s.optionText}>{label}</Text>
                  </TouchableOpacity>)}</View>
                <TextInput accessibilityLabel="일정 메모" value={memo} onChangeText={setMemo} editable={!disabled} style={[s.input, s.memo]} placeholder="선택 메모 · 개인정보는 적지 마세요" maxLength={80} multiline textAlignVertical="top" />
                <Text style={s.counter}>{memo.length}/80</Text>
                <TouchableOpacity accessibilityRole="button" disabled={disabled || !validDate(date)} style={[s.primary, (disabled || !validDate(date)) && s.dim]} onPress={save}>
                  <Text style={s.white}>{busy ? '처리 중…' : editing ? '수정 내용 저장' : '일정 추가'}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={busy || readOnly} style={s.small} onPress={() => {
                clear();
                setMessage('');
              }}><Text style={s.blue}>입력 취소</Text></TouchableOpacity>
              </View>
            </>}
          </ScrollView>

          <View style={s.footer}>
            {!!message && <Text accessibilityLiveRegion="polite" style={s.message}>{message}</Text>}
            <View style={s.footerRow}>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={close} style={[s.returnButton, busy && s.dim]}><Text style={s.blue}>돌아가기</Text></TouchableOpacity>
              {date === dateKey() && <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={confirm} style={[s.confirmButton, disabled && s.dim]}>
                <Text style={s.white}>{busy ? '처리 중…' : '오늘 일정 확인 완료'}</Text>
              </TouchableOpacity>}
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>;
}
const s = StyleSheet.create({
  agendaEntry: {borderLeftWidth: 4, borderLeftColor: '#2464ED', backgroundColor: '#F1F6FF'},
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderColor: '#E5ECF6',
    minHeight: 62
  },
  back: {
    width: 60,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center'
  },
  backText: {
    fontSize: 36,
    color: '#244C80',
    lineHeight: 51
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E395F'
  },
  headerSpace: {
    width: 60
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  body: {
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    padding: 22,
    paddingTop: 28,
    paddingBottom: 40,
    gap: 18
  },
  title: {
    fontSize: 28,
    lineHeight: 39,
    fontWeight: "800",
    color: "#142D4E"
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: "#5A6E89"
  },
  card: {
    backgroundColor: "#FFFFFF",
    padding: 22,
    borderRadius: 22,
    gap: 13,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  heading: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '800',
    color: "#142D4E"
  },
  dateButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  small: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center'
  },
  blue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#245DE5"
  },
  input: {
    padding: 15,
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 14,
    fontSize: 16,
    color: "#142D4E",
    backgroundColor: "#FFFFFF"
  },
  memo: {
    minHeight: 90
  },
  counter: {
    fontSize: 12,
    color: "#5A6E89",
    textAlign: 'right'
  },
  recordTitle: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '700',
    color: '#29456B'
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9
  },
  option: {
    padding: 13,
    minHeight: 46,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 12,
    justifyContent: 'center'
  },
  selected: {
    borderColor: "#245DE5",
    backgroundColor: "#EDF3FF"
  },
  optionText: {
    fontSize: 13,
    lineHeight: 21,
    color: '#355276'
  },
  primary: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#245DE5",
    alignItems: "center",
    minHeight: 54,
    justifyContent: "center"
  },
  white: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  footer: {
    flexShrink: 0,
    padding: 18,
    paddingBottom: 24,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderColor: '#E5ECF6',
    gap: 10
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    width: "100%",
    maxWidth: 716,
    alignSelf: "center"
  },
  returnButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44
  },
  confirmButton: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#245DE5",
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: "#C53D56"
  },
  message: {
    fontSize: 13,
    lineHeight: 21,
    color: '#245196',
    width: '100%',
    maxWidth: 860,
    alignSelf: 'center'
  },
  dim: {
    opacity: 0.4
  }
});
