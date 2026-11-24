import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FlowHeading from '../components/FlowHeading';
import AiNotice from '../components/AiNotice';
import ScheduleTimeWheel from '../components/ScheduleTimeWheel';
import { dateKey, deleteEvent, eventTimeCaption, eventTitle, readEvents, saveEvent, shiftDate } from '../utils/routineData';
import { INDUSTRIES, INDUSTRY_ICONS, ROUTINE_TITLE_LIMIT } from '../utils/routineDetails';

const icons = INDUSTRY_ICONS;
const activityNames = Object.fromEntries(INDUSTRIES.filter(([id]) => id !== 'other'));
const categoryByName = new Map(INDUSTRIES.filter(([id]) => id !== 'other').map(([id, name]) => [name, id]));
const eventThemes = [
  { category: 'cafe', keywords: /커피|카페|라떼|아메리카노|coffee|caf[eé]/iu, icon: 'cafe-outline', background: '#FAF0E3', border: '#E4D0B5', accent: '#79552F' },
  { category: 'restaurant', keywords: /밥|식사|외식|아침|점심|저녁|브런치|먹기|식당|맛집|lunch|dinner|breakfast/iu, icon: 'restaurant-outline', background: '#FFF0E4', border: '#F4CDAF', accent: '#A74C20' },
  { category: 'fitness', keywords: /운동|헬스|러닝|달리기|조깅|필라테스|요가|수영|gym|workout|fitness/iu, icon: 'fitness-outline', background: '#E8F5EC', border: '#BCDCC7', accent: '#32764B' },
];
const neutralEventTheme = { icon: 'calendar-outline', background: '#EFF1F4', border: '#D6DCE5', accent: '#566477' };
const knownEventColors = { background: '#E3EDFF', border: '#BFCEF2', accent: '#2D62DF' };

function eventAppearance(category, title) {
  if (category !== 'other' && icons[category]) {
    return eventThemes.find(theme => theme.category === category) ?? { ...knownEventColors, icon: icons[category] };
  }
  const text = title.normalize('NFKC').replace(/\s+/g, '');
  return eventThemes.find(theme => theme.keywords.test(text)) ?? neutralEventTheme;
}

const empty = { category: '', start: '', end: '', title: '', memo: '' };
const DAY_NAMES = '일월화수목금토';
// 입력 창 맨 위 날짜: '오늘 · 11월 24일 (화)' (오늘의 일정 입력 창과 같은 모양)
function dateHeading(day) {
  const today = dateKey();
  const value = new Date(day + 'T12:00:00');
  const text = `${value.getMonth() + 1}월 ${value.getDate()}일 (${DAY_NAMES[value.getDay()]})`;
  if (day === today) return '오늘 · ' + text;
  if (day === shiftDate(today, 1)) return '내일 · ' + text;
  return text;
}
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

