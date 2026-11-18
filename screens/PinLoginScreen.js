import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
    setPin('');
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
      <Text style={styles.logo}>SOL-Pay</Text>

      <View style={styles.center}>
        <Text style={styles.title}>간편비밀번호 입력</Text>
        <Text style={styles.hint}>
          이전에 설정한 6자리 숫자를 입력해주세요.
        </Text>

        <TouchableOpacity disabled={checking} style={styles.dots} onPress={() => input.current?.focus()} accessibilityLabel="간편비밀번호 입력하기">
          {Array.from({
          length: 6
        }, (_, index) => <View key={index} style={[styles.dot, index < pin.length && styles.filled]} />)}
        </TouchableOpacity>

        <TextInput ref={input} style={styles.hidden} value={pin} onChangeText={change} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus caretHidden autoCorrect={false} editable={!checking} accessibilityLabel="6자리 간편비밀번호" />

        {checking && <ActivityIndicator color="#245DE5" />}

        <Text style={styles.hint}>
          개발용 간편 로그인입니다. 실제 은행 인증이 아닙니다.
        </Text>
      </View>

      <TouchableOpacity disabled={checking} style={styles.other} onPress={() => {
      if (busy.current) return;
      setPin('');
      Keyboard.dismiss();
      onUsePassword?.();
    }}>
        <Text style={styles.link}>
          아이디·비밀번호로 로그인하기
        </Text>
      </TouchableOpacity>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB",
    paddingHorizontal: 24
  },
  logo: {
    marginTop: 45,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: "800",
    color: "#245DE5"
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center"
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 39
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    color: "#5A6E89"
  },
  dots: {
    flexDirection: 'row',
    paddingVertical: 30,
    paddingHorizontal: 10
  },
  dot: {
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: "#E3EAF4",
    marginHorizontal: 9
  },
  filled: {
    backgroundColor: "#245DE5"
  },
  hidden: {
    width: 1,
    height: 1,
    opacity: 0
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
