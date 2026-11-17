import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

export default function PinSetupScreen({
  onNext,
  onBack,
  configured = false,
  onContinue,
  readOnly = false,
}) {
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);

  const clear = () => {
    setPin('');
    setConfirmation('');
    setStep(1);
  };

  useEffect(() => {
    mounted.current = true;
    foreground.current =
      !AppState.currentState || AppState.currentState === 'active';

    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';

      if (state !== 'active') {
        clear();
        Keyboard.dismiss();
        setMessage('입력 보호를 위해 초기화했습니다. 다시 설정해주세요.');
      }
    });

    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (configured) {
      clear();
      setMessage('');
    }
  }, [configured]);

  const back = () => {
    if (readOnly || busy.current) return;

    clear();
    setMessage('');
    Keyboard.dismiss();

    if (configured || step === 1) onBack?.();
  };

  const next = async () => {
    if (readOnly || busy.current || !foreground.current) return;

    if (!configured && step === 1) {
      if (!/^\d{6}$/.test(pin)) {
        setMessage('6자리 숫자를 입력해주세요.');
        return;
      }

      setConfirmation('');
      setStep(2);
      setMessage('');
      return;
    }

    if (!configured) {
      if (!/^\d{6}$/.test(confirmation)) {
        setMessage('6자리 숫자를 다시 입력해주세요.');
        return;
      }

      if (pin !== confirmation) {
        setConfirmation('');
        setMessage('비밀번호가 일치하지 않습니다.');
        return;
      }
    }

    const value = pin;
    busy.current = true;
    setSaving(true);
    setMessage('');
    clear();
    Keyboard.dismiss();

    try {
      const callback = configured ? onContinue : onNext;

      if (typeof callback !== 'function') {
        throw Error('다음 단계 연결을 확인해주세요.');
      }

      if (configured) await callback();
      else await callback(value);
    } catch (error) {
      if (mounted.current && foreground.current) {
        setMessage(
          error?.message || '저장하지 못했습니다. 다시 설정해주세요.'
        );
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <TouchableOpacity
        disabled={saving || readOnly}
        style={styles.back}
        onPress={back}
      >
        <Text style={styles.link}>← 뒤로가기</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.caption}>SOL Pay · 간편 로그인</Text>

        <Text style={styles.title}>
          {configured
            ? '간편비밀번호 설정 완료'
            : step === 1
              ? '간편비밀번호를 설정해주세요 🔐'
              : '비밀번호를 한 번 더 입력해주세요'}
        </Text>

        <Text style={styles.description}>
          {configured
            ? '등록된 간편비밀번호를 유지하고 일과 등록 단계로 이동합니다.'
            : '시연용 6자리 숫자를 입력해주세요. 실제 은행 비밀번호는 입력하지 마세요.'}
        </Text>

        <View style={styles.card}>
          {configured ? (
            <Text style={styles.link}>✓ 간편비밀번호 등록됨</Text>
          ) : (
            <>
              <Text style={styles.label}>
                {step === 1 ? '간편비밀번호' : '비밀번호 확인'}
              </Text>

              <TextInput
                key={step}
                style={styles.input}
                value={step === 1 ? pin : confirmation}
                onChangeText={text => {
                  if (
                    readOnly ||
                    busy.current ||
                    !foreground.current
                  ) return;

                  const value = String(text)
                    .replace(/\D/g, '')
                    .slice(0, 6);

                  if (step === 1) setPin(value);
                  else setConfirmation(value);

                  setMessage('');
                }}
                placeholder="● ● ● ● ● ●"
                keyboardType="number-pad"
                secureTextEntry
                maxLength={6}
                autoFocus={!readOnly}
                autoCorrect={false}
                editable={!saving && !readOnly}
                accessibilityLabel={
                  step === 1
                    ? '새 간편비밀번호'
                    : '간편비밀번호 확인'
                }
              />
            </>
          )}
        </View>

        {!!message && (
          <Text
            style={styles.message}
            accessibilityLiveRegion="polite"
          >
            {message}
          </Text>
        )}
      </View>

      <TouchableOpacity
        disabled={saving || readOnly}
        style={[
          styles.button,
          (saving || readOnly) && styles.disabled,
        ]}
        onPress={next}
      >
        {saving ? (
          <ActivityIndicator color="#FFF" />
        ) : (
          <Text style={styles.white}>
            {configured
              ? '일과 등록으로 계속'
              : step === 1
                ? '다음'
                : '설정 완료 · 일과 등록하기'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 30,
    backgroundColor: '#FFF',
  },
  back: { marginTop: 35, paddingVertical: 12 },
  body: { flex: 1, justifyContent: 'center', gap: 18 },
  caption: { color: '#245DE5', fontSize: 12, fontWeight: '800' },
  title: {
    fontSize: 27,
    lineHeight: 38,
    fontWeight: '900',
    color: '#172B50',
  },
  description: { fontSize: 14, lineHeight: 23, color: '#768299' },
  card: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#F5F8FE',
    gap: 14,
  },
  label: { color: '#263C61', fontSize: 14, fontWeight: '800' },
  input: {
    height: 58,
    borderWidth: 1,
    borderColor: '#CEDBF2',
    borderRadius: 12,
    backgroundColor: '#FFF',
    color: '#183D78',
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
  },
  message: {
    color: '#B24141',
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#245DE5',
    paddingVertical: 17,
    alignItems: 'center',
    borderRadius: 13,
  },
  white: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  link: { color: '#315C9D', fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.6 },
});