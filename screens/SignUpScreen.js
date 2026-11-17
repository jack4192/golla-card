import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// 현재 앱 실행 중 완료된 체험 가입만 기억합니다.
// 실제 서버의 전체 회원 정보를 조회하는 기능은 아닙니다.
const registeredPhones = new Set();
const registeredEmails = new Set();

export const phoneDigits = value =>
  String(value || '').replace(/\D/g, '').slice(0, 11);

export function formatPhone(value) {
  const digits = phoneDigits(value);

  if (digits.length <= 3) return digits;

  if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export const normalizeEmail = value =>
  String(value || '').trim().toLowerCase();

export const isValidPhone = value =>
  /^01\d{9}$/.test(phoneDigits(value));

export const isValidEmail = value =>
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(
    normalizeEmail(value)
  );

export function isValidBirthDate(value) {
  if (!/^\d{8}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6));
  const date = new Date(year, month - 1, day, 12);
  const today = new Date();

  const todayNumber =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();

  return (
    year >= 1000 &&
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    Number(value) <= todayNumber
  );
}

const emptyForm = () => ({
  name: '',
  birthDate: '',
  id: '',
  phone: '',
  email: '',
  password: '',
  confirmation: '',
});

export default function SignUpScreen({
  onBack,
  onComplete,
  isIdTaken = () => false,
}) {
  const [form, setForm] = useState(emptyForm);
  const [checkedId, setCheckedId] = useState('');
  const [checkedPhone, setCheckedPhone] = useState('');
  const [checkedEmail, setCheckedEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);

  useEffect(() => {
    mounted.current = true;
    foreground.current =
      !AppState.currentState ||
      AppState.currentState === 'active';

    const subscription = AppState.addEventListener(
      'change',
      state => {
        foreground.current = state === 'active';

        if (state !== 'active') {
          setForm(previous => ({
            ...previous,
            password: '',
            confirmation: '',
          }));

          Keyboard.dismiss();
        }
      }
    );

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  const change = (key, value) => {
    if (busy.current || !foreground.current) return;

    const next =
      key === 'birthDate'
        ? value.replace(/\D/g, '').slice(0, 8)
        : key === 'phone'
          ? formatPhone(value)
          : value;

    setForm(previous => ({
      ...previous,
      [key]: next,
    }));

    // 입력값이 바뀌면 기존 중복 확인 결과를 무효화합니다.
    if (key === 'id') setCheckedId('');
    if (key === 'phone') setCheckedPhone('');
    if (key === 'email') setCheckedEmail('');

    setMessage('');
  };

  const idError = value =>
    value.length < 4
      ? '아이디를 4자 이상 입력해주세요.'
      : /\s/.test(value)
        ? '아이디에는 공백을 사용할 수 없습니다.'
        : '';

  const run = async action => {
    if (busy.current || !foreground.current) return;

    busy.current = true;
    setPending(true);
    setMessage('');

    try {
      await action();
    } catch (error) {
      if (mounted.current && foreground.current) {
        setMessage(
          error?.message ||
          '처리하지 못했습니다. 다시 시도해주세요.'
        );
      }
    } finally {
      busy.current = false;

      if (mounted.current) {
        setPending(false);
      }
    }
  };

  const checkId = () =>
    run(async () => {
      const value = form.id.trim();
      setCheckedId('');

      if (idError(value)) {
        throw Error(idError(value));
      }

      if (await isIdTaken(value)) {
        throw Error('이미 사용 중인 시연 ID입니다.');
      }

      if (!mounted.current || !foreground.current) return;

      setCheckedId(value);
      setMessage(
        '아이디 확인 완료. 실제 서버 조회는 아닙니다.'
      );
    });

  const checkPhone = () =>
    run(async () => {
      setCheckedPhone('');

      if (!isValidPhone(form.phone)) {
        throw Error(
          '01로 시작하는 전화번호 11자리를 입력해주세요.'
        );
      }

      const value = phoneDigits(form.phone);

      if (registeredPhones.has(value)) {
        throw Error(
          '현재 데모에서 이미 가입에 사용한 전화번호입니다.'
        );
      }

      setCheckedPhone(value);
      setMessage(
        '현재 데모에서 사용 가능한 전화번호입니다.'
      );
    });

  const checkEmail = () =>
    run(async () => {
      setCheckedEmail('');

      if (!isValidEmail(form.email)) {
        throw Error('올바른 이메일 형식을 입력해주세요.');
      }

      const value = normalizeEmail(form.email);

      if (registeredEmails.has(value)) {
        throw Error(
          '현재 데모에서 이미 가입에 사용한 이메일입니다.'
        );
      }

      setCheckedEmail(value);
      setMessage(
        '현재 데모에서 사용 가능한 이메일입니다.'
      );
    });

  const resetForm = () => {
    setForm(emptyForm());
    setCheckedId('');
    setCheckedPhone('');
    setCheckedEmail('');
  };

  const signUp = () =>
    run(async () => {
      const id = form.id.trim();
      const phone = phoneDigits(form.phone);
      const email = normalizeEmail(form.email);

      if (form.name.trim().length < 2) {
        throw Error('이름을 2자 이상 입력해주세요.');
      }

      if (!isValidBirthDate(form.birthDate)) {
        throw Error(
          '올바른 생년월일 8자리를 입력해주세요.'
        );
      }

      if (idError(id)) {
        throw Error(idError(id));
      }

      if (checkedId !== id) {
        throw Error('아이디 확인을 진행해주세요.');
      }

      if (!isValidPhone(form.phone)) {
        throw Error('전화번호 11자리를 입력해주세요.');
      }

      if (checkedPhone !== phone) {
        throw Error(
          '전화번호 중복 확인을 진행해주세요.'
        );
      }

      if (!isValidEmail(email)) {
        throw Error('올바른 이메일 형식을 입력해주세요.');
      }

      if (checkedEmail !== email) {
        throw Error(
          '이메일 중복 확인을 진행해주세요.'
        );
      }

      if (form.password.length < 4) {
        throw Error('비밀번호를 4자 이상 입력해주세요.');
      }

      if (form.password !== form.confirmation) {
        throw Error('비밀번호가 일치하지 않습니다.');
      }

      if (await isIdTaken(id)) {
        setCheckedId('');
        throw Error('이미 사용 중인 시연 ID입니다.');
      }

      if (!mounted.current || !foreground.current) return;

      // 중복 확인 이후 다른 가입이 완료되었을 수 있어
      // 제출 직전에도 다시 확인합니다.
      if (registeredPhones.has(phone)) {
        setCheckedPhone('');

        throw Error(
          '이미 사용한 전화번호입니다. 다시 확인해주세요.'
        );
      }

      if (registeredEmails.has(email)) {
        setCheckedEmail('');

        throw Error(
          '이미 사용한 이메일입니다. 다시 확인해주세요.'
        );
      }

      if (typeof onComplete !== 'function') {
        throw Error(
          '가입 완료 화면 연결을 확인해주세요.'
        );
      }

      registeredPhones.add(phone);
      registeredEmails.add(email);

      const account = {
        id,
        password: form.password,
        name: form.name.trim(),
        birthDate: form.birthDate,
        phone,
        email,
      };

      setForm(previous => ({
        ...previous,
        password: '',
        confirmation: '',
      }));

      Keyboard.dismiss();

      try {
        await onComplete(account);
      } catch (error) {
        // 가입에 실패하면 해당 번호와 이메일을 다시
        // 사용할 수 있도록 예약을 취소합니다.
        registeredPhones.delete(phone);
        registeredEmails.delete(email);

        throw error;
      }

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

  const field = (key, label, props = {}) => (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <TextInput
        style={styles.input}
        value={form[key]}
        onChangeText={value => change(key, value)}
        editable={!pending}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
        {...props}
      />
    </View>
  );

  const checkButton = (
    title,
    checked,
    action,
    disabled = false
  ) => (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={pending || disabled}
      onPress={action}
      style={[
        styles.secondary,
        (pending || disabled) && styles.disabled,
      ]}
    >
      <Text style={styles.link}>
        {checked ? `${title} 완료 ✓` : title}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={
          Platform.OS === 'ios' ? 'padding' : 'height'
        }
      >
        <TouchableOpacity
          accessibilityRole="button"
          disabled={pending}
          style={styles.back}
          onPress={back}
        >
          <Text style={styles.link}>← 뒤로</Text>
        </TouchableOpacity>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          <Text style={styles.title}>회원가입</Text>

          <Text style={styles.hint}>
            발표용 가입 체험입니다. 실제 개인정보 대신
            가상의 정보를 입력해주세요.
          </Text>

          {field('name', '이름', {
            placeholder: '가상의 이름',
            maxLength: 50,
          })}

          {field('birthDate', '생년월일', {
            placeholder: 'YYYYMMDD',
            keyboardType: 'number-pad',
            maxLength: 8,
          })}

          {form.birthDate.length === 8 &&
            !isValidBirthDate(form.birthDate) && (
              <Text style={styles.error}>
                올바른 생년월일을 입력해주세요.
              </Text>
            )}

          {field('id', '아이디', {
            placeholder: '4자 이상 · 공백 제외',
            maxLength: 50,
          })}

          {checkButton(
            '아이디 확인',
            !!checkedId &&
              checkedId === form.id.trim(),
            checkId,
            !form.id.trim()
          )}

          {field('phone', '전화번호', {
            placeholder: '010-1234-5678',
            keyboardType: 'phone-pad',
            maxLength: 13,
          })}

          {checkButton(
            '전화번호 중복 확인',
            !!checkedPhone &&
              checkedPhone === phoneDigits(form.phone),
            checkPhone,
            !form.phone
          )}

          {!!checkedPhone && (
            <Text style={styles.success}>
              ✓ 현재 데모에서 사용 가능한 전화번호입니다.
            </Text>
          )}

          {field('email', '이메일', {
            placeholder: 'demo@example.com',
            keyboardType: 'email-address',
            maxLength: 254,
          })}

          {checkButton(
            '이메일 중복 확인',
            !!checkedEmail &&
              checkedEmail === normalizeEmail(form.email),
            checkEmail,
            !form.email.trim()
          )}

          {!!checkedEmail && (
            <Text style={styles.success}>
              ✓ 현재 데모에서 사용 가능한 이메일입니다.
            </Text>
          )}

          {field('password', '비밀번호', {
            placeholder: '시연용 비밀번호 · 4자 이상',
            secureTextEntry: true,
            maxLength: 128,
          })}

          {field('confirmation', '비밀번호 확인', {
            placeholder: '비밀번호 다시 입력',
            secureTextEntry: true,
            maxLength: 128,
          })}

          {!!form.confirmation && (
            <Text
              style={
                form.password === form.confirmation
                  ? styles.success
                  : styles.error
              }
            >
              {form.password === form.confirmation
                ? '✓ 비밀번호가 일치합니다.'
                : '비밀번호가 일치하지 않습니다.'}
            </Text>
          )}

          <Text style={styles.hint}>
            중복 확인은 현재 앱 실행 중 완료된 체험 가입만
            비교합니다. 앱을 다시 실행하거나 웹을
            새로고침하면 확인 기록은 초기화됩니다.
            실제 서비스 전체의 중복 확인 및 휴대폰
            본인 인증은 서버 연결 후 가능합니다.
          </Text>

          {!!message && (
            <Text
              style={styles.message}
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          )}
        </ScrollView>

        <TouchableOpacity
          accessibilityRole="button"
          disabled={pending}
          style={[
            styles.button,
            pending && styles.disabled,
          ]}
          onPress={signUp}
        >
          {pending ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.white}>회원가입</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFF',
  },
  flex: {
    flex: 1,
  },
  back: {
    padding: 20,
  },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    gap: 14,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1A1A1A',
  },
  hint: {
    fontSize: 12,
    lineHeight: 21,
    color: '#767676',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#243D61',
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  secondary: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#EAF1FF',
    alignItems: 'center',
  },
  link: {
    color: '#2457AB',
    fontSize: 14,
    fontWeight: '700',
  },
  error: {
    color: '#C54141',
    fontSize: 12,
    lineHeight: 20,
  },
  success: {
    color: '#087D54',
    fontSize: 12,
    lineHeight: 20,
  },
  message: {
    color: '#9C4D20',
    fontSize: 13,
    lineHeight: 21,
  },
  button: {
    margin: 24,
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#245DE5',
    alignItems: 'center',
  },
  white: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.6,
  },
});