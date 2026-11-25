import { isValidEmail, normalizeEmail } from '../utils/demoEmail';
import FlowHeading from '../components/FlowHeading';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ScreenSafeArea from '../components/ScreenSafeArea';

export const phoneDigits = value => String(value || '').replace(/\D/g, '').slice(0, 11);
export function formatPhone(value) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}
export const isValidPhone = value => /^01\d{9}$/.test(phoneDigits(value));
export const isValidSignUpPassword = value =>
  typeof value === 'string' && [...value].length >= 8 &&
  /[a-z]/i.test(value) && /[0-9]/.test(value) && /[\p{P}\p{S}]/u.test(value);

const passwordHint = '영문·숫자·특수문자를 모두 포함해 8자 이상 입력해주세요.';
const contactFields = {
  email: {
    label: '이메일',
    normalize: normalizeEmail,
    isValid: isValidEmail,
    formatError: '올바른 이메일 형식을 입력해주세요.',
  },
  phone: {
    label: '전화번호',
    normalize: phoneDigits,
    isValid: isValidPhone,
    formatError: '01로 시작하는 전화번호 11자리를 입력해주세요.',
  },
};

export function isValidBirthDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6));
  const date = new Date(year, month - 1, day, 12);
  const today = new Date();
  const todayNumber = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return year >= 1000 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && Number(value) <= todayNumber;
}
// 직장(직업) 선택지. occupation은 일과 질문('어떤 일을 하고 계신가요?')의 답으로 자동 연결됩니다.
export const JOB_OPTIONS = [
  { value: 'office', label: '회사원', occupation: 'worker' },
  { value: 'student', label: '학생', occupation: 'student' },
  { value: 'homemaker', label: '주부', occupation: 'other' },
  { value: 'freelancer', label: '프리랜서', occupation: 'freelancer' },
  { value: 'self_employed', label: '자영업', occupation: 'freelancer' },
  { value: 'unemployed', label: '무직', occupation: 'other' },
  { value: 'other', label: '직접입력', occupation: 'other' },
];
export const JOB_OTHER_LIMIT = 20;
export const jobLabel = (job, jobOther) => job === 'other'
  ? (String(jobOther || '').trim() || '직접입력')
  : JOB_OPTIONS.find(option => option.value === job)?.label || '';

