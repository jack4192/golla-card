import FlowHeading from '../components/FlowHeading';
import PinDotsInput from '../components/PinDotsInput';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView, SafeAreaView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { Alert } from '../utils/demoAlert';
export default function PinLoginScreen({
  onVerify,
  onUsePassword
}) {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const input = useRef(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);
  useEffect(() => {
    mounted.current = true;
    foreground.current = !AppState.currentState || AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') {
        setPin('');
        Keyboard.dismiss();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);
  const change = async text => {
    if (busy.current || !foreground.current) return;
    const next = String(text).replace(/\D/g, '').slice(0, 6);
    setPin(next);
    if (next.length !== 6) return;
    busy.current = true;
    setChecking(true);
    Keyboard.dismiss();
    let failed = false;
    try {
      if (typeof onVerify !== 'function') {
        throw Error('인증 연결을 확인해주세요.');
      }
      await onVerify(next);
    } catch (error) {
      failed = true;
      if (mounted.current && foreground.current) {
        Alert.alert('간편비밀번호 확인', error?.message || '다시 시도해주세요.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setChecking(false);
        setPin('');
        if (failed && foreground.current) {
          input.current?.focus();
        }
      }
    }
  };
  return <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.layout} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.center}>
          <FlowHeading brand icon="shield-checkmark-outline">간편비밀번호 입력</FlowHeading>
        <Text style={styles.hint}>
          이전에 설정한 6자리 숫자를 입력해주세요.
        </Text>

        <PinDotsInput ref={input} value={pin} onChangeText={change} autoFocus editable={!checking} accessibilityLabel="6자리 간편비밀번호" />

        {checking && <ActivityIndicator color="#245DE5" />}

        </ScrollView>

        <TouchableOpacity accessibilityRole="button" disabled={checking} style={styles.other} onPress={() => {
      if (busy.current) return;
      setPin('');
      Keyboard.dismiss();
      onUsePassword?.();
    }}>
        <Text style={styles.link}>
          이메일·비밀번호로 로그인하기
        </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FF"
  },
  layout: {flex: 1},
  center: {
    flexGrow: 1,
    paddingTop: 28,
    paddingBottom: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 20,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center"
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    color: "#5A6E89"
  },
  other: {
    alignItems: 'center',
    paddingVertical: 18,
    marginBottom: 25,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center"
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  }
});
