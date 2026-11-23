import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FlowHeading from '../components/FlowHeading';
import { dateKey, deleteEvent, eventTimeCaption, eventTitle, readEvents, saveEvent } from '../utils/routineData';
import { INDUSTRIES, INDUSTRY_ICONS, ROUTINE_TITLE_LIMIT } from '../utils/routineDetails';

const icons = INDUSTRY_ICONS;
const activities = INDUSTRIES.filter(([id]) => id !== 'other' && icons[id]);
const activityNames = Object.fromEntries(activities);
const empty = { category: '', start: '', end: '', title: '' };
const hours = Array.from({ length: 25 }, (_, hour) => String(hour).padStart(2, '0') + ':00');
const DAY_END = 24 * 60;
const STEP = 10; // 시작·종료 최소 간격(분)
const DURATIONS = [[30, '30분'], [60, '1시간'], [120, '2시간'], [180, '3시간']];
const toMinutes = time => {
  const [hour, minute] = String(time || '0:0').split(':').map(Number);
  return hour * 60 + minute;
};
const toTime = minutes => {
  const value = Math.max(0, Math.min(DAY_END, minutes));
  return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
};
const hourRowHeight = 54;
const minimumBlockHeight = 44;
const eventIconStackMinHeight = 80;

function timeOffset(time) {
  const [hour, minute] = time.split(':').map(Number);
  return (hour + minute / 60) * hourRowHeight;
}

function arrangeEvents(events) {
  const groups = [];
  let group = null;
  for (const event of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    const start = timeOffset(event.start);
    const end = timeOffset(event.end < event.start ? '24:00' : event.end);
    const height = Math.max(minimumBlockHeight, end - start - 2);
    if (!group || start >= group.end) {
      group = { end: 0, laneEnds: [], blocks: [] };
      groups.push(group);
    }
    const freeLane = group.laneEnds.findIndex(laneEnd => laneEnd <= start);
    const lane = freeLane < 0 ? group.laneEnds.length : freeLane;
    group.laneEnds[lane] = start + height;
    group.end = Math.max(group.end, group.laneEnds[lane]);
    group.blocks.push({ event, start, height, lane });
  }
  return groups.flatMap(({ laneEnds, blocks }) =>
    blocks.map(block => ({ ...block, lanes: laneEnds.length }))
  );
}

