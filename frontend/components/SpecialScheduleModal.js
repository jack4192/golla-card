import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { INDUSTRIES, INDUSTRY_ICONS, ROUTINE_TITLE_LIMIT } from '../utils/routineDetails';
import { CATEGORIES, categoryLabel, isCustomCategory, EVENT_ICONS, EVENT_OPTIONS, eventBenefitCategories, confirmToday, dateKey, deleteEvent, eventTimeCaption, eventTitle, eventTypeBenefitLabel, readEvents, saveEvent, shiftDate, validDate } from '../utils/routineData';

// 시간대 빠른 선택
const TIME_PRESETS = [
  ['오전', '09:00', '12:00'],
  ['점심', '12:00', '13:00'],
  ['오후', '13:00', '18:00'],
  ['저녁', '18:00', '21:00'],
  ['밤', '21:00', '24:00'],
];
const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const START_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const isStart = value => START_PATTERN.test(value);
const isEnd = value => value === '24:00' || START_PATTERN.test(value);
// 숫자만 입력해도 0930 → 09:30 처럼 바꿔줍니다.
const formatTime = text => {
  const digits = String(text).replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits;
};
const rangeReadyOf = (mode, start, end) => mode === 'allday' || (isStart(start) && isEnd(end) && start !== end);
const isOvernight = (mode, start, end) => mode === 'range' && isStart(start) && isEnd(end) && end !== '24:00' && end < start;

function dateHeading(day) {
  const today = dateKey();
  const value = new Date(day + 'T12:00:00');
  const text = `${value.getMonth() + 1}월 ${value.getDate()}일 (${DAYS[value.getDay()]})`;
  if (day === today) return '오늘 · ' + text;
  if (day === shiftDate(today, 1)) return '내일 · ' + text;
  return text;
}

// 1단계: 일정 종류 + 카드 추천 반영 안내
// 직접 입력은 저장 시 types에 'other' + title 로 저장됩니다. 일정 종류는 하나만 고른다(직접 입력 또는 칩 하나).
function TypePicker({ types, setTypes, title, setTitle, disabled }) {
  const labels = [...new Set(types.map(eventTypeBenefitLabel).filter(Boolean))];
  const typed = types.includes('other');
  return <>
    <TextInput accessibilityLabel="일정 이름 직접 입력" value={title} editable={!disabled}
      onChangeText={text => {
        setTitle(text);
        // 직접 입력하면 고른 칩은 풀린다
        setTypes(text.trim() ? ['other'] : []);
      }}
      style={[s.input, s.fullInput, typed && s.inputActive]} placeholder="직접 입력 · 예: 치과 정기검진, 친구 생일 파티" maxLength={40} />
    <Text style={s.orText}>또는 아래에서 하나를 골라주세요</Text>
    <View style={s.options}>
      {EVENT_OPTIONS.filter(([value]) => value !== 'other').map(([value, label]) => {
        const checked = types.includes(value);
        return <TouchableOpacity key={value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: checked, disabled }}
          style={[s.option, checked && s.selected]}
          onPress={() => {
            // 하나만 선택: 같은 칩을 다시 누르면 해제, 다른 칩을 누르면 바뀐다. 직접 입력한 이름은 지운다
            setTitle('');
            setTypes(previous => previous.includes(value) ? [] : [value]);
          }}>
          <Ionicons name={EVENT_ICONS[value]} size={17} color="#1854D8" />
          <Text style={[s.optionText, checked && s.optionTextSelected]}>{label}</Text>
        </TouchableOpacity>;
      })}
    </View>
    {!!labels.length && <View style={s.benefitHint}>
        <Ionicons name="card-outline" size={16} color="#245196" />
        <Text style={s.benefitHintText}>카드 추천에 반영돼요: {labels.join(', ')} 혜택</Text>
      </View>}
  </>;
}