const emptyForm = () => ({
  name: '',
  birthDate: '',
  job: '',
  jobOther: '',
  phone: '',
  email: '',
  password: '',
  confirmation: ''
});
export default function SignUpScreen({
  onBack,
  onComplete,
  isEmailTaken = () => false,
  isPhoneTaken = () => false
}) {
  const [form, setForm] = useState(emptyForm);
  const [contactChecks, setContactChecks] = useState({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [englishHint, setEnglishHint] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);
  useEffect(() => {
    mounted.current = true;
    foreground.current = !AppState.currentState || AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') {
        setForm(previous => ({
          ...previous,
          password: '',
          confirmation: ''
        }));
        Keyboard.dismiss();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);
  const change = (key, value) => {
    if (busy.current || !foreground.current) return;
    const next = key === 'birthDate' ? value.replace(/\D/g, '').slice(0, 8) : key === 'phone' ? formatPhone(value) : key === 'email' ? value.replace(/[^A-Za-z0-9@._%+\-]/g, '') : value;
    if (key === 'email') setEnglishHint(next !== value);
    setForm(previous => ({
      ...previous,
      [key]: next
    }));

    // 입력값이 바뀌면 기존 중복 확인 결과를 무효화합니다.
    if (key === 'phone' || key === 'email') {
      setContactChecks(previous => ({ ...previous, [key]: undefined }));
    }
    setMessage('');
  };
  const run = async action => {
    if (busy.current || !foreground.current) return;
    busy.current = true;
    setPending(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      if (mounted.current && foreground.current) {
        setMessage(error?.message || '처리하지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending(false);
      }
    }
  };
  const setContactResult = (key, text, confirmedValue = '') => {
    if (!mounted.current || !foreground.current) return;
    setContactChecks(previous => ({ ...previous, [key]: { text, confirmedValue } }));
  };
  const showDuplicate = key => setContactResult(key, '이미 등록된 ' + contactFields[key].label + '입니다.');
  const checkContact = (key, isTaken) => run(async () => {
    const { label, normalize, isValid, formatError } = contactFields[key];
    if (!isValid(form[key])) {
      setContactResult(key, formatError);
      return;
    }
    const value = normalize(form[key]);
    try {
      if (await isTaken(value)) {
        showDuplicate(key);
      } else {
        setContactResult(key, '사용 가능한 ' + label + '입니다.', value);
      }
    } catch {
      setContactResult(key, '중복 확인을 완료하지 못했어요. 다시 시도해주세요.');
    }
  });
  const resetForm = () => {
    setForm(emptyForm());
    setContactChecks({});
    setJobOpen(false);
  };
  const chooseJob = value => {
    if (busy.current || !foreground.current) return;
    setForm(previous => ({ ...previous, job: value, jobOther: value === 'other' ? previous.jobOther : '' }));
    setJobOpen(false);
    setMessage('');
  };
  const signUp = () => run(async () => {
    const phone = phoneDigits(form.phone);
    const email = normalizeEmail(form.email);
    if (form.name.trim().length < 2) {
      throw Error('이름을 2자 이상 입력해주세요.');
    }
    if (!isValidBirthDate(form.birthDate)) {
      throw Error('올바른 생년월일 8자리를 입력해주세요.');
    }
    if (!isValidEmail(email)) {
      setContactResult('email', contactFields.email.formatError);
      return;
    }
    if (contactChecks.email?.confirmedValue !== email) {
      if (!contactChecks.email) setContactResult('email', '이메일 중복 확인을 진행해주세요.');
      return;
    }
    if (!JOB_OPTIONS.some(option => option.value === form.job)) {
      setJobOpen(true);
      throw Error('직장을 선택해주세요.');
    }
    if (form.job === 'other' && !form.jobOther.trim()) {
      throw Error('직장을 직접 입력해주세요.');
    }
    if (!isValidPhone(form.phone)) {
      setContactResult('phone', contactFields.phone.formatError);
      return;
    }
    if (contactChecks.phone?.confirmedValue !== phone) {
      if (!contactChecks.phone) setContactResult('phone', '전화번호 중복 확인을 진행해주세요.');
      return;
    }
    if (!isValidSignUpPassword(form.password)) {
      throw Error(passwordHint);
    }
    if (form.password !== form.confirmation) {
      throw Error('비밀번호가 일치하지 않습니다.');
    }
    // 중복 확인 이후 다른 가입이 완료되었을 수 있어
    // 제출 직전에도 다시 확인합니다.
    const [unavailableEmail, unavailablePhone] = await Promise.all([isEmailTaken(email), isPhoneTaken(phone)]);
    if (!mounted.current || !foreground.current) return;
    if (unavailableEmail || unavailablePhone) {
      if (unavailableEmail) showDuplicate('email');
      if (unavailablePhone) showDuplicate('phone');
      return;
    }
    if (typeof onComplete !== 'function') {
      throw Error('가입 완료 화면 연결을 확인해주세요.');
    }
    const account = {
      password: form.password,
      name: form.name.trim(),
      birthDate: form.birthDate,
      job: form.job,
      jobOther: form.job === 'other' ? form.jobOther.trim().slice(0, JOB_OTHER_LIMIT) : '',
      phone,
      email
    };
    setForm(previous => ({
      ...previous,
      password: '',
      confirmation: ''
    }));
    Keyboard.dismiss();
    await onComplete(account);
    if (mounted.current) {
      resetForm();
      if (foreground.current) {
        setMessage('체험 가입이 완료되었습니다.');
      }
    }
  });
  const back = () => {
    if (busy.current) return;
    resetForm();
    setMessage('');
    Keyboard.dismiss();
    onBack?.();
  };
  const field = (key, label, props, check, hint) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={form[key]}
          onChangeText={value => change(key, value)}
          editable={!pending}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={label}
          placeholderTextColor="#687B97"
          {...props}
        />
        {check}
      </View>
      {contactChecks[key] && (
        <Text style={contactChecks[key].confirmedValue ? styles.success : styles.error} accessibilityLiveRegion="polite">
          {contactChecks[key].text}
        </Text>
      )}
      {!!hint && (typeof hint === 'string' ? <Text style={styles.fieldHint}>{hint}</Text> : hint)}
    </View>
  );
  const checkButton = (title, checked, action, disabled) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={checked ? title + ' 완료' : title}
      disabled={pending || disabled}
      onPress={action}
      style={[styles.secondary, checked && styles.checked, (pending || disabled) && styles.disabled]}
    >
      <Text style={checked ? styles.checkedText : styles.link}>
        {checked ? '확인 완료 ✓' : '중복 확인'}
      </Text>
    </TouchableOpacity>
  );
  return <ScreenSafeArea style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity accessibilityRole="button" disabled={pending} style={styles.back} onPress={back}>
          <Text style={styles.link}>← 뒤로</Text>
        </TouchableOpacity>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <FlowHeading brand icon="person-add-outline">회원가입</FlowHeading>

          <Text style={styles.hint}>
            가입 정보를 입력하고 이메일과 전화번호를 확인해주세요.
          </Text>

          {field('name', '이름', {
          placeholder: '이름 입력',
          maxLength: 50
        })}

          {field('birthDate', '생년월일', {
          placeholder: 'YYYYMMDD',
          keyboardType: 'number-pad',
          maxLength: 8
        })}

          {form.birthDate.length === 8 && !isValidBirthDate(form.birthDate) && <Text style={styles.error}>
                올바른 생년월일을 입력해주세요.
              </Text>}

          {field('email', '이메일', {
            placeholder: 'name@example.com',
            keyboardType: 'email-address',
            textContentType: 'emailAddress',
            maxLength: 254
          }, checkButton('이메일 중복 확인', !!contactChecks.email?.confirmedValue, () => checkContact('email', isEmailTaken), !form.email.trim()), <>
            {englishHint && <Text style={styles.englishHint} accessibilityLiveRegion="polite">영어로 입력해주세요</Text>}
            <Text style={styles.fieldHint}>가입 후 이 이메일로 로그인해요.</Text>
          </>)}

          <View style={styles.field}>
            <Text style={styles.label}>직장</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="직장 선택"
              accessibilityState={{ expanded: jobOpen }} disabled={pending}
              onPress={() => setJobOpen(open => !open)} style={[styles.input, styles.select, jobOpen && styles.selectOpen]}>
              <Text style={form.job ? styles.selectValue : styles.selectPlaceholder}>
                {form.job ? JOB_OPTIONS.find(option => option.value === form.job)?.label : '직장을 선택해주세요'}
              </Text>
              <Text style={styles.selectArrow}>{jobOpen ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {jobOpen && <View style={styles.options} accessibilityRole="radiogroup">
              {JOB_OPTIONS.map(option => {
                const selected = form.job === option.value;
                return <TouchableOpacity key={option.value} accessibilityRole="radio" accessibilityState={{ selected }}
                  onPress={() => chooseJob(option.value)} style={[styles.option, selected && styles.optionSelected]}>
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                </TouchableOpacity>;
              })}
            </View>}
            {form.job === 'other' && <TextInput style={styles.input} value={form.jobOther} editable={!pending}
              onChangeText={value => change('jobOther', value.slice(0, JOB_OTHER_LIMIT))} maxLength={JOB_OTHER_LIMIT}
              accessibilityLabel="직장 직접 입력" placeholder="직장을 직접 입력해주세요 · 예: 공무원, 군인" placeholderTextColor="#687B97" />}
          </View>

          {field('phone', '전화번호', {
            placeholder: '010-1234-5678',
            keyboardType: 'phone-pad',
            maxLength: 13
          }, checkButton('전화번호 중복 확인', !!contactChecks.phone?.confirmedValue, () => checkContact('phone', isPhoneTaken), !form.phone))}

          {field('password', '비밀번호', {
          placeholder: '비밀번호 · 8자 이상',
          secureTextEntry: true,
          maxLength: 128
        }, null, form.password && isValidSignUpPassword(form.password)
          // 조건을 만족하면 초록 안내, 아니면 기존 조건 안내
          ? <Text style={styles.success} accessibilityLiveRegion="polite">✓ 사용 가능한 비밀번호입니다.</Text>
          : passwordHint)}

          {field('confirmation', '비밀번호 확인', {
          placeholder: '비밀번호 다시 입력',
          secureTextEntry: true,
          maxLength: 128
        })}

          {!!form.confirmation && <Text style={form.password === form.confirmation ? styles.success : styles.error}>
              {form.password === form.confirmation ? '✓ 비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.'}
            </Text>}

          <Text style={styles.hint}>
            이메일과 전화번호는 이 기기의 가입 기록에서 중복을 확인해요. 휴대폰 본인 확인은 제공되지 않아요.
          </Text>

        </ScrollView>

        {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">{message}</Text>}

        <TouchableOpacity accessibilityRole="button" disabled={pending} style={[styles.button, pending && styles.disabled]} onPress={signUp}>
          {pending ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>회원가입</Text>}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </ScreenSafeArea>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FF"
  },
  flex: {
    flex: 1
  },
  back: {
    paddingVertical: 12,
    minHeight: 44,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    paddingHorizontal: 22
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 18,
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    padding: 22,
    paddingTop: 8
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: "#5A6E89"
  },
  field: {
    gap: 8
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#243D61'
  },
  inputRow: {flexDirection: 'row', gap: 8},
  select: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  selectOpen: {borderColor: '#104FE7'},
  selectValue: {fontSize: 16, color: '#142D4E'},
  selectPlaceholder: {fontSize: 16, color: '#687B97'},
  selectArrow: {fontSize: 12, color: '#5A6E89'},
  options: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  option: {paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E3EAF4'},
  optionSelected: {backgroundColor: '#104FE7', borderColor: '#104FE7'},
  optionText: {fontSize: 14, fontWeight: '600', color: '#243D61'},
  optionTextSelected: {color: '#FFFFFF'},
  fieldHint: {fontSize: 12, lineHeight: 18, color: '#5A6E89'},
  englishHint: {fontSize: 12, lineHeight: 18, color: '#C53D56'},
  input: {
    flex: 1,
    minWidth: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 15,
    fontSize: 16,
    color: "#142D4E",
    borderWidth: 1,
    borderColor: "#E3EAF4",
    minHeight: 52
  },
  secondary: {
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "#DFEAFF",
    alignItems: "center",
    minHeight: 46,
    justifyContent: "center"
  },
  checked: {backgroundColor: '#E1F5EC'},
  checkedText: {color: '#08704B', fontSize: 13, fontWeight: '700'},
  link: {
    color: "#104FE7",
    fontSize: 13,
    fontWeight: "700"
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    lineHeight: 22
  },
  success: {
    color: '#087D54',
    fontSize: 12,
    lineHeight: 20
  },
  message: {
    alignSelf: 'center',
    width: '90%',
    maxWidth: 552,
    color: '#744321',
    fontSize: 13,
    lineHeight: 21
  },
  button: {
    margin: 0,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: "#104FE7",
    alignItems: "center",
    minHeight: 54,
    padding: 16,
    justifyContent: "center",
    width: "90%",
    maxWidth: 552,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 20
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  disabled: {
    opacity: 0.6
  }
});
