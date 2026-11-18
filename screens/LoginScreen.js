import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Keyboard, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Alert } from '../utils/demoAlert';
export default function LoginScreen({
  onLogin,
  onSignUp,
  demoAccountReady = false
}) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
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
    const userId = id.trim();
    if (!userId || !password) {
      setError('아이디와 비밀번호를 모두 입력해주세요.');
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
      await onLogin(userId, submittedPassword);
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
  return <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <View style={styles.heading}>
          <Text style={styles.logo}>SOL-Pay</Text>
          <Text style={styles.subtitle}>AI 카드 혜택 도우미</Text>
        </View>

        <View style={styles.form}>
          <TextInput style={styles.input} placeholder="아이디" placeholderTextColor="#A0A0A0" value={id} onChangeText={value => change(setId, value)} autoCapitalize="none" autoCorrect={false} textContentType="username" editable={!submitting} accessibilityLabel="아이디" />

          <TextInput style={styles.input} placeholder="비밀번호" placeholderTextColor="#A0A0A0" value={password} onChangeText={value => change(setPassword, value)} secureTextEntry textContentType="password" autoCapitalize="none" autoCorrect={false} editable={!submitting} onSubmitEditing={login} returnKeyType="go" accessibilityLabel="비밀번호" />

          {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>}

          {(__DEV__ || Platform.OS === 'web') && <Text style={styles.demo}>
              발표용 테스트 계정: demo / 1234
              {'\n'}
              {demoAccountReady ? '방금 만든 테스트 계정으로도 로그인할 수 있습니다.' : '회원가입 체험으로 테스트 계정을 만들 수 있습니다.'}
              {'\n'}실제 계정 인증은 아닙니다.
            </Text>}
        </View>

        <TouchableOpacity style={[styles.button, submitting && styles.disabled]} onPress={login} disabled={submitting} activeOpacity={0.8}>
          {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>로그인</Text>}
        </TouchableOpacity>

        <View style={styles.footer}>
          <TouchableOpacity onPress={signUp} disabled={submitting}>
            <Text style={styles.footerText}>회원가입</Text>
          </TouchableOpacity>

          <Text style={styles.separator}>|</Text>

          <TouchableOpacity disabled={submitting} onPress={() => {
          if (!busy.current && foreground.current) {
            Alert.alert('안내', '아이디/비밀번호 찾기는 백엔드 연동 후 지원할 예정입니다.');
          }
        }}>
            <Text style={styles.footerText}>아이디/비밀번호 찾기</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingBottom: 50,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center"
  },
  heading: {
    marginBottom: 32
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: "#245DE5",
    marginBottom: 8,
    lineHeight: 46,
    letterSpacing: -1
  },
  subtitle: {
    fontSize: 14,
    color: "#5A6E89",
    lineHeight: 24
  },
  form: {
    marginBottom: 20
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    color: "#142D4E",
    minHeight: 52,
    padding: 15
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 22
  },
  demo: {
    fontSize: 12,
    color: "#5A6E89",
    marginTop: 2,
    lineHeight: 19
  },
  button: {
    backgroundColor: "#245DE5",
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
  },
  separator: {
    color: '#CCC',
    fontSize: 13
  }
});
