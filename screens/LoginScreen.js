
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Alert } from '../utils/demoAlert';

export default function LoginScreen({ onLogin, onSignUp, demoAccountReady = false }) {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // 로그인 입력 확인 및 처리
  const handleLogin = async () => {
    if (isSubmitting) return;

    const trimmedId = id.trim();

    if (!trimmedId || !password) {
      setErrorMessage('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }

    if (password.length < 4) {
      setErrorMessage('비밀번호를 4자리 이상 입력해주세요.');
      return;
    }

    setErrorMessage('');
    setIsSubmitting(true);

    try {
      // 실제 로그인 처리는 App.js가 담당
      await onLogin(trimmedId, password);
    } catch (error) {
      setErrorMessage(
        error?.message || '로그인 처리 중 문제가 발생했습니다.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        {/* 로고 및 타이틀 */}
        <View style={styles.titleContainer}>
          <Text style={styles.logo}>SOL-Pay</Text>
          <Text style={styles.subtitle}>AI 카드 혜택 도우미</Text>
        </View>

        {/* 아이디와 비밀번호 */}
        <View style={styles.formContainer}>
          <TextInput
            style={styles.input}
            placeholder="아이디"
            placeholderTextColor="#A0A0A0"
            value={id}
            onChangeText={(value) => {
              setId(value);
              setErrorMessage('');
            }}
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="username"
            editable={!isSubmitting}
          />

          <TextInput
            style={styles.input}
            placeholder="비밀번호"
            placeholderTextColor="#A0A0A0"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setErrorMessage('');
            }}
            secureTextEntry
            textContentType="password"
            editable={!isSubmitting}
            onSubmitEditing={handleLogin}
            returnKeyType="go"
          />

          {/* 로그인 오류 메시지 */}
          {!!errorMessage && (
            <Text style={styles.errorText}>
              {errorMessage}
            </Text>
          )}

          {/* 개발 모드에서만 테스트 계정 안내 */}
          {(__DEV__ || Platform.OS === 'web') && (
            <Text style={styles.demoText}>
              발표용 테스트 계정: demo / 1234
              {'\n'}회원가입 체험 시 방금 만든 ID/비밀번호도 사용 가능해요.
              {'\n'}실제 계정 인증은 아닙니다.
            </Text>
          )}
        </View>

        {/* 로그인 버튼 */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            isSubmitting && styles.disabledButton,
          ]}
          onPress={handleLogin}
          disabled={isSubmitting}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.loginButtonText}>
              로그인
            </Text>
          )}
        </TouchableOpacity>

        {/* 회원가입 및 계정 찾기 */}
        <View style={styles.footerContainer}>
          <TouchableOpacity
            onPress={onSignUp}
            disabled={isSubmitting}
          >
            <Text style={styles.footerText}>
              회원가입
            </Text>
          </TouchableOpacity>

          <Text style={styles.separator}>|</Text>

          <TouchableOpacity
            onPress={() =>
              Alert.alert(
                '안내',
                '아이디/비밀번호 찾기는 백엔드 연동 후 지원할 예정입니다.'
              )
            }
          >
            <Text style={styles.footerText}>
              아이디/비밀번호 찾기
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    paddingBottom: 50,
  },

  titleContainer: {
    marginBottom: 40,
  },

  logo: {
    fontSize: 32,
    fontWeight: '900',
    color: '#1A237E',
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 15,
    color: '#767676',
  },

  formContainer: {
    marginBottom: 24,
  },

  input: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },

  errorText: {
    color: '#D93025',
    fontSize: 13,
    marginTop: 2,
    marginBottom: 10,
  },

  demoText: {
    fontSize: 12,
    color: '#767676',
    marginTop: 2,
    lineHeight: 19,
  },

  loginButton: {
    backgroundColor: '#1A237E',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginBottom: 24,
  },

  disabledButton: {
    opacity: 0.7,
  },

  loginButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },

  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },

  footerText: {
    fontSize: 13,
    color: '#555555',
  },

  separator: {
    marginHorizontal: 16,
    color: '#CCCCCC',
    fontSize: 13,
  },
});