// 2단계: 하루 종일 / 시간 지정
function TimePicker({ mode, setMode, start, setStart, end, setEnd, disabled, allowAllDay = true }) {
  const overnight = isOvernight(mode, start, end);
  return <>
    {allowAllDay && <View style={s.segment}>
      {[['allday', '하루 종일'], ['range', '시간 지정']].map(([value, label]) => <TouchableOpacity key={value} disabled={disabled}
          accessibilityRole="radio" accessibilityState={{ selected: mode === value, disabled }}
          style={[s.segmentItem, mode === value && s.segmentActive]} onPress={() => setMode(value)}>
          <Text style={[s.segmentText, mode === value && s.segmentTextActive]}>{label}</Text>
        </TouchableOpacity>)}
    </View>}
    {mode === 'range' && <>
        {/* 직접 입력이 먼저, 빠른 선택은 그 아래 */}
        <Text style={s.step}>직접 입력</Text>
        <View style={s.timeRow}>
          <View style={s.timeField}>
            <Text style={s.timeLabel}>시작</Text>
            <TextInput accessibilityLabel="시작 시간" value={start} onChangeText={text => setStart(formatTime(text))} editable={!disabled}
              style={[s.input, s.timeInput, !!start && !isStart(start) && s.inputError]} placeholder="09:00" keyboardType="number-pad" maxLength={5} />
          </View>
          <Text style={s.timeDash}>~</Text>
          <View style={s.timeField}>
            <Text style={s.timeLabel}>종료{overnight ? ' (다음 날)' : ''}</Text>
            <TextInput accessibilityLabel="종료 시간" value={end} onChangeText={text => setEnd(formatTime(text))} editable={!disabled}
              style={[s.input, s.timeInput, !!end && !isEnd(end) && s.inputError]} placeholder="18:00" keyboardType="number-pad" maxLength={5} />
          </View>
        </View>
        <Text style={s.hint}>숫자만 입력해도 돼요(예: 1930 → 19:30). 종료가 시작보다 이르면 다음 날로 계산해요.</Text>
        <Text style={s.orText}>또는 아래에서 골라주세요</Text>
        <View style={s.options}>
          {TIME_PRESETS.map(([label, from, to]) => {
            const active = start === from && end === to;
            return <TouchableOpacity key={label} disabled={disabled} accessibilityRole="button" accessibilityLabel={label + ' ' + from + '부터 ' + to + '까지'}
              style={[s.preset, active && s.selected]} onPress={() => { setStart(from); setEnd(to); }}>
              <Text style={[s.presetLabel, active && s.optionTextSelected]}>{label}</Text>
              <Text style={s.presetTime}>{from}~{to}</Text>
            </TouchableOpacity>;
          })}
        </View>
      </>}
  </>;
}

// 장소 일정: 업종 직접 입력이 기본, 아래 항목은 빠른 선택(한 개)
// 직접 입력은 저장 시 category 'other' + title 로 저장되고, 입력한 업종으로 카드 혜택을 찾습니다.
function PlacePicker({ category, setCategory, title, setTitle, disabled }) {
  const typed = category === 'other';
  const labels = category
    ? [...new Set(eventBenefitCategories({ category, title }).map(categoryLabel).filter(Boolean))]
    : [];
  const custom = typed && eventBenefitCategories({ category, title }).some(isCustomCategory);
  return <>
    <Text style={s.step}>업종 직접 입력</Text>
    <TextInput accessibilityLabel="업종 직접 입력" value={typed ? title : ''} editable={!disabled}
      onChangeText={text => {
        setTitle(text);
        setCategory(text.trim() ? 'other' : '');
      }}
      style={[s.input, typed && s.inputActive]} placeholder="예: 헬스장, 영화관, 미용실, 학원" maxLength={ROUTINE_TITLE_LIMIT} />
    <Text style={s.orText}>찾는 업종이 아래에 없으면 위에 직접 적어주세요</Text>
    <View style={s.options}>
      {INDUSTRIES.filter(([value]) => value !== 'other').map(([value, text]) => {
        const checked = category === value;
        return <TouchableOpacity key={value} disabled={disabled} accessibilityRole="radio" accessibilityState={{ selected: checked, disabled }}
          style={[s.option, checked && s.selected]} onPress={() => { setCategory(value); setTitle(''); }}>
          <Ionicons name={INDUSTRY_ICONS[value]} size={17} color="#1854D8" />
          <Text style={[s.optionText, checked && s.optionTextSelected]}>{text}</Text>
        </TouchableOpacity>;
      })}
    </View>
    {!!labels.length && <View style={s.benefitHint}>
        <Ionicons name="card-outline" size={16} color="#245196" />
        <Text style={s.benefitHintText}>카드 추천에 반영돼요: {labels.join(', ')} {custom ? '관련 혜택을 카드에서 찾아요' : '혜택'}</Text>
      </View>}
  </>;
}

