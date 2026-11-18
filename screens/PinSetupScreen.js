import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
export default function PinSetupScreen({
  onNext,
  onBack,
  configured = false,
  onContinue,
  readOnly = false
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
    foreground.current = !AppState.currentState || AppState.currentState === 'active';
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
      if (configured) await callback();else await callback(value);
    } catch (error) {
      if (mounted.current && foreground.current) {
        setMessage(error?.message || '저장하지 못했습니다. 다시 설정해주세요.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <View style={styles.screen}>
      <TouchableOpacity disabled={saving || readOnly} style={styles.back} onPress={back}>
        <Text style={styles.link}>← 뒤로가기</Text>
      </TouchableOpacity>

      <View style={styles.body}>
        <Text style={styles.caption}>SOL Pay · 간편 로그인</Text>

        <Text style={styles.title}>
          {configured ? '간편비밀번호 설정 완료' : step === 1 ? '간편비밀번호를 설정해주세요 🔐' : '비밀번호를 한 번 더 입력해주세요'}
        </Text>

        <Text style={styles.description}>
          {configured ? '등록된 간편비밀번호를 유지하고 일과 등록 단계로 이동합니다.' : '시연용 6자리 숫자를 입력해주세요. 실제 은행 비밀번호는 입력하지 마세요.'}
        </Text>

        <View style={styles.card}>
          {configured ? <Text style={styles.link}>✓ 간편비밀번호 등록됨</Text> : <>
              <Text style={styles.label}>
                {step === 1 ? '간편비밀번호' : '비밀번호 확인'}
              </Text>

              <TextInput key={step} style={styles.input} value={step === 1 ? pin : confirmation} onChangeText={text => {
            if (readOnly || busy.current || !foreground.current) return;
            const value = String(text).replace(/\D/g, '').slice(0, 6);
            if (step === 1) setPin(value);else setConfirmation(value);
            setMessage('');
          }} placeholder="● ● ● ● ● ●" keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus={!readOnly} autoCorrect={false} editable={!saving && !readOnly} accessibilityLabel={step === 1 ? '새 간편비밀번호' : '간편비밀번호 확인'} />
            </>}
        </View>

        {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">
            {message}
          </Text>}
      </View>

      <TouchableOpacity disabled={saving || readOnly} style={[styles.button, (saving || readOnly) && styles.disabled]} onPress={next}>
        {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>
            {configured ? '일과 등록으로 계속' : step === 1 ? '다음' : '설정 완료 · 일과 등록하기'}
          </Text>}
      </TouchableOpacity>
    </View>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 30,
    backgroundColor: "#F4F7FB"
  },
  back: {
    marginTop: 16,
    paddingVertical: 12,
    minHeight: 44,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center"
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 20,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center"
  },
  caption: {
    color: "#5A6E89",
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 21
  },
  title: {
    fontSize: 28,
    lineHeight: 39,
    fontWeight: "800",
    color: "#142D4E"
  },
  description: {
    fontSize: 14,
    lineHeight: 24,
    color: "#5A6E89"
  },
  card: {
    padding: 24,
    borderRadius: 22,
    backgroundColor: '#F5F8FE',
    gap: 14,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  label: {
    color: '#263C61',
    fontSize: 14,
    fontWeight: '800'
  },
  input: {
    height: 58,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    color: "#142D4E",
    fontSize: 16,
    letterSpacing: 6,
    textAlign: 'center',
    minHeight: 52,
    padding: 15
  },
  message: {
    color: '#B24141',
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center'
  },
  button: {
    backgroundColor: "#245DE5",
    paddingVertical: 17,
    alignItems: "center",
    borderRadius: 16,
    minHeight: 54,
    padding: 16,
    justifyContent: "center",
    width: "100%",
    maxWidth: 560,
    alignSelf: "center"
  },
  white: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15
  },
  link: {
    color: "#245DE5",
    fontWeight: "700",
    fontSize: 13
  },
  disabled: {
    opacity: 0.6
  }
});
