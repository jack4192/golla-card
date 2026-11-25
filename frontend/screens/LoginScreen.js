import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, ScrollView, Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import ScreenSafeArea from '../components/ScreenSafeArea';
import { Ionicons } from '@expo/vector-icons';
import FlowHeading from '../components/FlowHeading';
import { isValidEmail, normalizeEmail } from '../utils/demoEmail';
export default function LoginScreen({
  onLogin,
  onSignUp
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [englishHint, setEnglishHint] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const foreground = useRef(true);
  useEffect(() => {
    mounted.current = true;
    foreground.current = !AppState.currentState || AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      if (state !== 'active') {
        setPassword('');
        Keyboard.dismiss();
      }
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, []);
  const change = (setter, value) => {
    if (busy.current || !foreground.current) return;
    setter(value);
    setError('');
  };
  const login = async () => {
    if (busy.current || !foreground.current) return;
    const address = normalizeEmail(email);
    if (!address || !password) {
      setError('이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (!isValidEmail(address)) {
      setError('올바른 이메일 형식을 입력해주세요.');
      return;
    }
    if (password.length < 4) {
      setError('비밀번호를 4자리 이상 입력해주세요.');
      return;
    }
    const submittedPassword = password;
    busy.current = true;
    setSubmitting(true);
    setError('');
    setPassword('');
    Keyboard.dismiss();
    try {
      if (typeof onLogin !== 'function') {
        throw Error('로그인 연결을 확인해주세요.');
      }
      await onLogin(address, submittedPassword);
    } catch (failure) {
      if (mounted.current && foreground.current) {
        setError(failure?.message || '로그인 처리 중 문제가 발생했습니다.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setSubmitting(false);
        setPassword('');
      }
    }
  };
  const signUp = () => {
    if (busy.current || !foreground.current) return;
    setPassword('');
    setError('');
    Keyboard.dismiss();
    onSignUp?.();
  };
  return <ScreenSafeArea style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{flex:1}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.container}>
        <View style={styles.heading}>
          <FlowHeading brand icon="wallet-outline">내 지갑에 로그인</FlowHeading>
        </View>

        <View style={styles.form}>
          <View style={styles.inputRow}>
            <Ionicons name="mail-outline" size={19} color="#526D97" />
            <TextInput style={styles.input} placeholder="이메일" placeholderTextColor="#687B97" value={email} onChangeText={value => { const clean = value.replace(/[^A-Za-z0-9@._%+\-]/g, ''); setEnglishHint(clean !== value); change(setEmail, clean); }} keyboardType="email-address" maxLength={254} autoCapitalize="none" autoCorrect={false} textContentType="username" editable={!submitting} accessibilityLabel="이메일" />
          </View>

          {englishHint && <Text style={styles.englishHint} accessibilityLiveRegion="polite">영어로 입력해주세요</Text>}

          <View style={styles.inputRow}>
            <Ionicons name="lock-closed-outline" size={19} color="#526D97" />
            <TextInput style={styles.input} placeholder="비밀번호" placeholderTextColor="#687B97" value={password} onChangeText={value => change(setPassword, value)} secureTextEntry textContentType="password" autoCapitalize="none" autoCorrect={false} editable={!submitting} onSubmitEditing={login} returnKeyType="go" accessibilityLabel="비밀번호" />
          </View>

          {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>}

        </View>

        <TouchableOpacity style={[styles.button, submitting && styles.disabled]} onPress={login} disabled={submitting} activeOpacity={0.8}>
          {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>로그인</Text>}
        </TouchableOpacity>

        <View style={styles.footer}>
          <TouchableOpacity onPress={signUp} disabled={submitting}>
            <Text style={styles.footerText}>회원가입</Text>
          </TouchableOpacity>
        </View>
      </ScrollView></KeyboardAvoidingView>
    </ScreenSafeArea>;
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F7FF"
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingVertical: 28,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center"
  },
  heading: {marginBottom: 26},
  form: {gap: 10, marginBottom: 18},
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D9E3F4',
    paddingLeft: 16,
    minHeight: 56
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 15,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#142D4E',
    borderRadius: 16
  },
  englishHint: {
    color: '#C53D56',
    fontSize: 12,
    marginTop: -6,
    marginBottom: 8,
    marginLeft: 6
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 22
  },
  button: {
    backgroundColor: "#104FE7",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
    marginBottom: 24,
    padding: 16
  },
  disabled: {
    opacity: 0.7
  },
  white: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  footerText: {
    fontSize: 13,
    color: '#555'
  }
});