function MemoInput({ memo, setMemo, types, disabled }) {
  return <>
    <TextInput accessibilityLabel="일정 메모" value={memo} onChangeText={setMemo} editable={!disabled} style={[s.input, s.memo]}
      placeholder="예: 오후 반차 후 병원 · 개인정보는 적지 마세요"
      maxLength={80} multiline textAlignVertical="top" />
    <Text style={s.counter}>{memo.length}/80</Text>
  </>;
}

const problemOf = (types, mode, start, end) => !types.length ? '일정을 직접 입력하거나 아래에서 골라주세요.'
  : !rangeReadyOf(mode, start, end) ? '시작·종료 시간을 입력하거나 하루 종일을 선택해주세요.' : '';

// mode: 'manage' = 등록된 일정 목록·수정·삭제, 'add' = 새 일정 추가
export default function SpecialScheduleModal({
  visible,
  mode = 'manage',
  onClose,
  onChanged,
  onConfirmed,
  onEditTimed,
  onRequestAdd,
  readOnly = false
}) {
  const adding = mode === 'add';
  const [date, setDate] = useState(dateKey);
  const [events, setEvents] = useState([]);
  const [types, setTypes] = useState([]);
  const [memo, setMemo] = useState('');
  const [timeMode, setTimeMode] = useState('allday');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  // 관리 화면의 아래 창: { kind: 'type' | 'time', event }
  const [sheet, setSheet] = useState(null);
  const [placeCategory, setPlaceCategory] = useState('');
  const [placeTitle, setPlaceTitle] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  // 방금 추가한 일정(추가 완료 안내용). 새로 입력을 시작하면 안내를 숨긴다.
  const [added, setAdded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  // 일정을 추가하면 화면 맨 위로 올려서 바로 다음 일정을 입력할 수 있게 한다
  const scrollRef = useRef(null);
  const mounted = useRef(true);
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
    setMessage('');
    setAdded(null);
    setSheet(null);
    readEvents().then(value => {
      if (active) setEvents(value);
    }).catch(() => {
      if (active) {
        setLoadError('일정을 불러오지 못했습니다. 다시 불러온 후 변경해주세요.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [visible, reload, mode]);
  const clear = () => {
    setTypes([]);
    setPlaceTitle('');
    setMemo('');
    setTimeMode('allday');
    setStart('');
    setEnd('');
  };
  const dirty = adding && (types.length > 0 || !!memo.trim() || timeMode === 'range');
  const disabled = busy || loading || !!loadError || readOnly;
  const formProblem = problemOf(types, timeMode, start, end);
  const today = dateKey();
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  const upcoming = sorted.filter(event => event.date >= today);
  const past = sorted.filter(event => event.date < today).reverse();
  const group = list => list.reduce((groups, event) => {
    const last = groups[groups.length - 1];
    if (last && last.date === event.date) last.items.push(event);
    else groups.push({ date: event.date, items: [event] });
    return groups;
  }, []);
  const close = () => {
    if (!lock.current) {
      onClose?.();
    }
  };
  const changeDate = next => {
    if (lock.current) return;
    setDate(next);
    setMessage('');
  };
  const run = async action => {
    if (!visible || readOnly || lock.current || loading || loadError) {
      return;
    }
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (problem) {
      if (mounted.current) {
        setMessage(problem.message || '처리에 실패했습니다. 다시 시도해주세요.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  };
  const store = saved => setEvents(previous => [saved, ...previous.filter(event => event.id !== saved.id)]);
  const add = () => run(async () => {
    const saved = await saveEvent({
      date,
      types,
      title: placeTitle,
      memo,
      ...(timeMode === 'range' ? { start, end } : {})
    });
    if (!mounted.current) return;
    store(saved);
    clear();
    setAdded(saved);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    setMessage(`${dateHeading(saved.date)}에 '${eventTitle(saved)}' 일정을 추가했어요.`);
    onChanged?.();
  });
  const remove = id => run(async () => {
    await deleteEvent(id);
    if (!mounted.current) return;
    setEvents(previous => previous.filter(event => event.id !== id));
    setMessage('일정을 삭제했어요.');
    onChanged?.();
  });
  const confirm = () => run(async () => {
    await confirmToday();
    if (!mounted.current) return;
    onConfirmed?.();
    onClose?.();
  });
  const openSheet = (kind, event) => {
    setPlaceCategory(event.category || '');
    setPlaceTitle(event.title || (!event.category && event.types.includes('other') ? event.memo || '' : ''));
    setTypes([...event.types]);
    setMemo(event.memo || '');
    setTimeMode(event.start ? 'range' : 'allday');
    setStart(event.start || '');
    setEnd(event.end || '');
    setMessage('');
    setSheet({ kind, event });
  };
  const closeSheet = () => {
    if (lock.current) return;
    setSheet(null);
    clear();
  };
  const isPlace = Boolean(sheet?.event.category);
  const sheetProblem = !sheet ? ''
    : !isPlace ? problemOf(types, timeMode, start, end)
    : !placeCategory || (placeCategory === 'other' && !placeTitle.trim()) ? '일정 이름을 직접 입력하거나 아래에서 골라주세요.'
    : !rangeReadyOf('range', start, end) ? '시작·종료 시간을 입력해주세요.' : '';
  const saveSheet = () => run(async () => {
    const saved = await saveEvent(isPlace ? {
      id: sheet.event.id,
      date: sheet.event.date,
      category: placeCategory,
      title: placeTitle,
      start,
      end,
      memo
    } : {
      id: sheet.event.id,
      date: sheet.event.date,
      types,
      title: placeTitle,
      memo,
      ...(timeMode === 'range' ? { start, end } : {})
    });
    if (!mounted.current) return;
    store(saved);
    setSheet(null);
    clear();
    setMessage(sheet.kind === 'time' ? '시간을 바꿨어요.' : '일정을 바꿨어요.');
    onChanged?.();
  });

  const renderRow = event => <View key={event.id} style={s.row}>
      <View style={s.rowMain}>
        <Text style={s.rowTitle} numberOfLines={2}>{eventTitle(event)}</Text>
        <View style={s.rowMeta}>
          <View style={[s.timeBadge, !event.start && s.timeBadgeAllDay]}>
            <Text style={[s.timeBadgeText, !event.start && s.timeBadgeTextAllDay]}>{eventTimeCaption(event) || '하루 종일'}</Text>
          </View>
          {!!event.category && <Text style={s.kindText}>장소 일정</Text>}
        </View>
        {!!event.memo && <Text style={s.rowMemo} numberOfLines={2}>{event.memo}</Text>}
      </View>
      <View style={s.rowActions}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={eventTitle(event) + ' 일정 변경'} disabled={disabled}
          style={s.action} onPress={() => openSheet('type', event)}>
          <Text style={s.actionText}>일정 변경</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={eventTitle(event) + ' 시간 재설정'} disabled={disabled}
          style={s.action} onPress={() => openSheet('time', event)}>
          <Text style={s.actionText}>시간 재설정</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={eventTitle(event) + ' 삭제'} disabled={disabled}
          style={[s.action, s.actionDanger]} onPress={() => remove(event.id)}>
          <Text style={s.actionDangerText}>삭제</Text>
        </TouchableOpacity>
      </View>
    </View>;

  const renderGroups = list => group(list).map(({ date: day, items }) => <View key={day} style={s.groupBlock}>
      <Text style={s.groupTitle}>{dateHeading(day)} · {items.length}건</Text>
      <View style={s.card}>{items.map(renderRow)}</View>
    </View>);

  const manageBody = <>
      <Text style={s.title}>등록된 일정</Text>
      <Text style={s.hint}>일정 종류나 시간을 바로 바꿀 수 있어요. 새 일정은 '일정 추가'에서 등록해요.</Text>
      {!upcoming.length && <View style={[s.card, s.emptyCard]}>
          <Text style={s.emptyTitle}>앞으로 예정된 일정이 없어요</Text>
          <Text style={s.hint}>반차, 회식, 병원 예약처럼 오늘과 다른 일정을 추가하면 맞는 카드를 추천해드려요.</Text>
          {!!onRequestAdd && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.primary} onPress={onRequestAdd}>
              <Text style={s.white}>+ 일정 추가하기</Text>
            </TouchableOpacity>}
        </View>}
      {renderGroups(upcoming)}
      {!!past.length && <TouchableOpacity accessibilityRole="button" style={s.pastToggle} onPress={() => setShowPast(value => !value)}>
          <Text style={s.blue}>{showPast ? '지난 일정 접기 ▲' : `지난 일정 ${past.length}건 보기 ▼`}</Text>
        </TouchableOpacity>}
      {showPast && renderGroups(past)}
    </>;

  const addBody = <>
      {/* 추가가 끝나면 빈 칸 경고 대신 '추가 완료'를 보여주고, 입력을 시작하면 다시 확인 문구를 보여준다 */}
      {added && !dirty && <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.addedBox}>
          <Text style={s.addedTitle}>✓ 일정이 추가되었어요</Text>
          <Text style={s.addedText}>{dateHeading(added.date)} · {eventTitle(added)}{eventTimeCaption(added) ? ' · ' + eventTimeCaption(added) : ' · 하루 종일'}</Text>
          <Text style={s.addedHint}>다른 일정도 이어서 추가할 수 있어요.</Text>
        </View>}
      <Text style={s.title}>어떤 일정이 있나요?</Text>
      <Text style={s.hint}>평소와 다른 일정을 등록하면 그날에 맞는 카드 혜택을 추천해드려요.</Text>
      <View style={s.card}>
        <Text style={s.step}>날짜</Text>
        <View style={s.dateButtons}>
          <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(shiftDate(date, -1))}>
            <Text style={s.blue}>← 전날</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(dateKey())}>
            <Text style={s.blue}>오늘</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.small} onPress={() => changeDate(shiftDate(date, 1))}>
            <Text style={s.blue}>다음 날 →</Text>
          </TouchableOpacity>
        </View>
        <TextInput accessibilityLabel="일정 날짜" value={date} onChangeText={changeDate} editable={!busy} style={s.input} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" autoCorrect={false} />
        {validDate(date) ? <Text style={s.hint}>{dateHeading(date)}</Text> : <Text style={s.error}>실제 날짜를 YYYY-MM-DD로 입력해주세요.</Text>}

        <Text style={s.step}>1. 어떤 일정인가요?</Text>
        <TypePicker types={types} setTypes={setTypes} title={placeTitle} setTitle={setPlaceTitle} disabled={disabled} />

        <Text style={s.step}>2. 언제인가요?</Text>
        <TimePicker mode={timeMode} setMode={setTimeMode} start={start} setStart={setStart} end={end} setEnd={setEnd} disabled={disabled} />

        <Text style={s.step}>3. 메모 <Text style={s.stepHint}>(선택)</Text></Text>
        <MemoInput memo={memo} setMemo={setMemo} types={types} disabled={disabled} />

        {!!formProblem && !disabled && dirty && <Text style={s.formProblem}>{formProblem}</Text>}
        <TouchableOpacity accessibilityRole="button" disabled={disabled || !validDate(date) || !!formProblem} style={[s.primary, (disabled || !validDate(date) || !!formProblem) && s.dim]} onPress={add}>
          <Text style={s.white}>{busy ? '처리 중…' : '일정 추가'}</Text>
        </TouchableOpacity>
        {dirty && <TouchableOpacity accessibilityRole="button" disabled={busy || readOnly} style={s.small} onPress={() => { clear(); setMessage(''); }}>
            <Text style={s.blue}>입력 초기화</Text>
          </TouchableOpacity>}
      </View>

      {!!onEditTimed && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.placeLink} onPress={() => { onClose?.(); onEditTimed(date); }}>
          <View style={{ flex: 1 }}>
            <Text style={s.placeLinkTitle}>카페·편의점처럼 장소로 추가하기</Text>
            <Text style={s.hint}>시간표에서 시간을 눌러 장소 일정을 넣어요.</Text>
          </View>
          <Text style={s.placeLinkArrow}>›</Text>
        </TouchableOpacity>}
    </>;

  return <Modal visible={visible} transparent={false} presentationStyle="fullScreen" animationType="slide" onRequestClose={sheet ? closeSheet : close}>
      <SafeAreaView style={s.screen}>
        <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
          <View style={s.header}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 화면 뒤로 가기" disabled={busy} onPress={close} style={s.back}>
              <Text style={s.backText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>{adding ? '일정 추가' : '일정 관리'}</Text>
            <View style={s.headerSpace} />
          </View>

          <ScrollView ref={scrollRef} style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
            {loading && <ActivityIndicator color="#245DE5" />}
            {!!loadError && <View style={s.card}>
                <Text accessibilityRole="alert" style={s.error}>{loadError}</Text>
                <TouchableOpacity accessibilityRole="button" disabled={loading} style={s.small} onPress={() => setReload(value => value + 1)}>
                  <Text style={s.blue}>다시 불러오기</Text>
                </TouchableOpacity>
              </View>}
            {!loading && !loadError && (adding ? addBody : manageBody)}
          </ScrollView>

          <View style={s.footer}>
            {!!message && <Text accessibilityLiveRegion="polite" style={s.message}>{message}</Text>}
            <View style={s.footerRow}>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={close} style={[s.returnButton, busy && s.dim]}>
                <Text style={s.blue}>돌아가기</Text>
              </TouchableOpacity>
              {!adding && <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={confirm} style={[s.confirmButton, disabled && s.dim]}>
                  <Text style={s.white}>{busy ? '처리 중…' : '오늘 일정 확인 완료'}</Text>
                </TouchableOpacity>}
            </View>
          </View>

          {!!sheet && <View style={s.sheetLayer}>
              <TouchableOpacity accessibilityLabel="변경 창 닫기" activeOpacity={1} style={s.sheetBackdrop} onPress={closeSheet} />
              <View style={s.sheet}>
                <View style={s.sheetHandle} />
                <Text style={s.sheetTitle}>{sheet.kind === 'time' ? '시간 재설정' : '일정 변경'}</Text>
                <Text style={s.hint}>{dateHeading(sheet.event.date)} · {eventTitle(sheet.event)}</Text>
                <ScrollView style={s.sheetScroll} contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
                  {sheet.kind === 'time'
                    ? <>
                        {isPlace && <Text style={s.hint}>장소 일정은 시간이 꼭 필요해요.</Text>}
                        <TimePicker mode={timeMode} setMode={setTimeMode} start={start} setStart={setStart} end={end} setEnd={setEnd} disabled={busy} allowAllDay={!isPlace} />
                      </>
                    : <>
                        {isPlace
                          ? <PlacePicker category={placeCategory} setCategory={setPlaceCategory} title={placeTitle} setTitle={setPlaceTitle} disabled={busy} />
                          : <TypePicker types={types} setTypes={setTypes} title={placeTitle} setTitle={setPlaceTitle} disabled={busy} />}
                        <Text style={s.step}>메모 <Text style={s.stepHint}>(선택)</Text></Text>
                        <MemoInput memo={memo} setMemo={setMemo} types={types} disabled={busy} />
                      </>}
                </ScrollView>
                {!!sheetProblem && <Text style={s.formProblem}>{sheetProblem}</Text>}
                <View style={s.footerRow}>
                  <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={closeSheet} style={s.returnButton}>
                    <Text style={s.blue}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" disabled={busy || !!sheetProblem} onPress={saveSheet} style={[s.confirmButton, (busy || !!sheetProblem) && s.dim]}>
                    <Text style={s.white}>{busy ? '저장 중…' : '저장'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>;
}
const s = StyleSheet.create({
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
    gap: 16
  },
  title: {
    fontSize: 26,
    lineHeight: 36,
    fontWeight: "800",
    color: "#142D4E"
  },
  hint: {
    fontSize: 13,
    lineHeight: 21,
    color: "#5A6E89"
  },
  card: {
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 22,
    gap: 13,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  emptyCard: {
    alignItems: 'stretch'
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#142D4E'
  },
  groupBlock: {
    gap: 8
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#142D4E',
    marginTop: 4
  },
  row: {
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderColor: '#EEF2F8'
  },
  rowMain: {
    gap: 6
  },
  rowTitle: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '800',
    color: '#1E395F'
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  timeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF1FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  timeBadgeAllDay: {
    backgroundColor: '#F1F4F9'
  },
  timeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#245DE5'
  },
  timeBadgeTextAllDay: {
    color: '#5A6E89'
  },
  kindText: {
    fontSize: 12,
    color: '#5A6E89'
  },
  rowMemo: {
    fontSize: 13,
    lineHeight: 20,
    color: '#5A6E89'
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8
  },
  action: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    backgroundColor: '#EDF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#245DE5'
  },
  actionDanger: {
    flex: 0,
    flexShrink: 0,
    minWidth: 64,
    paddingHorizontal: 16,
    backgroundColor: '#FDEEF1'
  },
  actionDangerText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#C53D56'
  },
  pastToggle: {
    alignItems: 'center',
    padding: 12
  },
  dateButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    justifyContent: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
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
  optionTextSelected: {
    color: '#245DE5',
    fontWeight: '700'
  },
  step: {
    fontSize: 14,
    fontWeight: '800',
    color: '#29456B',
    marginTop: 4
  },
  stepHint: {
    fontSize: 12,
    fontWeight: '400',
    color: '#5A6E89'
  },
  benefitHint: {
    backgroundColor: '#F1F6FF',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  benefitHintText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: '#245196',
    fontWeight: '600'
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#EEF2F8',
    borderRadius: 12,
    padding: 4,
    gap: 4
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  segmentActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9D9FF'
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5A6E89'
  },
  segmentTextActive: {
    color: '#245DE5',
    fontWeight: '800'
  },
  preset: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#E3EAF4',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  presetLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#355276'
  },
  presetTime: {
    fontSize: 11,
    color: '#5A6E89'
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10
  },
  timeField: {
    flex: 1,
    gap: 6
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5A6E89'
  },
  timeInput: {
    textAlign: 'center',
    fontWeight: '700'
  },
  timeDash: {
    fontSize: 18,
    color: '#5A6E89',
    paddingBottom: 14
  },
  fullInput: {
    width: '100%'
  },
  inputActive: {
    borderColor: '#245DE5',
    backgroundColor: '#F7FAFF'
  },
  orText: {
    fontSize: 12,
    color: '#5A6E89',
    textAlign: 'center'
  },
  inputError: {
    borderColor: '#C53D56'
  },
  addedBox: { backgroundColor: '#E6F6EE', borderRadius: 14, padding: 14, gap: 4, borderWidth: 1, borderColor: '#A8DFC2' },
  addedTitle: { color: '#087D54', fontSize: 15, fontWeight: '800' },
  addedText: { color: '#1D4A36', fontSize: 14, fontWeight: '600' },
  addedHint: { color: '#4C7A65', fontSize: 12 },
  formProblem: {
    fontSize: 13,
    color: '#B45309',
    textAlign: 'center'
  },
  placeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#E3EAF4',
    padding: 18
  },
  placeLinkTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1E395F'
  },
  placeLinkArrow: {
    fontSize: 26,
    color: '#5A6E89'
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
  sheetLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end'
  },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(12, 22, 44, 0.45)'
  },
  sheet: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 24,
    gap: 10
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D5DDEA'
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#142D4E'
  },
  sheetScroll: {
    flexGrow: 0
  },
  sheetBody: {
    gap: 12,
    paddingVertical: 6
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
