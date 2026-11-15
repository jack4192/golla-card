import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';

export default function MyDataAuthScreen({ onBack, onNext }) {
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [isSent, setIsSent] = useState(false);

  const handlePhoneChange = (text) => {
    // 숫자만 추출하여 상태 업데이트 (최대 길이는 TextInput의 maxLength로 제어)
    const cleaned = text.replace(/[^0-9]/g, '');
    setPhoneNumber(cleaned);
  };

  const handleAuthCodeChange = (text) => {
      const cleaned = text.replace(/[^0-9]/g, '');
      setAuthCode(cleaned);
  }

  const handleSendCode = () => {
    setIsSent(true);
    // 실제 인증번호 전송 로직이 들어갈 자리
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backText}>← 뒤로</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>안전한 연결을 위해{'\n'}본인 인증을 진행해주세요</Text>
          <Text style={styles.subtitle}>금융기관에 흩어진 정보를 불러오기 위해{'\n'}최초 1회 인증이 필요합니다.</Text>

          {/* 이름 입력 */}
          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.inputField}
            value={name}
            onChangeText={setName}
            placeholder="이름 입력"
            placeholderTextColor="#C7C7CC"
          />

          {/* 휴대폰 번호 입력 */}
          <Text style={styles.label}>휴대폰 번호</Text>
          <View style={styles.phoneInputRow}>
            <TextInput
              style={[styles.inputField, styles.phoneInput]}
              value={phoneNumber}
              onChangeText={handlePhoneChange}
              keyboardType="number-pad"
              maxLength={11} // 핵심 수정: 11자리까지만 입력 가능하도록 제한
              placeholder="숫자만 입력"
              placeholderTextColor="#C7C7CC"
            />
            <TouchableOpacity 
              style={[styles.sendButton, phoneNumber.length >= 10 ? styles.sendButtonActive : styles.sendButtonInactive]}
              onPress={handleSendCode}
              disabled={phoneNumber.length < 10}
            >
              <Text style={[styles.sendButtonText, phoneNumber.length >= 10 ? styles.sendTextActive : styles.sendTextInactive]}>
                {isSent ? '재전송' : '인증요청'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* 인증번호 입력 (인증요청 버튼을 누른 후에만 표시) */}
          {isSent && (
            <>
              <Text style={styles.label}>인증번호 6자리</Text>
              <View style={styles.authCodeContainer}>
                  <TextInput
                    style={styles.inputField}
                    value={authCode}
                    onChangeText={handleAuthCodeChange}
                    keyboardType="number-pad"
                    maxLength={6} // 인증번호 6자리 제한
                    placeholder="000000"
                    placeholderTextColor="#C7C7CC"
                  />
                  {/* 데모를 위해 타이머 텍스트만 표시 */}
                  <Text style={styles.timerText}>02:59</Text>
              </View>
            </>
          )}
        </View>

        {/* 다음 단계 버튼 */}
        <TouchableOpacity 
          style={[
            styles.bottomButton, 
            (name.length > 0 && phoneNumber.length >= 10 && authCode.length === 6) ? styles.buttonActive : styles.buttonInactive
          ]} 
          onPress={onNext}
          disabled={!(name.length > 0 && phoneNumber.length >= 10 && authCode.length === 6)}
        >
          <Text style={styles.bottomButtonText}>인증 완료</Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1 },
  header: { padding: 20 },
  backText: { fontSize: 16, color: '#767676' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 10 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1A1A1A', marginBottom: 8, lineHeight: 32 },
  subtitle: { fontSize: 14, color: '#767676', marginBottom: 32, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#1A1A1A', marginBottom: 8, marginTop: 16 },
  inputField: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1A1A1A',
  },
  phoneInputRow: { flexDirection: 'row', alignItems: 'center' },
  phoneInput: { flex: 1, marginRight: 12 },
  sendButton: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonActive: { backgroundColor: '#E8F0FE' }, // 옅은 파란색 배경
  sendButtonInactive: { backgroundColor: '#F8F9FA' },
  sendTextActive: { color: '#0046FF', fontWeight: 'bold' },
  sendTextInactive: { color: '#C7C7CC' },
  authCodeContainer: { position: 'relative' },
  timerText: {
      position: 'absolute',
      right: 16,
      top: 18,
      color: '#FF3B30', // 빨간색 타이머
      fontSize: 14,
      fontWeight: 'bold',
  },
  bottomButton: {
    margin: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonActive: { backgroundColor: '#0046FF' },
  buttonInactive: { backgroundColor: '#E5E5EA' },
  bottomButtonText: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' }
});