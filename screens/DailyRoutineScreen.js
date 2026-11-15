
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as SecureStore from '../utils/demoStore';

const STORAGE_KEY = 'solpay_routine_profile_v1';
const WEB_PREFIX = 'solpay_demo_';

const QUESTIONS = [
  {
    key: 'occupation',
    title: '어떤 일을 하고 계신가요?',
    options: [
      ['worker', '💼 직장인'],
      ['student', '🎓 학생'],
      ['freelancer', '💻 프리랜서'],
      ['other', '🏡 기타'],
    ],
  },
  {
    key: 'lunchPlace',
    title: '평소 점심은 어디서 드시나요?',
    options: [
      ['cafeteria', '회사·학교 식당'],
      ['restaurant', '근처 음식점'],
      ['convenience', '편의점'],
      ['lunchbox', '도시락'],
      ['home', '집'],
      ['skip', '식사를 거르는 편'],
    ],
  },
  {
    key: 'coffee',
    title: '점심 식사 후 커피를 마시시나요?',
    options: [
      ['always', '거의 매일'],
      ['sometimes', '가끔'],
      ['never', '거의 마시지 않음'],
    ],
  },
  {
    key: 'evening',
    title: '일과가 끝나면 무엇을 하시나요?',
    options: [
      ['home', '바로 집에 가요'],
      ['dinner', '식사하고 집에 가요'],
      ['cafe', '카페·취미 활동'],
      ['study', '공부·운동'],
      ['variable', '매일 달라요'],
    ],
  },
];

const EMPTY_PROFILE = {
  occupation: '',
  lunchPlace: '',
  coffee: '',
  evening: '',
};

async function readProfile() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(
      WEB_PREFIX + STORAGE_KEY
    );
  }
  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function saveProfile(data) {
  const raw = JSON.stringify(data);

  if (Platform.OS === 'web') {
    window.localStorage.setItem(
      WEB_PREFIX + STORAGE_KEY,
      raw
    );
    return;
  }

  await SecureStore.setItemAsync(STORAGE_KEY, raw);
}

