import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { readProfile, saveDetailedRoutine } from '../utils/routineData';
import { DAYS, INDUSTRIES, normalizeTime, validateDetails } from '../utils/routineDetails';
export default function DetailedRoutineScreen({
  initialDraft = null,
  onDraftChange = () => {},
  onSaved = () => {},
  onBack,
  onContinue,
  readOnly = false
}) {
  const [rows, setRows] = useState(initialDraft || []),
    [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(initialDraft === null),
    [loadError, setLoadError] = useState('');
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [reload, setReload] = useState(0);
  const lock = useRef(false),
    alive = useRef(true),
    sequence = useRef(0);
  useEffect(() => {
    alive.current = true;
    let current = true;
    if (initialDraft === null || reload > 0) {
      setLoading(true);
      setLoadError('');
      readProfile().then(profile => {
        const value = validateDetails(profile.detailedRoutine || []);
        if (current) {
          setRows(value);
          onDraftChange(value);
        }
      }).catch(problem => {
        if (current) setLoadError(problem.message || '이전 일과를 읽지 못했습니다.');
      }).finally(() => {
        if (current) setLoading(false);
      });
    }
    return () => {
      current = false;
      alive.current = false;
    };
  }, [reload]);
  const blocked = readOnly || saving || loading || !!loadError;
  const update = next => {
    if (blocked || lock.current) return;
    setRows(next);
    onDraftChange(next);
    setError('');
  };
  const change = (id, patch) => update(rows.map(row => row.id === id ? {
    ...row,
    ...patch
  } : row));
  const add = category => {
    if (rows.length >= 20) {
      setError('상세 일과는 최대 20개까지 등록할 수 있습니다.');
      return;
    }
    update([...rows, {
      id: 'routine_' + Date.now() + '_' + ++sequence.current,
      category,
      start: '',
      end: '',
      nextDay: false,
      days: [],
      unit: 'week',
      count: ''
    }]);
  };
  const save = async () => {
    if (blocked || lock.current) return;
    let valid;
    try {
      valid = validateDetails(rows);
    } catch (problem) {
      setError(problem.message);
      return;
    }
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      const profile = await saveDetailedRoutine(valid);
      if (!alive.current) return;
      setRows(valid);
      onDraftChange(valid);
      onSaved(profile);
      if (typeof onContinue !== 'function') throw Error('다음 화면 연결을 확인해주세요.');
      await onContinue();
    } catch (problem) {
      if (alive.current) setError(problem.message || '저장하지 못했습니다. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const button = (label, onPress, selected = false, disabled = blocked) => <TouchableOpacity accessibilityRole="button" accessibilityState={{
    selected,
    disabled
  }} disabled={disabled} onPress={onPress} style={[s.chip, selected && s.checked, disabled && s.dim]}><Text style={[s.text, selected && s.blue]}>{label}</Text></TouchableOpacity>;
  return <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={s.scroll} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <Text style={s.blue}>SOL Pay · 상세 일과 설정</Text>
      <Text style={s.title}>자주 가는 곳과 시간을{'\n'}알려주세요</Text>
      <Text style={s.hint}>선택한 업종과 시간·요일·빈도를 맞춤 추천에 참고합니다. 구체적인 장소나 개인정보는 입력하지 않아도 됩니다.</Text>
      {loading && <ActivityIndicator color="#245DE5" />}
      {!!loadError && <View style={s.card}><Text style={s.error}>{loadError}</Text>{button('다시 불러오기', () => setReload(n => n + 1), false, loading)}</View>}
      <View style={s.card}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="업종 선택" accessibilityState={{
          expanded: open,
          disabled: blocked
        }} disabled={blocked} onPress={() => setOpen(value => !value)} style={s.accordion}>
          <Text style={s.name}>업종 선택 · {rows.length}개 일과</Text><Text style={s.blue}>{open ? '접기 ▲' : '펼치기 ▼'}</Text>
        </TouchableOpacity>
        {open && <View style={s.wrap}>{INDUSTRIES.map(([id, label]) => <View key={id}>
          {button(label + (rows.some(row => row.category === id) ? ' ✓' : ''), () => {
              if (!rows.some(row => row.category === id)) add(id);
            }, rows.some(row => row.category === id))}
        </View>)}</View>}
      </View>
      {!rows.length && !loading && <Text style={s.hint}>업종 선택을 펼쳐 카페, 음식점, PC방 등을 골라주세요. 입력 없이 넘어가려면 아래 버튼을 누르세요.</Text>}
      {rows.map((row, index) => <View key={row.id} style={s.card}>
        <View style={s.between}><Text style={s.name}>{index + 1}. {INDUSTRIES.find(([id]) => id === row.category)?.[1] || '업종 확인 필요'}</Text>
          {button('삭제', () => update(rows.filter(item => item.id !== row.id)))}</View>
        <Text style={s.label}>이용 시간 · 직접 입력</Text>
        <View style={s.timeRow}>{[['start', '시작', '09:00'], ['end', '종료', '10:00']].map(([key, label, placeholder]) => <View key={key} style={s.timeCell}>
          <Text style={s.hint}>{label}</Text><TextInput accessibilityLabel={index + 1 + '번째 일과 ' + label + ' 시간'} value={row[key]} editable={!blocked} placeholder={placeholder} placeholderTextColor="#8B98AC" maxLength={5} keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'} autoCorrect={false} autoCapitalize="none" onChangeText={value => change(row.id, {
              [key]: value.replace(/[^\d:]/g, '').slice(0, 5)
            })} onBlur={() => {
              const time = normalizeTime(row[key]);
              if (time) change(row.id, {
                [key]: time
              });
            }} style={s.input} />
        </View>)}</View>
        <Text style={s.hint}>24시간 형식입니다. 930 또는 09:30 입력 가능</Text>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{
          checked: row.nextDay,
          disabled: blocked
        }} disabled={blocked} onPress={() => change(row.id, {
          nextDay: !row.nextDay
        })} style={s.checkbox}><Text style={s.text}>{row.nextDay ? '☑' : '☐'} 다음 날 종료 · 예: 23:00 → 02:00</Text></TouchableOpacity>
        <Text style={s.label}>이용 요일 · 여러 개 선택</Text>
        <View style={s.wrap}>{DAYS.map((day, value) => <TouchableOpacity key={day} accessibilityRole="checkbox" accessibilityLabel={day + '요일'} accessibilityState={{
            checked: row.days.includes(value),
            disabled: blocked
          }} disabled={blocked} onPress={() => change(row.id, {
            days: row.days.includes(value) ? row.days.filter(d => d !== value) : [...row.days, value]
          })} style={[s.chip, row.days.includes(value) && s.checked]}><Text style={s.text}>{day}</Text></TouchableOpacity>)}</View>
        <Text style={s.label}>이용 빈도</Text>
        <View style={s.wrap}>{button('주', () => change(row.id, {
            unit: 'week'
          }), row.unit === 'week')}{button('월', () => change(row.id, {
            unit: 'month'
          }), row.unit === 'month')}
          <TextInput accessibilityLabel={index + 1 + '번째 일과 이용 횟수'} value={String(row.count)} placeholder="횟수" keyboardType="number-pad" maxLength={2} editable={!blocked} onChangeText={value => change(row.id, {
            count: value.replace(/\D/g, '')
          })} style={[s.input, s.count]} /><Text style={s.text}>회 이용</Text>
        </View>
        {button('+ 같은 업종의 다른 시간 추가', () => add(row.category))}
      </View>)}
      <Text style={s.hint}>요일은 이용을 시작하는 날 기준입니다. 입력한 내용은 이 기기에 저장되며, 일과 설정에서 다시 변경할 수 있습니다.</Text>
    </ScrollView>
    <View style={s.footer}>
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}
      <View style={s.footerRow}>
        <TouchableOpacity accessibilityRole="button" disabled={saving || loading || readOnly} onPress={() => {
          if (!lock.current) onBack?.();
        }} style={[s.back, (saving || loading || readOnly) && s.dim]}><Text style={s.blue}>이전</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={blocked} onPress={save} style={[s.primary, blocked && s.dim]}>{saving ? <ActivityIndicator color="#FFF" /> : <Text style={s.white}>{rows.length ? '저장하고 맞춤 카드 보기' : '추가 입력 없이 계속'}</Text>}</TouchableOpacity>
      </View>
    </View>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  scroll: {
    flex: 1,
    minHeight: 0
  },
  body: {
    padding: 22,
    paddingTop: 28,
    paddingBottom: 40,
    gap: 18,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center"
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
  blue: {
    fontSize: 13,
    color: "#245DE5",
    fontWeight: "700"
  },
  card: {
    padding: 22,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    gap: 14,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  accordion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    gap: 10
  },
  name: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '800',
    color: "#142D4E",
    flexShrink: 1
  },
  text: {
    fontSize: 13,
    lineHeight: 20,
    color: '#365175'
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: "#142D4E"
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center'
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 13,
    backgroundColor: '#F8FAFE',
    minHeight: 46
  },
  checked: {
    borderColor: "#245DE5",
    backgroundColor: "#EDF3FF"
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  timeRow: {
    flexDirection: 'row',
    gap: 12
  },
  timeCell: {
    flex: 1,
    gap: 6
  },
  input: {
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 14,
    padding: 15,
    fontSize: 16,
    color: "#142D4E",
    backgroundColor: "#FFFFFF",
    minHeight: 52
  },
  count: {
    width: 75
  },
  checkbox: {
    paddingVertical: 10
  },
  footer: {
    flexShrink: 0,
    padding: 18,
    paddingBottom: 26,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderColor: "#E3EAF4",
    gap: 10
  },
  footerRow: {
    flexDirection: 'row',
    gap: 10,
    width: "100%",
    maxWidth: 676,
    alignSelf: "center"
  },
  back: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#EDF3FF",
    justifyContent: 'center',
    minHeight: 44
  },
  primary: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#245DE5",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54
  },
  white: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: "#C53D56"
  },
  dim: {
    opacity: 0.4
  }
});
