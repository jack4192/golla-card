import FlowHeading from '../components/FlowHeading';
import PinDotsInput from '../components/PinDotsInput';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
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
  const save = async () => {
    if (readOnly || busy.current || !foreground.current) return;
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
        setMessage(error?.message || '저장하지 못했습니다. 다시 설정해주세요.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const changePin = text => {
    if (readOnly || busy.current || !foreground.current) return;
    const value = String(text).replace(/\D/g, '').slice(0, 6);
    setMessage('');

    if (step === 1) {
      setPin(value);
      if (value.length === 6) setStep(2);
      return;
    }

    if (value.length < 6) {
      setConfirmation(value);
    } else if (value === pin) {
      void save();
    } else {
      // 1단계에서 오타가 났을 수 있으므로 처음부터 다시 설정합니다.
      clear();
      setMessage('비밀번호가 일치하지 않아요. 처음부터 다시 설정해주세요.');
    }
  };
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <TouchableOpacity disabled={saving || readOnly} style={styles.back} onPress={back}>
        <Text style={styles.link}>← 뒤로가기</Text>
      </TouchableOpacity>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        <FlowHeading brand icon={configured ? 'shield-checkmark-outline' : 'lock-closed-outline'}>
          {configured ? '간편비밀번호 설정 완료' : step === 1 ? '간편비밀번호 설정' : '간편비밀번호 확인'}
        </FlowHeading>

        {!configured && <Text style={styles.caption}>단계 {step} / 2</Text>}

        <Text style={styles.description}>
          {configured ? '등록된 간편비밀번호를 유지하고 일과 등록 단계로 이동합니다.' : step === 1 ? 'SOL·Pay에서 사용할 숫자 6자리를 입력해주세요.' : '같은 6자리를 한 번 더 입력하면 일과 등록으로 넘어가요.'}
        </Text>

        {configured ? <Text style={[styles.link, styles.configured]}>✓ 간편비밀번호 등록됨</Text> : (
          <PinDotsInput
            value={step === 1 ? pin : confirmation}
            onChangeText={changePin}
            autoFocus={!readOnly}
            editable={!saving && !readOnly}
            accessibilityLabel={step === 1 ? '새 간편비밀번호' : '간편비밀번호 확인'}
          />
        )}

        {saving && !configured && <ActivityIndicator color="#245DE5" accessibilityLabel="간편비밀번호 저장 중" />}

        {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">
            {message}
          </Text>}
      </ScrollView>

      {configured && <TouchableOpacity accessibilityRole="button" disabled={saving || readOnly} style={[styles.button, (saving || readOnly) && styles.disabled]} onPress={save}>
        {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>일과 등록으로 계속</Text>}
      </TouchableOpacity>}
    </KeyboardAvoidingView>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: 30,
    backgroundColor: "#F4F7FF"
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
    flexGrow: 1,
    paddingTop: 4,
    paddingBottom: 16,
    justifyContent: 'flex-start',
    gap: 20,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center"
  },
  caption: {
    textAlign: "center",
    color: "#5A6E89",
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 21
  },
  description: {
    textAlign: "center",
    fontSize: 14,
    lineHeight: 24,
    color: "#5A6E89"
  },
  configured: { textAlign: 'center' },
  message: {
    color: '#B24141',
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center'
  },
  button: {
    marginTop: 12,
    backgroundColor: "#104FE7",
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