async function deleteProfile() {
  if (Platform.OS === 'web') {
    window.localStorage.removeItem(
      WEB_PREFIX + STORAGE_KEY
    );
    return;
  }

  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export default function DailyRoutineScreen({
  onContinue,
  onBack,
}) {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;

    async function restore() {
      try {
        const raw = await readProfile();

        if (raw && active) {
          const data = JSON.parse(raw);

          setProfile({
            ...EMPTY_PROFILE,
            ...data,
          });
          setSaved(true);
        }
      } catch (error) {
        if (active) {
          setMessage('이전 기록을 불러오지 못했습니다.');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    restore();

    return () => {
      active = false;
    };
  }, []);

  const changeAnswer = (key, value) => {
    setProfile((prev) => ({
      ...prev,
      [key]: value,
    }));
    setSaved(false);
    setMessage('');
  };

  const handleSave = async (goNext) => {
    if (saving) return;

    const incomplete = QUESTIONS.some(
      (question) => !profile[question.key]
    );

    if (incomplete) {
      setMessage('4가지 질문에 모두 답변해주세요.');
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const record = {
        ...profile,
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      await saveProfile(record);
      setSaved(true);

      if (goNext) {
        await onContinue?.();
      } else {
        setMessage('평소 일과가 저장됐습니다.');
      }
    } catch (error) {
      setMessage('저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);

    try {
      await deleteProfile();
      setProfile({ ...EMPTY_PROFILE });
      setSaved(false);
      setMessage('평소 일과 기록을 삭제했습니다.');
    } catch {
      setMessage('기록을 삭제하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator
          size="large"
          color="#245DE5"
        />
        <Text style={styles.subText}>
          일과 기록을 불러오는 중...
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <Text style={styles.step}>
          SOL Pay · 생활 패턴 분석
        </Text>

        <Text style={styles.title}>
          평소 하루는 어떠신가요? ☀️
        </Text>

        <Text style={styles.description}>
          평소 생활 습관을 알려주시면
          향후 생활 패턴에 맞는 카드 혜택을
          안내하는 데 활용할 수 있어요.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          나의 평소 일과
        </Text>

        {QUESTIONS.map((question, index) => (
          <View
            key={question.key}
            style={styles.question}
          >
            <Text style={styles.questionNumber}>
              QUESTION {index + 1}
            </Text>

            <Text style={styles.questionTitle}>
              {question.key === 'evening' &&
              profile.occupation === 'student'
                ? '수업이 끝나면 무엇을 하시나요?'
                : question.title}
            </Text>

            <View style={styles.optionWrap}>
              {question.options.map(([value, label]) => {
                const selected =
                  profile[question.key] === value;

                return (
                  <TouchableOpacity
                    key={value}
                    style={[
                      styles.option,
                      selected && styles.selectedOption,
                    ]}
                    onPress={() =>
                      changeAnswer(question.key, value)
                    }
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.selectedText,
                      ]}
                    >
                      {selected ? '✓ ' : ''}
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {saved && (
          <Text style={styles.savedMessage}>
            ✓ 저장된 일과를 불러왔습니다.
          </Text>
        )}
      </View>

      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>
          🗓️ 특별 일정은 메인에서 관리해요
        </Text>

        <Text style={styles.noticeText}>
          병원 예약, 야근, 반차, 휴무, 약속,
          회식처럼 평소와 다른 일정은
          SOL페이 메인 화면에서 기록할 수 있습니다.
        </Text>
      </View>

      {!!message && (
        <Text style={styles.message}>
          {message}
        </Text>
      )}

      <TouchableOpacity
        style={[
          styles.primaryButton,
          saving && styles.disabled,
        ]}
        onPress={() => handleSave(true)}
        disabled={saving}
      >
        <Text style={styles.primaryText}>
          {saving
            ? '저장 중...'
            : '일과 저장하고 다음으로'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => handleSave(false)}
        disabled={saving}
      >
        <Text style={styles.secondaryText}>
          기록만 저장하기
        </Text>
      </TouchableOpacity>

      {onBack && (
        <TouchableOpacity
          style={styles.linkButton}
          onPress={onBack}
          disabled={saving}
        >
          <Text style={styles.linkText}>
            이전 화면으로
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => onContinue?.()}
        disabled={saving}
      >
        <Text style={styles.linkText}>
          나중에 입력하기
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.deleteButton}
        onPress={handleDelete}
        disabled={saving}
      >
        <Text style={styles.deleteText}>
          저장된 평소 일과 삭제
        </Text>
      </TouchableOpacity>

      <Text style={styles.privacy}>
        현재 일과 정보는 이 기기에만 저장되는
        데모 데이터입니다. 실제 카드 추천 엔진과는
        아직 연결되지 않았습니다.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F8FE',
  },
  content: {
    padding: 18,
    paddingBottom: 50,
    maxWidth: 640,
    width: '100%',
    alignSelf: 'center',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    padding: 12,
    paddingTop: 22,
    marginBottom: 15,
  },
  step: {
    color: '#2861DD',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 10,
  },
  title: {
    color: '#152B52',
    fontSize: 26,
    fontWeight: '900',
    marginBottom: 12,
  },
  description: {
    color: '#68778E',
    fontSize: 13,
    lineHeight: 21,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 19,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#E7EDF6',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#203B70',
    marginBottom: 17,
  },
  question: {
    marginBottom: 25,
  },
  questionNumber: {
    color: '#2861DD',
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 8,
  },
  questionTitle: {
    color: '#223552',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 12,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DCE4F1',
    borderWidth: 1,
    borderRadius: 11,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  selectedOption: {
    borderColor: '#2860DF',
    backgroundColor: '#EAF1FF',
  },
  optionText: {
    color: '#617087',
    fontSize: 12,
    fontWeight: '700',
  },
  selectedText: {
    color: '#2458D1',
    fontWeight: '900',
  },
  savedMessage: {
    color: '#247544',
    fontSize: 12,
    fontWeight: '700',
  },
  notice: {
    backgroundColor: '#EAF1FD',
    borderRadius: 14,
    padding: 16,
    marginBottom: 18,
  },
  noticeTitle: {
    color: '#255C9B',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 8,
  },
  noticeText: {
    color: '#657B9C',
    fontSize: 12,
    lineHeight: 20,
  },
  message: {
    color: '#B05D45',
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#245DE5',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderColor: '#D8E3F2',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryText: {
    color: '#4167A3',
    fontSize: 13,
    fontWeight: '800',
  },
  linkButton: {
    alignItems: 'center',
    padding: 14,
  },
  linkText: {
    color: '#8190A6',
    fontSize: 12,
  },
  deleteButton: {
    alignItems: 'center',
    padding: 12,
    marginTop: 5,
  },
  deleteText: {
    color: '#B16D6D',
    fontSize: 11,
  },
  privacy: {
    marginTop: 12,
    color: '#8894A6',
    fontSize: 11,
    lineHeight: 18,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
});
