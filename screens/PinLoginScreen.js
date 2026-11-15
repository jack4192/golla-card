
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, TextInput, ActivityIndicator } from 'react-native';
import { Alert } from '../utils/demoAlert';

export default function PinLoginScreen({
  onVerify,
  onUsePassword,
}) {
  const [pin, setPin] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const inputRef = useRef(null);
  const checkingRef = useRef(false);

  const handlePinChange = async (text) => {
    const next = text.replace(/\D/g, '').slice(0, 6);
    setPin(next);

    if (next.length !== 6 || checkingRef.current) {
      return;
    }

    checkingRef.current = true;
    setIsChecking(true);

    try {
      // App.js에서 저장한 데모 PIN과 비교
      await onVerify(next);
    } catch (error) {
      Alert.alert(
        '간편비밀번호 확인',
        error?.message || '다시 시도해주세요.'
      );
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
      setPin('');
      inputRef.current?.focus();
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.logo}>SOL-Pay</Text>
        <Text style={styles.logoCaption}>
          AI 카드 혜택 도우미
        </Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.title}>
          간편비밀번호 입력
        </Text>

        <Text style={styles.subtitle}>
          이전에 설정한 6자리 숫자를 입력해주세요.
        </Text>

        <TouchableOpacity
          style={styles.dotsTouchArea}
          onPress={() => inputRef.current?.focus()}
          activeOpacity={1}
        >
          <View style={styles.dotsRow}>
            {Array.from({ length: 6 }, (_, index) => (
              <View
                key={index}
                style={[
                  styles.dot,
                  index < pin.length && styles.activeDot,
                ]}
              />
            ))}
          </View>
        </TouchableOpacity>

        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={pin}
          onChangeText={handlePinChange}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={6}
          autoFocus
          caretHidden
          editable={!isChecking}
        />

        {isChecking && (
          <View style={styles.checkingRow}>
            <ActivityIndicator
              size="small"
              color="#0046FF"
            />
            <Text style={styles.checkingText}>
              확인 중...
            </Text>
          </View>
        )}

        <Text style={styles.notice}>
          개발용 간편 로그인입니다. 실제 은행 인증이나
          JWT 검증은 하지 않습니다.
        </Text>
      </View>

      <TouchableOpacity
        style={styles.otherLogin}
        onPress={onUsePassword}
        disabled={isChecking}
      >
        <Text style={styles.otherLoginText}>
          아이디·비밀번호로 로그인하기
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  header: {
    marginTop: 45,
    alignItems: 'center',
  },
  logo: {
    color: '#1A237E',
    fontWeight: '900',
    fontSize: 28,
  },
  logoCaption: {
    color: '#767676',
    fontSize: 13,
    marginTop: 5,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: '#767676',
    textAlign: 'center',
    lineHeight: 22,
  },
  dotsTouchArea: {
    paddingHorizontal: 12,
    paddingVertical: 36,
    marginTop: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 17,
    height: 17,
    backgroundColor: '#E5E5EA',
    borderRadius: 9,
    marginHorizontal: 9,
  },
  activeDot: {
    backgroundColor: '#0046FF',
  },
  hiddenInput: {
    width: 1,
    height: 1,
    opacity: 0,
  },
  checkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  checkingText: {
    marginLeft: 9,
    color: '#0046FF',
    fontSize: 13,
  },
  notice: {
    color: '#999999',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 30,
  },
  otherLogin: {
    alignItems: 'center',
    paddingVertical: 18,
    marginBottom: 25,
  },
  otherLoginText: {
    color: '#0046FF',
    fontSize: 14,
    fontWeight: '600',
  },
});
