import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FlowHeading from '../components/FlowHeading';
import { dateKey, deleteEvent, eventTimeCaption, eventTitle, readEvents, saveEvent } from '../utils/routineData';
import { INDUSTRIES, ROUTINE_TITLE_LIMIT } from '../utils/routineDetails';

const icons = {
  cafe: 'cafe-outline', restaurant: 'restaurant-outline',
  pcroom: 'game-controller-outline', travel: 'airplane-outline', intercity: 'bus-outline',
  train: 'train-outline', transport: 'subway-outline', taxi: 'car-outline',
  convenience: 'storefront-outline', delivery: 'bicycle-outline', fuel: 'battery-charging-outline',
  shopping: 'bag-handle-outline', medical: 'medkit-outline', other: 'create-outline',
};
const activities = INDUSTRIES.filter(([id]) => id !== 'other' && icons[id]).map(([id, label]) => [id, label.slice(label.indexOf(' ') + 1)]);
const activityNames = Object.fromEntries(activities);
const empty = { category: '', start: '', end: '', title: '' };
const hours = Array.from({ length: 25 }, (_, hour) => String(hour).padStart(2, '0') + ':00');
const steps = ['① 시작 시간 선택', '② 종료 시간 선택', '③ 선택 완료'];
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

  const edit = event => {
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
  const choosingEnd = Boolean(start && !end);
  const range = start || !savedRange ? form : savedRange;
  const rangeComplete = Boolean(range.start && range.end);
  const highlightedIntervals = !rangeComplete ? [] : range.end < range.start
    ? [[range.start, '24:00'], ['00:00', range.end]]
    : [[range.start, range.end]];
  const step = rangeComplete ? 2 : range.start ? 1 : 0;
  const timeSummary = value => `시작 시간 ${value.start || '—'} → 종료 시간 ${value.end && value.end < value.start ? '다음 날 ' : ''}${value.end || '—'}`;
  const selectTime = time => {
    if (disabled || lock.current || (!choosingEnd && time === '24:00')) return;
    if (choosingEnd && time <= start) {
      setError('종료 시간은 시작 시간보다 늦어야 해요.');
      return;
    }

    setSavedRange(null);
    setForm(current => choosingEnd
      ? { ...current, end: time }
      : { ...current, start: time, end: '', category: current.category || 'other' });
    setError('');
    if (choosingEnd) setEditorOpen(true);
  };
  const returnToTimeline = () => {
    if (disabled || lock.current) return;
    setEditorOpen(false);
    setError('');
    if (start) scroll.current?.scrollTo({ y: Math.max(0, timelineTop.current + timeOffset(start) - hourRowHeight) });
  };
  const reselectTime = () => {
    if (disabled || lock.current) return;
    returnToTimeline();
    setSavedRange(null);
    setForm(current => ({ ...current, start: '', end: '' }));
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
    if (start) {
      if (!end) throw Error('왼쪽 시간표에서 종료 시간을 선택해주세요.');
      const saved = await saveEvent({ ...form, id: editing, date: scheduleDate });
      setEvents(current => [saved, ...current.filter(event => event.id !== saved.id)]);
      resetForm();
      setSavedRange(saved);
    }
    if (continueAfter) await onContinue?.();
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
        <View style={s.stepRow}>
          {steps.map((label, index) => <Text key={label} style={[s.step, index === step && s.currentStep]}>
            {label}
          </Text>)}
        </View>
        <Text style={s.stepHint} accessibilityLiveRegion="polite">
          {step === 0 ? '왼쪽에서 시작 시간을 먼저 선택해 주세요' : step === 1
            ? `시작 시간 ${range.start} 선택됨! 이제 종료 시간을 선택해 주세요`
            : '시간 선택 완료'}
        </Text>
      </View>
      <ScrollView ref={scroll} style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <FlowHeading brand icon="time-outline">오늘의 특별한 일정을 알려주세요</FlowHeading>
        <Text style={s.date}>{scheduleDate}</Text>

        {loading && <ActivityIndicator color="#1854D8" />}
        {loadFailed && <Action onPress={() => setRetry(value => value + 1)} label="다시 불러오기" />}
        <View style={s.timelineHeading}>
          <Text style={[s.section, s.railHeading]}>시간</Text>
          <Text style={s.section}>일과</Text>
        </View>
        <View style={s.timeline} onLayout={event => { timelineTop.current = event.nativeEvent.layout.y; }}>
          {highlightedIntervals.map(([from, to]) => <View key={from} pointerEvents="none"
            style={[s.rangeBand, { top: timeOffset(from) + hourRowHeight / 2, height: timeOffset(to) - timeOffset(from) }]} />)}
          <View style={s.railLine} />
          {hours.map((time, hour) => {
            const selected = time === range.start || time === range.end;
            const inRange = rangeComplete && (range.end < range.start
              ? time > range.start || time < range.end
              : time > range.start && time < range.end);
            const invalidEnd = choosingEnd && time <= start;
            const unavailable = disabled || (time === '24:00' && !choosingEnd);
            return (
              <View key={time} style={s.hourRow}>
                {hour % 3 === 0 && <View pointerEvents="none" style={s.hourLine} />}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={hour + '시 선택'}
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
        <Text style={s.draftText} accessibilityLiveRegion="polite">{timeSummary(range)}</Text>
        {!!range.start && <View style={s.draftRow}>
          <Action label="시간 다시 선택" disabled={disabled} onPress={reselectTime} />
          <Action label="초기화" disabled={disabled} onPress={resetForm} />
          {!!end && <Action label={editing ? '일정 수정' : '일과 선택'} disabled={disabled} onPress={() => setEditorOpen(true)} />}
        </View>}
        <View style={s.footerRow}>
          <Action label="이전" disabled={busy} onPress={onBack} />
          <Action primary disabled={disabled || !rangeComplete} onPress={() => save(true)} label="맞춤 카드 보기" />
        </View>
        {!range.start && <TouchableOpacity accessibilityRole="button" disabled={disabled}
          onPress={() => save(true)} style={s.skip}>
          <Text style={s.blue}>{events.length ? '저장한 일정으로 계속' : '일정 없이 계속'}</Text>
        </TouchableOpacity>}
      </View>
      <Modal visible={editorOpen} transparent animationType="fade" onRequestClose={returnToTimeline}>
        <KeyboardAvoidingView style={s.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.editor} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={s.editorTitle}>{editing ? '일정 수정' : '일과 입력'}</Text>
            <View style={s.editorTime}>
              <Text style={s.blue}>{timeSummary(form)}</Text>
              <Action label="시간 변경" onPress={reselectTime} disabled={disabled} />
            </View>
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