function Action({ label, onPress, disabled, primary, destructive, accessibilityLabel }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel || label} disabled={disabled}
      onPress={onPress} style={[s.button, primary && s.primary, destructive && s.deleteButton, disabled && s.dim]}>
      <Text style={primary ? s.white : destructive ? s.danger : s.blue}>{label}</Text>
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
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const scroll = useRef(null);
  const timelineTop = useRef(0);

  // 시간 칸에 타이핑 중인 글자(칸을 벗어나면 09:30 형식으로 맞춰 반영)
  const [extraOpen, setExtraOpen] = useState(false);   // '추가 옵션'(메모) 펼침
  const edit = event => {
    setForm({ category: event.category, start: event.start, end: event.end, title: event.title || activityNames[event.category] || '', memo: event.memo || '' });
    setExtraOpen(Boolean(event.memo));
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
    setExtraOpen(false);
    setForm(next);
    setError('');
    setEditorOpen(true);
  };
  const selectTime = time => openNew(time);
  // '+ 일정 추가'는 항상 12:00~13:00 으로 시작한다(시간표의 시각을 누르면 그 시각부터)
  const addNow = () => openNew('12:00');
  const returnToTimeline = () => {
    if (lock.current) return;
    resetForm();
  };
  // 시간 휠(오늘의 일정 입력 창과 같은 ScheduleTimeWheel): 시작을 바꾸면 종료는 언제나 시작 + 1시간(24:00 까지),
  // 종료를 시작과 같거나 앞으로 돌리면 시작 + 1시간으로 맞춘다 (2026-11-24, 하루 일정이라 다음 날로 넘기지 않음)
  const wheelValue = (updater, current) => (typeof updater === 'function' ? updater(current) : updater);
  const setStartWheel = updater => setForm(current => {
    const from = Math.max(0, Math.min(DAY_END - STEP, toMinutes(wheelValue(updater, current.start))));
    const to = Math.min(DAY_END, from + 60);
    return { ...current, start: toTime(from), end: toTime(to) };
  });
  const setEndWheel = updater => setForm(current => {
    const to = Math.min(DAY_END, toMinutes(wheelValue(updater, current.end)));
    const from = toMinutes(current.start);
    return { ...current, end: toTime(to > from ? to : Math.min(DAY_END, from + 60)) };
  });
  const enterTitle = title => {
    if (lock.current || disabled) return;
    setForm(current => ({ ...current, category: categoryByName.get(title.trim()) ?? 'other', title }));
    setError('');
  };
  const resetForm = () => {
    setForm(empty);
    setSavedRange(null);
    setEditing(null);
    setEditorOpen(false);
    setConfirmRemove(false);
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
      if (!form.title.trim()) {
        throw Error('일정을 입력해주세요. 예: 헬스장, 영화관');
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
      <ScrollView ref={scroll} style={s.scroll} contentContainerStyle={s.body}
        stickyHeaderIndices={[1]} keyboardShouldPersistTaps="handled">
        <View style={s.scheduleHeader}>
          <FlowHeading brand icon="time-outline">일정 관리</FlowHeading>
          <Text style={s.date}>{scheduleDate}</Text>
          {loading && <ActivityIndicator color="#1854D8" />}
          {loadFailed && <Action onPress={() => setRetry(value => value + 1)} label="다시 불러오기" />}
        </View>
        {/* 스크롤해도 '일정 추가' 버튼과 '시간 · 일과' 머리글이 함께 위에 붙어 있게 한 덩어리로 (2026-11-24) */}
        <View style={s.addBar}>
          <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={addNow} style={[s.addButton, disabled && s.dim]}>
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={s.white}>일정 추가</Text>
          </TouchableOpacity>
          <View style={s.timelineHeading}>
            <Text style={[s.section, s.railHeading]}>시간</Text>
            <Text style={s.section}>일과</Text>
          </View>
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
              const { icon, background, border, accent } = eventAppearance(event.category, title);
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
                    style={[s.eventBlock,
                      { backgroundColor: background, borderColor: border, borderLeftColor: accent },
                      editing === event.id && { borderColor: accent }]}>
                    {!compact && <View style={s.eventIcon} accessible={false}>
                      <Ionicons name={icon} size={23} color={accent} accessible={false} />
                    </View>}
                    <View style={s.eventTitleRow}>
                      {compact && <Ionicons name={icon} size={14} color={accent} accessible={false} />}
                      <Text style={[s.eventTitle, compact && s.eventTitleCompact]} numberOfLines={1}>{title}</Text>
                    </View>
                    <Text style={s.eventTime} numberOfLines={1}>{time}</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
        <AiNotice style={s.aiNotice} />
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
            <View style={s.editorHeader}>
              <Text accessibilityRole="header" style={s.editorTitle}>{editing ? '일정 수정' : '일과 입력'}</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="일과 입력 창 닫기"
                onPress={returnToTimeline} disabled={busy} style={s.editorClose}>
                <Ionicons name="close" size={26} color="#385988" accessible={false} />
              </TouchableOpacity>
            </View>
            {/* 오늘의 일정 '일과 입력' 창과 같은 모양 (2026-11-24): 날짜 → 시간 휠 → 일정 직접 입력 → 추가 옵션 → 취소/일정 추가 */}
            {/* 날짜·시간 휠은 창 위쪽에 고정: 휠을 굴릴 때 창 전체가 같이 움직이지 않게 (2026-11-24) */}
            <View style={s.editorFixed}>
              <Text style={s.todayLabel}>{dateHeading(scheduleDate)}</Text>
              <Text style={s.stepLabel}>시간</Text>
              <View style={s.timeWheels}>
                <ScheduleTimeWheel label="시작" value={form.start || '12:00'} disabled={disabled} setValue={setStartWheel} />
                <ScheduleTimeWheel label="종료" value={form.end || '13:00'} disabled={disabled} setValue={setEndWheel} allowMidnight />
              </View>
              {duration > 0 && <Text style={s.durationHint}>{`${Math.floor(duration / 60) ? Math.floor(duration / 60) + '시간 ' : ''}${duration % 60 ? duration % 60 + '분' : ''}`.trim()} 동안</Text>}
            </View>
            <ScrollView style={s.editorScroll} contentContainerStyle={s.editorBody} keyboardShouldPersistTaps="handled">
              <View style={s.directEntry}>
                <Text style={s.directTitle}>일정 직접 입력</Text>
                <TextInput accessibilityLabel="일정 직접 입력" style={s.input}
                  value={form.title} onChangeText={enterTitle}
                  maxLength={ROUTINE_TITLE_LIMIT} editable={!disabled} placeholder="예: 헬스장, 영화관, 병원 예약"
                  placeholderTextColor="#697C98" returnKeyType="done" />
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: extraOpen }}
                onPress={() => setExtraOpen(value => !value)} style={s.extraToggle}>
                <Text style={s.blue}>{extraOpen ? '추가 옵션 접기' : '추가 옵션'}</Text>
                <Ionicons name={extraOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#245DE5" accessible={false} />
              </TouchableOpacity>
              {extraOpen && <>
                <Text style={s.stepLabel}>메모 <Text style={s.stepHint}>(선택)</Text></Text>
                <TextInput accessibilityLabel="일정 메모" value={form.memo || ''} editable={!disabled}
                  onChangeText={memo => setForm(current => ({ ...current, memo }))} style={[s.input, s.memo]}
                  placeholder="예: 오후 반차 후 병원" placeholderTextColor="#697C98"
                  maxLength={80} multiline textAlignVertical="top" />
              </>}
            </ScrollView>
            {!!error && <Text accessibilityRole="alert" style={s.danger}>{error}</Text>}
            {confirmRemove ? <>
              <Text style={s.confirmText} accessibilityLiveRegion="polite">이 일정을 삭제할까요?</Text>
              <View style={s.actions}>
                <Action disabled={disabled} onPress={() => setConfirmRemove(false)} label="취소" />
                <Action destructive disabled={disabled} onPress={() => remove(editing)} label="일정 삭제" />
              </View>
            </> : <View style={s.editorActions}>
                {editing
                  ? <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => setConfirmRemove(true)}
                      style={[s.editorCancel, s.editorDelete, disabled && s.dim]}>
                      <Text style={[s.editorCancelText, s.editorDeleteText]}>삭제</Text>
                    </TouchableOpacity>
                  : <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 입력 취소" disabled={busy}
                      onPress={returnToTimeline} style={[s.editorCancel, busy && s.dim]}>
                      <Text style={s.editorCancelText}>취소</Text>
                    </TouchableOpacity>}
                <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={() => save(false)}
                  style={[s.editorSave, disabled && s.dim]}>
                  <Text style={s.editorSaveText}>{busy ? '저장 중…' : editing ? '수정 저장' : '일정 추가'}</Text>
                </TouchableOpacity>
              </View>}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  aiNotice: { marginTop: 16 },
  screen: { flex: 1, backgroundColor: '#F1F5FF' },
  scroll: { flex: 1 },
  body: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 23 },
  scheduleHeader: { gap: 16 },
  addBar: { backgroundColor: '#F1F5FF', gap: 16, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: '#DEE7F5' },
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
  eventBlock: { flex: 1, borderRadius: 12, borderWidth: 1, borderLeftWidth: 3, justifyContent: 'center', alignItems: 'center', paddingLeft: 4, paddingRight: 6, overflow: 'hidden' },
  eventIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFFB3', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  eventTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: '100%' },
  eventTitle: { flexShrink: 1, color: '#18365F', fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  eventTitleCompact: { fontSize: 13, lineHeight: 17 },
  eventTime: { color: '#385988', fontSize: 11, lineHeight: 15, textAlign: 'center' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: '#11234380' },
  editor: { width: '100%', maxWidth: 480, maxHeight: '92%', borderRadius: 24, padding: 16, gap: 12, backgroundColor: '#FFFFFF' },
  editorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  editorTitle: { color: '#152D50', fontSize: 26, fontWeight: '800' },
  editorClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editorTime: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  editorScroll: { flexGrow: 0, flexShrink: 1 },
  directEntry: { alignSelf: 'center', width: '100%', maxWidth: 340, gap: 8, marginBottom: 4 },
  directTitle: { color: '#1854D8', fontSize: 15, fontWeight: '800', textAlign: 'center' },
  selectedHour: { backgroundColor: '#1854D8', borderColor: '#1854D8' },
  inRange: { backgroundColor: '#EAF1FF' },
  input: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#D9E5F7', textAlign: 'center', minHeight: 48, paddingHorizontal: 8, color: '#152D50', fontSize: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  draftRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  draftText: { color: '#385988', textAlign: 'center', fontWeight: '700', fontSize: 13 },
  skip: { alignSelf: 'center', justifyContent: 'center', minHeight: 36, paddingHorizontal: 8 },
  button: { backgroundColor: '#EAF1FF', borderRadius: 22, borderWidth: 1, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13, minHeight: 44 },
  deleteButton: { backgroundColor: '#FFF0F2', paddingHorizontal: 18 },
  footer: { backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#DEE7F5', padding: 14, gap: 8 },
  footerRow: { flexDirection: 'row', gap: 8, width: '100%', maxWidth: 688, alignSelf: 'center' },
  primary: { flex: 1, minHeight: 52, backgroundColor: '#104FE7', borderRadius: 26 },
  white: { color: '#FFFFFF', fontWeight: '800', fontSize: 14, textAlign: 'center' },
  blue: { color: '#1D53C9', fontWeight: '800', fontSize: 13 },
  danger: { color: '#B4384D', fontWeight: '700', fontSize: 13, textAlign: 'center' },
  dim: { opacity: 0.45 },
  editorBody: { gap: 12, paddingBottom: 4 },
  editorFixed: { gap: 12 },
  todayLabel: { paddingVertical: 8, textAlign: 'center', color: '#385988', fontSize: 15, fontWeight: '700', backgroundColor: '#F1F5FC', borderRadius: 12 },
  stepLabel: { fontSize: 14, fontWeight: '800', color: '#29456B' },
  stepHint: { fontSize: 12, fontWeight: '400', color: '#5A6E89' },
  timeWheels: { flexDirection: 'row', gap: 12 },
  extraToggle: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 36 },
  memo: { minHeight: 76, paddingTop: 12, textAlign: 'left', paddingHorizontal: 14 },
  editorActions: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  editorCancel: { backgroundColor: '#EDF3FF', borderRadius: 24, paddingHorizontal: 18, minHeight: 52, justifyContent: 'center' },
  editorCancelText: { color: '#245DE5', fontSize: 13, fontWeight: '800' },
  editorDelete: { backgroundColor: '#FFF0F2' },
  editorDeleteText: { color: '#B4384D' },
  editorSave: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 26, backgroundColor: '#104FE7' },
  editorSaveText: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
});
