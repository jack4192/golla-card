import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { QUESTIONS, completeProfile, deleteProfile, normalizeProfile, readProfile, saveProfile } from '../utils/routineData';
export default function DailyRoutineScreen({
  onContinue,
  onBack,
  initialDraft = null,
  onDraftChange = () => {},
  readOnly = false
}) {
  const [profile, setProfile] = useState(() => normalizeProfile(initialDraft));
  const [loading, setLoading] = useState(initialDraft === null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  useEffect(() => {
    if (initialDraft !== null && reload === 0) return;
    let active = true;
    setLoading(true);
    setLoadError(false);
    readProfile().then(value => {
      if (!active) return;
      setProfile(value);
      if (!completeProfile(value) && value.updatedAt) {
        setMessage('기존 답변은 유지했습니다. 추가된 질문에도 답해주세요.');
      }
    }).catch(() => {
      if (active) {
        setLoadError(true);
        setMessage('이전 기록을 불러오지 못했습니다. 다시 불러온 후 저장해주세요.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [reload]);
  const change = (key, value) => {
    if (readOnly || lock.current || loading || loadError) return;
    const next = {
      ...profile,
      [key]: value
    };
    setProfile(next);
    onDraftChange(next);
    setMessage('');
  };
  const save = async goNext => {
    if (readOnly || lock.current || loading || loadError) return;
    if (!completeProfile(profile)) {
      setMessage('7가지 질문에 모두 답변해주세요.');
      return;
    }
    lock.current = true;
    setSaving(true);
    setMessage('');
    try {
      const record = await saveProfile(profile);
      setProfile(record);
      onDraftChange(record);
      if (goNext) {
        await onContinue?.();
      } else {
        setMessage('평소 일과가 저장됐습니다.');
      }
    } catch (error) {
      setMessage(error?.message || '저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const remove = async () => {
    if (readOnly || lock.current || loading || loadError) return;
    lock.current = true;
    setSaving(true);
    try {
      await deleteProfile();
      const empty = normalizeProfile(null);
      setProfile(empty);
      onDraftChange(empty);
      setMessage('평소 일과 기록을 삭제했습니다.');
    } catch {
      setMessage('기록을 삭제하지 못했습니다.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const leave = callback => {
    if (readOnly || lock.current || loading) return;
    if (!loadError) {
      onDraftChange({
        ...profile
      });
    }
    callback?.();
  };
  const answered = QUESTIONS.filter(question => profile[question.key]).length;
  const disabled = readOnly || saving || loadError;
  if (loading) {
    return <View style={styles.loading}>
        <ActivityIndicator color="#245DE5" />
        <Text>일과 기록을 불러오는 중…</Text>
      </View>;
  }
  return <ScrollView style={styles.screen} contentContainerStyle={styles.body}>
      <Text style={styles.step}>SOL Pay · 생활 패턴 분석</Text>

      <Text style={styles.title}>
        평소 하루는 어떠신가요? ☀️
      </Text>

      <Text style={styles.subtitle}>
        일과와 소비 습관에 맞는 카드 혜택을 찾아드려요.
        GPS나 계좌 연결은 사용하지 않습니다.
      </Text>

      <Text style={styles.progress}>
        {answered} / {QUESTIONS.length}개 답변 완료
      </Text>

      {QUESTIONS.map((question, index) => <View key={question.key} style={styles.card}>
          <Text style={styles.question}>
            {index + 1}. {question.title}
          </Text>

          <View style={styles.options}>
            {question.options.map(([value, label]) => {
          const selected = profile[question.key] === value;
          return <TouchableOpacity key={value} disabled={disabled} accessibilityRole="radio" accessibilityState={{
            checked: selected
          }} style={[styles.option, selected && styles.selected]} onPress={() => change(question.key, value)}>
                  <Text style={[styles.optionText, selected && styles.selectedText]}>
                    {label}
                  </Text>
                </TouchableOpacity>;
        })}
          </View>
        </View>)}

      {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">
          {message}
        </Text>}

      {loadError && <TouchableOpacity style={styles.secondary} onPress={() => setReload(value => value + 1)}>
          <Text>다시 불러오기</Text>
        </TouchableOpacity>}

      <TouchableOpacity disabled={disabled} style={[styles.primary, disabled && styles.dim]} onPress={() => save(true)}>
        <Text style={styles.white}>
          {saving ? '저장 중…' : '저장하고 상세 일과 설정'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity disabled={disabled} style={styles.secondary} onPress={() => save(false)}>
        <Text style={styles.blue}>기록만 저장하기</Text>
      </TouchableOpacity>

      <View style={styles.row}>
        <TouchableOpacity disabled={readOnly || saving} style={styles.link} onPress={() => leave(onBack)}>
          <Text style={styles.blue}>이전으로</Text>
        </TouchableOpacity>

        <TouchableOpacity disabled={readOnly || saving || loadError} style={styles.link} onPress={() => leave(onContinue)}>
          <Text style={styles.blue}>이번에는 건너뛰기</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity disabled={disabled} style={styles.link} onPress={remove}>
        <Text style={styles.delete}>저장된 평소 일과 삭제</Text>
      </TouchableOpacity>

      <Text style={styles.notice}>
        건너뛰면 저장된 일과와 오늘 일정으로 추천합니다.
        저장하지 않은 답변은 이전 화면으로 돌아와도 유지됩니다.
      </Text>
    </ScrollView>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 14
  },
  step: {
    fontSize: 12,
    fontWeight: '800',
    color: "#245DE5"
  },
  title: {
    fontSize: 28,
    lineHeight: 39,
    fontWeight: "800",
    color: "#142D4E"
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 24,
    color: "#5A6E89"
  },
  progress: {
    color: "#245DE5",
    fontWeight: '700',
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#EDF3FF",
    borderRadius: 12
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 22,
    gap: 14,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  question: {
    color: "#142D4E",
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 26
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9
  },
  option: {
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#DFE5EF',
    minHeight: 46
  },
  selected: {
    backgroundColor: "#EDF3FF",
    borderColor: "#245DE5"
  },
  optionText: {
    fontSize: 13,
    color: '#53647D'
  },
  selectedText: {
    color: "#245DE5",
    fontWeight: '800'
  },
  primary: {
    padding: 16,
    borderRadius: 16,
    alignItems: "center",
    backgroundColor: "#245DE5",
    minHeight: 54,
    justifyContent: "center"
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  secondary: {
    padding: 14,
    borderRadius: 14,
    alignItems: "center",
    backgroundColor: "#EDF3FF",
    minHeight: 46,
    justifyContent: "center"
  },
  blue: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  link: {
    padding: 12,
    alignItems: 'center',
    fontSize: 13,
    fontWeight: "700",
    color: "#245DE5"
  },
  delete: {
    color: '#AB4051',
    fontSize: 12
  },
  message: {
    color: '#245196',
    fontSize: 13,
    lineHeight: 21
  },
  notice: {
    color: '#7A8799',
    fontSize: 12,
    lineHeight: 20
  },
  dim: {
    opacity: 0.5
  }
});