function Action({ label, onPress, disabled, primary, accessibilityLabel }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} disabled={disabled}
      onPress={onPress} style={[s.button, primary && s.primary, disabled && s.dim]}>
      <Text style={primary ? s.white : s.blue}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function DetailedRoutineScreen({ date, entryId, onBack, onContinue }) {
  const [scheduleDate] = useState(() => date || dateKey());
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState(empty);
  const [savedRange, setSavedRange] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const scroll = useRef(null);
  const timelineTop = useRef(0);

  // 입력창을 열었을 때의 값(초기화 버튼이 이 값으로 되돌린다)
  const initialForm = useRef(empty);
  // 시간 칸에 타이핑 중인 글자(칸을 벗어나면 09:30 형식으로 맞춰 반영)
  const [timeDraft, setTimeDraft] = useState({});
  const edit = event => {
    initialForm.current = { category: event.category, start: event.start, end: event.end, title: event.title || '' };
    setTimeDraft({});
    setForm({ category: event.category, start: event.start, end: event.end, title: event.title || '' });
    setEditing(event.id);
    setEditorOpen(true);
    setError('');
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setError('');
    readEvents().then(records => {
      if (!active) return;
      const list = records.filter(event => event.date === scheduleDate && event.category);
      setEvents(list);
      const entry = list.find(event => event.id === entryId);
      if (entry) edit(entry);
    }).catch(() => {
      if (active) {
        setLoadFailed(true);
        setError('일정을 불러오지 못했어요. 다시 시도해주세요.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [scheduleDate, entryId, retry]);

  const disabled = busy || loading || loadFailed;
  const { start, end } = form;
  // 입력 중인 시간(또는 방금 저장한 일정)을 시간표에 옅게 표시한다
  const range = editorOpen && start ? form : savedRange || {};
  const rangeComplete = Boolean(range.start && range.end);
  const highlightedIntervals = !rangeComplete ? [] : range.end < range.start
    ? [[range.start, '24:00'], ['00:00', range.end]]
    : [[range.start, range.end]];
  const duration = start && end ? toMinutes(end) - toMinutes(start) : 0;
  // 시간을 한 번 누르면 바로 입력창을 연다: 그 시각부터 1시간이 기본
  const openNew = time => {
    if (disabled || lock.current) return;
    const from = Math.min(toMinutes(time), DAY_END - STEP);
    setSavedRange(null);
    setEditing(null);
    const next = { ...empty, start: toTime(from), end: toTime(Math.min(DAY_END, from + 60)) };
    initialForm.current = next;
    setTimeDraft({});
    setForm(next);
    setError('');
    setEditorOpen(true);
  };
  const selectTime = time => openNew(time);
  // '+ 일정 추가': 오늘이면 지금 이후 가장 가까운 정각, 다른 날이면 09:00부터
  const addNow = () => {
    const now = new Date();
    const next = scheduleDate === dateKey() ? Math.min(23, now.getHours() + (now.getMinutes() ? 1 : 0)) : 9;
    openNew(String(next).padStart(2, '0') + ':00');
  };
  const returnToTimeline = () => {
    if (lock.current) return;
    setEditorOpen(false);
    setError('');
  };
  // 시작을 옮긴다. 시작이 종료와 같거나 늦어지면 종료를 시작 + 1시간으로 민다.
  const setStartAt = minutes => {
    const from = Math.max(0, Math.min(DAY_END - STEP, minutes));
    setForm(current => {
      const to = toMinutes(current.end) > from ? toMinutes(current.end) : Math.min(DAY_END, from + 60);
      return { ...current, start: toTime(from), end: toTime(to) };
    });
    setError('');
  };
  // 종료를 옮긴다(시작보다 최소 10분 뒤, 24:00까지)
  const setEndAt = minutes => {
    setForm(current => ({ ...current, end: toTime(Math.max(toMinutes(current.start) + STEP, Math.min(DAY_END, minutes))) }));
    setError('');
  };
  // 시간 칸: 숫자 4자리만, 자리마다 쓸 수 있는 숫자를 제한한다(HH:MM)
  // 1번째 0~2, 2번째 0~9(1번째가 2면 0~4), 3번째 0~5, 4번째 0~9. 24시는 24:00만.
  const maskTime = text => {
    let digits = '';
    for (const char of String(text || '').replace(/\D/g, '')) {
      const n = Number(char);
      const at = digits.length;
      const ok = at === 0 ? n <= 2
        : at === 1 ? (digits[0] === '2' ? n <= 4 : true)
        : at === 2 ? (digits.slice(0, 2) === '24' ? n === 0 : n <= 5)
        : at === 3 ? (digits.slice(0, 2) === '24' ? n === 0 : true)
        : false;
      if (ok) digits += char;
    }
    return digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
  };
  const parseTyped = text => {
    const digits = String(text || '').replace(/\D/g, '');
    if (digits.length !== 4) return null;
    const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2));
    return minutes <= DAY_END ? minutes : null;
  };
  const commitTyped = (key, typed) => {
    const text = typed ?? timeDraft[key];
    if (text === undefined) return;
    setTimeDraft(current => ({ ...current, [key]: undefined }));
    const minutes = parseTyped(text);
    if (minutes === null) {
      setError('시간을 숫자 4자리로 입력해주세요. 예: 0930');
      return;
    }
    if (key === 'start') setStartAt(minutes); else setEndAt(minutes);
  };
  const typeTime = (key, text) => {
    const masked = maskTime(text);
    // 4자리를 다 치면 바로 반영
    if (masked.length === 5) commitTyped(key, masked);
    else setTimeDraft(current => ({ ...current, [key]: masked }));
  };
  const resetEditor = () => {
    if (lock.current || disabled) return;
    setTimeDraft({});
    setForm(initialForm.current);
    setError('');
  };
  const update = (key, value) => {
    if (lock.current || disabled) return;
    setForm(current => ({ ...current, [key]: value }));
    setError('');
  };
  const enterTitle = title => {
    if (lock.current || disabled) return;
    setForm(current => ({ ...current, category: 'other', title }));
    setError('');
  };
  const resetForm = () => {
    setForm(empty);
    setSavedRange(null);
    setEditing(null);
    setEditorOpen(false);
    setError('');
  };
  const run = async action => {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (problem) {
      setError(problem?.message || '일정을 저장하지 못했어요.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = continueAfter => run(async () => {
    if (!continueAfter) {
      if (!form.category || (form.category === 'other' && !form.title.trim())) {
        throw Error('업종을 고르거나 직접 입력해주세요.');
      }
      const saved = await saveEvent({ ...form, id: editing, date: scheduleDate });
      setEvents(current => [saved, ...current.filter(event => event.id !== saved.id)]);
      resetForm();
      setSavedRange(saved);
      return;
    }
    await onContinue?.();
  });
  // 전체 초기화: 이 날짜의 장소 일정을 모두 지운다(확인창에서 한 번 더 물은 뒤)
  const [confirmClear, setConfirmClear] = useState(false);
  const clearAll = () => run(async () => {
    for (const event of events) {
      await deleteEvent(event.id);
    }
    setEvents([]);
    resetForm();
    setConfirmClear(false);
  });
  const remove = id => run(async () => {
    await deleteEvent(id);
    setEvents(current => current.filter(event => event.id !== id));
    if (editing === id) resetForm();
    if (savedRange?.id === id) setSavedRange(null);
  });
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.steps}>
        <Text style={s.stepHint} accessibilityLiveRegion="polite">
          {savedRange ? `✓ ${eventTitle(savedRange)} ${eventTimeCaption(savedRange)} 일정을 추가했어요` : '시간을 누르면 바로 일정을 넣을 수 있어요'}
        </Text>
      </View>
      <ScrollView ref={scroll} style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <FlowHeading brand icon="time-outline">오늘의 특별한 일정을 알려주세요</FlowHeading>
        <Text style={s.date}>{scheduleDate}</Text>

        {loading && <ActivityIndicator color="#1854D8" />}
        {loadFailed && <Action onPress={() => setRetry(value => value + 1)} label="다시 불러오기" />}
        <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={addNow} style={[s.addButton, disabled && s.dim]}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={s.white}>일정 추가</Text>
        </TouchableOpacity>
        <View style={s.timelineHeading}>
          <Text style={[s.section, s.railHeading]}>시간</Text>
          <Text style={s.section}>일과</Text>
        </View>
        <View style={s.timeline} onLayout={event => { timelineTop.current = event.nativeEvent.layout.y; }}>
          {highlightedIntervals.map(([from, to]) => <View key={from} pointerEvents="none"
            style={[s.rangeBand, { top: timeOffset(from) + hourRowHeight / 2, height: timeOffset(to) - timeOffset(from) }]} />)}
          <View style={s.railLine} />
          {hours.map((time, hour) => {
            const selected = false;
            const inRange = rangeComplete && time >= range.start && time < range.end;
            const invalidEnd = false;
            const unavailable = disabled || time === '24:00';
            return (
              <View key={time} style={s.hourRow}>
                {hour % 3 === 0 && <View pointerEvents="none" style={s.hourLine} />}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={hour + '시에 일정 추가'}
                  aria-pressed={selected}
                  accessibilityState={{ selected, disabled: unavailable }} disabled={unavailable}
                  onPress={() => selectTime(time)} style={[s.hour, inRange && s.inRange, selected && s.selectedHour, (unavailable || invalidEnd) && !selected && s.dim]}>
                  <View style={[s.dot, selected && s.dotSelected]} />
                  <Text style={[s.hourText, selected && s.white]}>{time}</Text>
                </TouchableOpacity>
              </View>
            );
          })}
          <View pointerEvents="box-none" style={s.eventTrack}>
            {arrangeEvents(events).map(({ event, start: offset, height, lane, lanes }) => {
              const title = eventTitle(event);
              const time = eventTimeCaption(event);
              const label = activityNames[event.category] ?? title;
              const icon = icons[event.category] || 'calendar-outline';
              const compact = height < eventIconStackMinHeight;
              return (
                <View key={event.id} pointerEvents="box-none" style={[
                  s.eventSlot,
                  { top: offset, height, left: (lane * 100 / lanes) + '%', width: (100 / lanes) + '%' },
                ]}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={title + ' ' + time}
                    accessibilityHint="일정 수정 또는 삭제"
                    disabled={disabled}
                    onPress={() => edit(event)}
                    style={[s.eventBlock, editing === event.id && s.selected]}>
                    {!compact && <View style={s.eventIcon} accessible={false}>
                      <Ionicons name={icon} size={23} color="#245DE5" />
                    </View>}
                    <View style={s.eventTitleRow}>
                      {compact && <Ionicons name={icon} size={14} color="#245DE5" accessible={false} />}
                      <Text style={[s.eventTitle, compact && s.eventTitleCompact]} numberOfLines={1}>{label}</Text>
                    </View>
                    <Text style={s.eventTime} numberOfLines={1}>{time}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
      <View style={s.footer}>
        {!editorOpen && !!error && <Text accessibilityRole="alert" style={s.danger}>{error}</Text>}
        {events.length > 0 && <View style={s.countRow}>
          <Text style={s.draftText}>오늘 일정 {events.length}개</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 전체 초기화" disabled={disabled}
            onPress={() => setConfirmClear(true)} style={[s.clearButton, disabled && s.dim]}>
            <Ionicons name="refresh" size={14} color="#B4384D" />
            <Text style={s.clearText}>전체 초기화</Text>
          </TouchableOpacity>
        </View>}
        <View style={s.footerRow}>
          <Action label="이전" disabled={busy} onPress={onBack} />
          <Action primary disabled={disabled || !events.length} onPress={() => save(true)} label="맞춤 카드 보기" />
        </View>
        {!events.length && <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => save(true)} style={s.skip}>
          <Text style={s.blue}>일정 없이 계속</Text>
        </TouchableOpacity>}
      </View>
      {/* 전체 초기화 확인 */}
      <Modal visible={confirmClear} transparent animationType="fade" onRequestClose={() => setConfirmClear(false)}>
        <View style={s.overlay}>
          <View style={s.confirmBox} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={s.confirmTitle}>일정을 모두 지울까요?</Text>
            <Text style={s.confirmText}>{scheduleDate} 일정 {events.length}개가 모두 삭제돼요.{'\n'}지운 일정은 되돌릴 수 없어요.</Text>
            <View style={s.confirmActions}>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => setConfirmClear(false)} style={[s.confirmButton, s.confirmCancel]}>
                <Text style={s.blue}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={clearAll} style={[s.confirmButton, s.confirmDanger, busy && s.dim]}>
                <Text style={s.white}>{busy ? '지우는 중…' : '모두 지우기'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={returnToTimeline}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.editor} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={s.editorTitle}>{editing ? '일정 수정' : '일과 입력'}</Text>
            {/* 시간: 직접 타이핑하거나 −1시간·−30분·+30분·+1시간 버튼으로 조절 */}
            {[['start', '시작', start, setStartAt], ['end', '종료', end, setEndAt]].map(([key, label, value, setAt]) => {
              // −10분 −30분 −1시간 [시간] +10분 +30분 +1시간
              const adjust = list => list.map(([delta, text]) => (
                <TouchableOpacity key={delta} accessibilityRole="button" accessibilityLabel={label + ' ' + text} disabled={disabled}
                  onPress={() => setAt(toMinutes(value) + delta)} style={s.adjustButton}>
                  <Text style={s.adjustText}>{text}</Text>
                </TouchableOpacity>
              ));
              return <View key={key} style={s.timeBlock}>
                <Text style={s.timeLabel}>{label}</Text>
                <View style={s.timeRow}>
                {adjust([[-10, '−10분'], [-30, '−30분'], [-60, '−1시간']])}
                <TextInput accessibilityLabel={label + ' 시간 입력'} style={s.timeInput} editable={!disabled}
                  value={timeDraft[key] ?? value} onChangeText={text => typeTime(key, text)}
                  onFocus={() => setTimeDraft(current => ({ ...current, [key]: '' }))}
                  onBlur={() => { if (timeDraft[key] === '') setTimeDraft(current => ({ ...current, [key]: undefined })); else commitTyped(key); }}
                  onSubmitEditing={() => commitTyped(key)}
                  keyboardType="number-pad" placeholder="0930" placeholderTextColor="#9AAAC0" maxLength={5} returnKeyType="done" />
                {adjust([[10, '+10분'], [30, '+30분'], [60, '+1시간']])}
                </View>
              </View>;
            })}
            <Text style={s.durationHint}>{duration > 0 ? `${Math.floor(duration / 60) ? Math.floor(duration / 60) + '시간 ' : ''}${duration % 60 ? duration % 60 + '분' : ''}`.trim() + ' 동안' : ''}</Text>
            <ScrollView style={s.editorScroll} keyboardShouldPersistTaps="handled">
              <View style={s.directEntry}>
                <Text style={s.directTitle}>업종 직접 입력</Text>
                <TextInput accessibilityLabel="업종 직접 입력" style={[s.input, form.category === 'other' && s.selected]}
                  value={form.title} onFocus={() => update('category', 'other')} onChangeText={enterTitle}
                  maxLength={ROUTINE_TITLE_LIMIT} editable={!disabled} placeholder="예: 헬스장, 영화관, 미용실"
                  placeholderTextColor="#697C98" returnKeyType="done" />
                <Text style={s.directHint}>아래에 없는 업종은 직접 적어주세요. 적은 업종으로 카드 혜택을 찾아 추천해요.</Text>
              </View>
              <View style={s.options}>
                {activities.map(([id, label]) => (
                  <TouchableOpacity key={id} accessibilityRole="radio" accessibilityLabel={label} aria-checked={form.category === id} disabled={disabled}
                    onPress={() => update('category', id)} style={[s.option, form.category === id && s.selected]}>
                    <Ionicons name={icons[id]} size={19} color="#1854D8" />
                    <Text style={s.optionLabel}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            {!!error && <Text accessibilityRole="alert" style={s.danger}>{error}</Text>}
            <View style={s.actions}>
              <Action disabled={disabled} onPress={resetForm} label="입력 취소" />
              <Action disabled={disabled} onPress={resetEditor} label="초기화" />
              {editing && <Action disabled={disabled} onPress={() => remove(editing)} label="삭제" />}
              <Action primary disabled={disabled} onPress={() => save(false)} label={editing ? '수정 저장' : '일정 추가'} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F1F5FF' },
  scroll: { flex: 1 },
  body: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 23 },
  steps: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  stepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  step: { flexGrow: 1, color: '#536A88', backgroundColor: '#E8EEF9', borderRadius: 14, paddingVertical: 7, paddingHorizontal: 6, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  currentStep: { color: '#FFFFFF', backgroundColor: '#1854D8' },
  stepHint: { color: '#18365F', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  addButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: 24, backgroundColor: '#104FE7' },
  timeBox: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  timeField: { alignItems: 'center', gap: 4 },
  timeLabel: { color: '#5A6E89', fontSize: 12, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F1F5FD', borderRadius: 14, padding: 4 },
  stepButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  timeValue: { minWidth: 56, textAlign: 'center', color: '#152D50', fontSize: 18, fontWeight: '800' },
  timeArrow: { color: '#5A6E89', fontSize: 18, fontWeight: '700', paddingBottom: 10 },
  durationRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  durationChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F5FD', borderWidth: 1, borderColor: 'transparent' },
  durationChipActive: { backgroundColor: '#E2EDFF', borderColor: '#8CA8EF' },
  durationText: { color: '#385988', fontSize: 13, fontWeight: '700' },
  durationTextActive: { color: '#1854D8' },
  timeBlock: { gap: 4 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  timeInput: { width: 70, minHeight: 40, marginHorizontal: 3, borderRadius: 12, borderWidth: 1, borderColor: '#C9D8F2', backgroundColor: '#FFFFFF', textAlign: 'center', color: '#152D50', fontSize: 17, fontWeight: '800' },
  adjustButton: { paddingHorizontal: 5, minHeight: 28, justifyContent: 'center', borderRadius: 8, backgroundColor: '#F1F5FD' },
  adjustText: { color: '#1854D8', fontSize: 11, fontWeight: '700' },
  durationHint: { color: '#5A6E89', fontSize: 12, textAlign: 'center' },
  countRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  clearButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, minHeight: 30, borderRadius: 15, backgroundColor: '#FDEDEF' },
  clearText: { color: '#B4384D', fontSize: 12, fontWeight: '800' },
  confirmBox: { width: '100%', maxWidth: 360, borderRadius: 22, padding: 20, gap: 12, backgroundColor: '#FFFFFF' },
  confirmTitle: { color: '#152D50', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  confirmText: { color: '#4A5D7A', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  confirmActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  confirmButton: { flex: 1, minHeight: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  confirmCancel: { backgroundColor: '#EAF1FF' },
  confirmDanger: { backgroundColor: '#D6455D' },
  date: { color: '#385988', fontSize: 13, fontWeight: '700', textAlign: 'center' },
  timelineHeading: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  railHeading: { width: 76 },
  timeline: { position: 'relative', marginTop: -10, paddingBottom: 24 },
  rangeBand: { position: 'absolute', left: 0, right: 0, borderRadius: 14, backgroundColor: '#E5EFFF' },
  railLine: { position: 'absolute', left: 9, top: hourRowHeight / 2, width: 2, height: 24 * hourRowHeight, backgroundColor: '#BDD1FA' },
  section: { color: '#1854D8', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  hourRow: { position: 'relative', height: hourRowHeight, justifyContent: 'center' },
  hourLine: { position: 'absolute', left: 86, right: 0, top: hourRowHeight / 2, height: 1, backgroundColor: '#DEE7F5' },
  hour: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingLeft: 12, width: 76, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: 'transparent' },
  dot: { position: 'absolute', left: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: '#91B2F4' },
  dotSelected: { backgroundColor: '#FFFFFF' },
  hourText: { color: '#18365F', fontSize: 13, fontWeight: '700' },
  eventTrack: { position: 'absolute', left: 86, right: 0, top: hourRowHeight / 2, bottom: 0 },
  eventSlot: { position: 'absolute', paddingHorizontal: 2 },
  eventBlock: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#BFCEF2', borderLeftWidth: 3, borderLeftColor: '#2D62DF', backgroundColor: '#E3EDFF', justifyContent: 'center', alignItems: 'center', paddingLeft: 4, paddingRight: 6, overflow: 'hidden' },
  eventIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: '100%' },
  eventTitle: { flexShrink: 1, color: '#18365F', fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  eventTitleCompact: { fontSize: 13, lineHeight: 17 },
  eventTime: { color: '#385988', fontSize: 11, lineHeight: 15, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#11234380' },
  editor: { width: '100%', maxWidth: 480, maxHeight: '92%', borderRadius: 24, padding: 16, gap: 12, backgroundColor: '#FFFFFF' },
  editorTitle: { color: '#152D50', fontSize: 20, fontWeight: '800' },
  editorTime: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  editorScroll: { flexGrow: 0, flexShrink: 1 },
  options: { gap: 6, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  directEntry: { alignSelf: 'center', width: '100%', maxWidth: 340, gap: 8, marginBottom: 12 },
  directTitle: { color: '#1854D8', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  directHint: { color: '#5A6E89', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  option: { width: '48%', minHeight: 46, flexDirection: 'row', gap: 6, paddingHorizontal: 6, paddingVertical: 8, alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: 'transparent' },
  optionLabel: { color: '#152D50', flexShrink: 1, fontSize: 13, fontWeight: '700' },
  selected: { backgroundColor: '#E2EDFF', borderColor: '#8CA8EF' },
  selectedHour: { backgroundColor: '#1854D8', borderColor: '#1854D8' },
  inRange: { backgroundColor: '#EAF1FF' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#D9E5F7', textAlign: 'center', minHeight: 48, paddingHorizontal: 8, color: '#152D50', fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  draftRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  draftText: { color: '#385988', textAlign: 'center', fontWeight: '700', fontSize: 13 },
  skip: { alignSelf: 'center', justifyContent: 'center', minHeight: 36, paddingHorizontal: 8 },
  button: { backgroundColor: '#EAF1FF', borderRadius: 22, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, minHeight: 44 },
  footer: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#DEE7F5', padding: 14, gap: 8 },
  footerRow: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 688, alignSelf: 'center' },
  primary: { flex: 1, minHeight: 52, backgroundColor: '#104FE7', borderRadius: 26 },
  white: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  blue: { color: '#1D53C9', fontWeight: '800', fontSize: 13 },
  danger: { color: '#B4384D', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  dim: { opacity: 0.45 },
});
