
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Alert } from '../utils/demoAlert';

// 생년월일 유효성 검사
const isValidBirthDate = (value) => {
  if (!/^\d{8}$/.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));

  if (year < 1000 || month < 1 || month > 12) {
    return false;
  }

  const lastDay = new Date(year, month, 0).getDate();

  if (day < 1 || day > lastDay) {
    return false;
  }

  const today = new Date();

  const todayNumber =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();

  return Number(value) <= todayNumber;
};

// 이메일 형식 확인
const isValidEmail = (value) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return emailRegex.test(value.trim());
};

export default function SignUpScreen({
  onBack,
  onComplete,
  isIdTaken = () => false,
}) {
  // 회원 정보
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');

  // 아이디
  const [id, setId] = useState('');
  const [isIdChecked, setIsIdChecked] = useState(false);

  // 비밀번호
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] =
    useState('');

  // 이메일
  const [email, setEmail] = useState('');

  // ==================================
  // 아이디 형식 확인 (데모)
  // ==================================
  const handleCheckId = () => {
    const trimmedId = id.trim();

    if (trimmedId.length < 4) {
      Alert.alert(
        '알림',
        '아이디를 4자 이상 입력해주세요.'
      );
      return;
    }

    if (/\s/.test(trimmedId)) {
      Alert.alert(
        '알림',
        '아이디에는 공백을 사용할 수 없습니다.'
      );
      return;
    }

    if (isIdTaken(trimmedId)) {
      Alert.alert('이미 사용 중인 시연 ID', '다른 테스트 아이디를 사용해주세요.');
      return;
    }

    // Presentation demo only; actual server duplicate check is unavailable.
    setIsIdChecked(true);

    Alert.alert(
      '형식 확인 완료',
      '데모용 아이디를 사용할 수 있어요. 실제 서버 중복 확인은 아닙니다.'
    );
  };

  // ==================================
  // 회원가입 입력값 검사
  // ==================================
  const handleSignUp = () => {

    // 이름
    if (name.trim().length < 2) {
      Alert.alert(
        '알림',
        '이름을 2자 이상 입력해주세요.'
      );
      return;
    }

    // 생년월일
    if (!isValidBirthDate(birthDate)) {
      Alert.alert(
        '알림',
        '올바른 생년월일 8자리를 입력해주세요.\n예: 20020115'
      );
      return;
    }

    // 아이디
    if (!isIdChecked) {
      Alert.alert(
        '알림',
        '아이디 형식 확인을 진행해주세요.'
      );
      return;
    }

    // 비밀번호
    if (password.length < 4) {
      Alert.alert(
        '알림',
        '비밀번호를 4자 이상 입력해주세요.'
      );
      return;
    }

    if (password !== passwordConfirm) {
      Alert.alert(
        '알림',
        '비밀번호가 일치하지 않습니다.'
      );
      return;
    }

    // 이메일
    if (!isValidEmail(email)) {
      Alert.alert(
        '알림',
        '올바른 이메일 형식을 입력해주세요.'
      );
      return;
    }

    // Session-only demo account: no real signup, no network, no personal data saved.
    // Login ID/password live in App React state only and vanish on refresh.
    Alert.alert(
      '시연용 가입 완료',
      `이번 화면에서만 ${id.trim()} 아이디로 로그인할 수 있어요.\n실제 계정이 생성된 것은 아니며, 새로고침하면 사라집니다.`,
      [{ text: '로그인 화면으로', onPress: () => onComplete?.({ id: id.trim(), password }) }]
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'ios' ? 'padding' : 'height'
        }
        style={{ flex: 1 }}
      >

        {/* 뒤로 가기 */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backText}>
              ← 뒤로
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          <Text style={styles.title}>
            회원가입
          </Text>

          <Text style={styles.subtitle}>
            발표용 가입 체험입니다. 가상의 정보만 입력하세요.{'\n'}실제 계정은 생성되지 않습니다.
          </Text>

          {/* 이름 */}
          <Text style={styles.label}>
            이름
          </Text>

          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="이름을 입력해주세요"
            placeholderTextColor="#A0A0A0"
            autoCapitalize="none"
            maxLength={50}
          />

          {/* 생년월일 */}
          <Text style={styles.label}>
            생년월일
          </Text>

          <TextInput
            style={styles.input}
            value={birthDate}
            onChangeText={(text) => {
              setBirthDate(
                text.replace(/[^0-9]/g, '')
              );
            }}
            placeholder="YYYYMMDD (예: 20020115)"
            placeholderTextColor="#A0A0A0"
            keyboardType="number-pad"
            maxLength={8}
          />

          <Text style={styles.helperText}>
            생년월일 8자리를 입력해주세요.
          </Text>

          {birthDate.length === 8 &&
            !isValidBirthDate(birthDate) && (
              <Text style={styles.errorText}>
                올바른 생년월일을 입력해주세요.
              </Text>
            )}

          {/* 아이디 */}
          <Text style={styles.label}>
            아이디
          </Text>

          <View style={styles.inputRow}>
            <TextInput
              style={[
                styles.input,
                styles.flexInput,
              ]}
              value={id}
              onChangeText={(text) => {
                setId(text);
                setIsIdChecked(false);
              }}
              placeholder="아이디 입력"
              placeholderTextColor="#A0A0A0"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={[
                styles.actionBtn,
                isIdChecked && styles.actionBtnSuccess,
              ]}
              onPress={handleCheckId}
            >
              <Text style={styles.actionBtnText}>
                {isIdChecked
                  ? '확인 완료'
                  : '형식 확인'}
              </Text>
            </TouchableOpacity>
          </View>

          {isIdChecked && (
            <Text style={styles.successText}>
              ✓ 아이디 형식 확인 완료 (데모)
            </Text>
          )}

          {/* 비밀번호 */}
          <Text style={styles.label}>
            비밀번호
          </Text>

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="비밀번호 입력"
            placeholderTextColor="#A0A0A0"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* 비밀번호 재확인 */}
          <Text style={styles.label}>
            비밀번호 확인
          </Text>

          <TextInput
            style={styles.input}
            value={passwordConfirm}
            onChangeText={setPasswordConfirm}
            placeholder="비밀번호 다시 입력"
            placeholderTextColor="#A0A0A0"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          {passwordConfirm.length > 0 && (
            <Text
              style={
                password === passwordConfirm
                  ? styles.successText
                  : styles.errorText
              }
            >
              {password === passwordConfirm
                ? '✓ 비밀번호가 일치합니다.'
                : '비밀번호가 일치하지 않습니다.'}
            </Text>
          )}

          {/* 이메일 */}
          <Text style={styles.label}>
            이메일
          </Text>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="example@email.com"
            placeholderTextColor="#A0A0A0"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {email.length > 0 &&
            !isValidEmail(email) && (
              <Text style={styles.errorText}>
                이메일 형식을 확인해주세요.
              </Text>
            )}

          {/* 시연 안내 */}
          <View style={styles.demoNoticeBox}>
            <Text style={styles.demoNotice}>
              본 서비스는 개발 중인 시연용 앱입니다.
              {'\n'}
              휴대폰 본인인증 없이 회원가입 화면을
              체험할 수 있습니다.
              {'\n'}
              실제 회원가입 및 계정 생성은
              백엔드 연동 후 지원됩니다.
            </Text>
          </View>

          <View style={{ height: 40 }} />

        </ScrollView>

        {/* 회원가입 버튼 */}
        <TouchableOpacity
          style={styles.bottomButton}
          onPress={handleSignUp}
          activeOpacity={0.8}
        >
          <Text style={styles.bottomButtonText}>
            회원가입
          </Text>
        </TouchableOpacity>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  header: {
    padding: 20,
  },

  backText: {
    fontSize: 16,
    color: '#767676',
  },

  content: {
    flex: 1,
    paddingHorizontal: 24,
  },

  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 15,
    color: '#767676',
    marginBottom: 32,
  },

  label: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#1A1A1A',
    marginTop: 20,
    marginBottom: 8,
  },

  input: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  flexInput: {
    flex: 1,
    marginRight: 10,
  },

  helperText: {
    color: '#999999',
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },

  errorText: {
    color: '#FF3B30',
    fontSize: 13,
    marginTop: 6,
    marginLeft: 4,
  },

  successText: {
    color: '#00A86B',
    fontSize: 13,
    marginTop: 6,
    marginLeft: 4,
    fontWeight: '600',
  },

  actionBtn: {
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 16,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
  },

  actionBtnSuccess: {
    backgroundColor: '#0046FF',
  },

  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },

  demoNoticeBox: {
    marginTop: 30,
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 12,
  },

  demoNotice: {
    fontSize: 12,
    color: '#777777',
    lineHeight: 20,
    textAlign: 'center',
  },

  bottomButton: {
    backgroundColor: '#0046FF',
    margin: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },

  bottomButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
