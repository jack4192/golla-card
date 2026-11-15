
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Alert } from '../utils/demoAlert';

const BANKS = [
  '신한은행',
  '국민은행',
  '우리은행',
  '하나은행',
  '농협은행',
  '토스뱅크',
];

export default function AccountAuthScreen({ onBack, onNext }) {
  const [step, setStep] = useState('list');
  const [isAllSelected, setIsAllSelected] = useState(true);
  const [selectedBank, setSelectedBank] = useState('신한은행');
  const [accountNumber, setAccountNumber] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const savingRef = useRef(false);
  const pinInputRef = useRef(null);

  const handleBack = () => {
    if (isSaving) return;

    if (step === 'list') onBack?.();
    else if (step === 'account') setStep('list');
    else if (step === 'verify') setStep('account');
    else if (step === 'pin1') setStep('verify');
    else if (step === 'pin2') {
      setPin1('');
      setPin2('');
      setStep('pin1');
    }
  };

  // 첫 번째 간편비밀번호 입력
  const handlePin1Change = (text) => {
    const next = text.replace(/\D/g, '').slice(0, 6);
    setPin1(next);

    if (next.length === 6) {
      setPin2('');
      setStep('pin2');
    }
  };

  // 간편비밀번호 재입력 및 저장 요청
  const handlePin2Change = async (text) => {
    const next = text.replace(/\D/g, '').slice(0, 6);
    setPin2(next);

    if (next.length !== 6 || savingRef.current) return;

    if (pin1 !== next) {
      Alert.alert(
        '비밀번호 불일치',
        '두 번호가 달라요. 처음부터 다시 입력해주세요.'
      );

      setPin1('');
      setPin2('');
      setStep('pin1');
      return;
    }

    savingRef.current = true;
    setIsSaving(true);

    try {
      // App.js에서 실제 데모 PIN 확인정보를 저장
      await onNext(next);
    } catch (error) {
      Alert.alert(
        '저장 실패',
        error?.message || '간편비밀번호를 저장하지 못했어요.'
      );

      setPin2('');
      pinInputRef.current?.focus();
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleBack}
            disabled={isSaving}
          >
            <Text style={styles.backText}>← 뒤로</Text>
          </TouchableOpacity>
        </View>

        {/* 1. 연결 기관 선택 */}
        {step === 'list' && (
          <View style={styles.flex}>
            <ScrollView
              style={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.title}>
                흩어진 내 자산을{'\n'}한 번에 모아볼까요?
              </Text>

              <Text style={styles.subtitle}>
                정확한 소비 패턴 분석을 위해{'\n'}
                자산과 결제 내역을 연결해 주세요.
              </Text>

              <TouchableOpacity
                style={styles.selectAllBox}
                onPress={() => setIsAllSelected(!isAllSelected)}
              >
                <Text style={styles.selectAllText}>
                  전체 기관 연결하기
                </Text>

                <View
                  style={[
                    styles.checkbox,
                    isAllSelected && styles.checkboxActive,
                  ]}
                >
                  {isAllSelected && (
                    <Text style={styles.checkMark}>✓</Text>
                  )}
                </View>
              </TouchableOpacity>

              <View style={styles.institutionList}>
                <Text style={styles.listTitle}>
                  연결 가능한 기관
                </Text>

                {[
                  '은행 (신한, 국민, 토스뱅크 등 14개)',
                  '카드 (신한, 삼성, 현대 등 9개)',
                  '증권/페이 (네이버페이 등 6개)',
                ].map((item) => (
                  <View
                    key={item}
                    style={styles.institutionItem}
                  >
                    <Text style={styles.institutionName}>
                      {item}
                    </Text>

                    <Text style={styles.institutionStatus}>
                      연결 대기
                    </Text>
                  </View>
                ))}
              </View>

              <Text style={styles.demoNotice}>
                시연용 화면이며 실제 금융기관과
                연결되지 않습니다.
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[
                styles.bottomButton,
                isAllSelected
                  ? styles.buttonActive
                  : styles.buttonInactive,
              ]}
              disabled={!isAllSelected}
              onPress={() => setStep('account')}
            >
              <Text style={styles.bottomButtonText}>
                자산 가져오기 (데모)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 2. 계좌번호 입력 */}
        {step === 'account' && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>
              연결할 계좌를{'\n'}입력해주세요
            </Text>

            <Text style={styles.subtitle}>
              1원 인증 과정을 시연합니다.
              실제 계좌번호는 입력하지 마세요.
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.bankScroll}
            >
              {BANKS.map((bank) => (
                <TouchableOpacity
                  key={bank}
                  style={[
                    styles.bankChip,
                    selectedBank === bank &&
                      styles.bankChipActive,
                  ]}
                  onPress={() => setSelectedBank(bank)}
                >
                  <Text
                    style={[
                      styles.bankChipText,
                      selectedBank === bank &&
                        styles.bankChipTextActive,
                    ]}
                  >
                    {bank}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TextInput
              style={styles.inputField}
              value={accountNumber}
              onChangeText={(value) =>
                setAccountNumber(
                  value.replace(/\D/g, '').slice(0, 16)
                )
              }
              keyboardType="number-pad"
              placeholder="테스트 계좌번호 입력 (- 제외)"
              placeholderTextColor="#C7C7CC"
              maxLength={16}
            />

            <Text style={styles.demoNotice}>
              입력한 테스트 계좌번호는 기기에 저장하지
              않습니다.
            </Text>

            <View style={styles.flex} />

            <TouchableOpacity
              style={[
                styles.bottomButton,
                accountNumber.length >= 10
                  ? styles.buttonActive
                  : styles.buttonInactive,
              ]}
              disabled={accountNumber.length < 10}
              onPress={() => setStep('verify')}
            >
              <Text style={styles.bottomButtonText}>
                1원 인증 시연하기
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 3. 1원 인증 시연 */}
        {step === 'verify' && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>
              1원 인증번호를{'\n'}입력해주세요
            </Text>

            <Text style={styles.subtitle}>
              실제 1원 송금은 하지 않습니다.
              {'\n'}테스트 인증번호는{' '}
              <Text style={styles.blueText}>123</Text>
              {' '}입니다.
            </Text>

            <TextInput
              style={[
                styles.inputField,
                styles.authCodeInput,
              ]}
              value={authCode}
              onChangeText={(value) =>
                setAuthCode(
                  value.replace(/\D/g, '').slice(0, 3)
                )
              }
              keyboardType="number-pad"
              maxLength={3}
              placeholder="000"
              placeholderTextColor="#C7C7CC"
            />

            <View style={styles.flex} />

            <TouchableOpacity
              style={[
                styles.bottomButton,
                authCode.length === 3
                  ? styles.buttonActive
                  : styles.buttonInactive,
              ]}
              disabled={authCode.length !== 3}
              onPress={() => {
                if (authCode !== '123') {
                  Alert.alert(
                    '인증 실패 (데모)',
                    '테스트 번호 123을 입력해주세요.'
                  );
                  setAuthCode('');
                  return;
                }

                setStep('pin1');
              }}
            >
              <Text style={styles.bottomButtonText}>
                인증하기 (데모)
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* 4~5. 간편비밀번호 설정 및 확인 */}
        {(step === 'pin1' || step === 'pin2') && (
          <View style={styles.stepContainer}>
            <Text style={styles.title}>
              {step === 'pin1'
                ? '다음 로그인에 사용할\n간편비밀번호를 설정해주세요'
                : '간편비밀번호를\n한 번 더 입력해주세요'}
            </Text>

            <Text style={styles.subtitle}>
              {step === 'pin1'
                ? '숫자 6자리를 설정하면 다음 앱 실행부터 이 번호로 로그인해요.'
                : '앞에서 입력한 6자리 번호를 다시 입력해주세요.'}
            </Text>

            <TouchableOpacity
              style={styles.pinTouchArea}
              onPress={() => pinInputRef.current?.focus()}
              activeOpacity={1}
            >
              <View style={styles.pinDotsRow}>
                {Array.from({ length: 6 }, (_, index) => {
                  const value =
                    step === 'pin1' ? pin1 : pin2;

                  return (
                    <View
                      key={index}
                      style={[
                        styles.pinDot,
                        index < value.length &&
                          styles.pinDotActive,
                      ]}
                    />
                  );
                })}
              </View>
            </TouchableOpacity>

            <Text style={styles.demoNotice}>
              개발용 PIN 등록입니다. 실제 금융 인증
              수단으로 사용하지 않습니다.
            </Text>

            <TextInput
              key={step}
              ref={pinInputRef}
              style={styles.pinInput}
              value={step === 'pin1' ? pin1 : pin2}
              onChangeText={
                step === 'pin1'
                  ? handlePin1Change
                  : handlePin2Change
              }
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              autoFocus
              editable={!isSaving}
              caretHidden
            />

            {isSaving && (
              <View style={styles.savingRow}>
                <ActivityIndicator
                  size="small"
                  color="#0046FF"
                />
                <Text style={styles.savingText}>
                  간편비밀번호 저장 중...
                </Text>
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  flex: {
    flex: 1,
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
    paddingTop: 10,
  },
  stepContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1A1A1A',
    lineHeight: 34,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: '#767676',
    lineHeight: 24,
    marginBottom: 32,
  },
  selectAllBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#0046FF',
    marginBottom: 24,
  },
  selectAllText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0046FF',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#0046FF',
    borderColor: '#0046FF',
  },
  checkMark: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  institutionList: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  listTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#767676',
    marginBottom: 16,
  },
  institutionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  institutionName: {
    fontSize: 15,
    color: '#1A1A1A',
    flex: 1,
  },
  institutionStatus: {
    fontSize: 14,
    color: '#C7C7CC',
    fontWeight: 'bold',
  },
  bankScroll: {
    maxHeight: 50,
    marginBottom: 20,
  },
  bankChip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    marginRight: 10,
    backgroundColor: '#F8F9FA',
  },
  bankChipActive: {
    borderColor: '#0046FF',
    backgroundColor: '#E8F0FE',
  },
  bankChipText: {
    fontSize: 15,
    color: '#767676',
    fontWeight: '500',
  },
  bankChipTextActive: {
    color: '#0046FF',
    fontWeight: 'bold',
  },
  inputField: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 20,
    fontSize: 18,
    color: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  authCodeInput: {
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 10,
  },
  blueText: {
    color: '#0046FF',
    fontWeight: 'bold',
  },
  demoNotice: {
    color: '#888888',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 18,
  },
  pinTouchArea: {
    paddingVertical: 25,
    marginTop: 15,
  },
  pinDotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 10,
  },
  pinDotActive: {
    backgroundColor: '#0046FF',
  },
  pinInput: {
    height: 1,
    width: 1,
    opacity: 0,
    alignSelf: 'center',
  },
  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  savingText: {
    marginLeft: 8,
    color: '#0046FF',
    fontSize: 13,
  },
  bottomButton: {
    marginHorizontal: 24,
    marginBottom: 24,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonActive: {
    backgroundColor: '#0046FF',
  },
  buttonInactive: {
    backgroundColor: '#C7C7CC',
  },
  bottomButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
