
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';

import { Alert } from './utils/demoAlert';
import * as SecureStore from './utils/demoStore';
import { createPinSalt, hashPin } from './utils/pinCrypto';

import LoginScreen from './screens/LoginScreen';
import PinLoginScreen from './screens/PinLoginScreen';
import SignUpScreen from './screens/SignUpScreen';
import AgreementScreen from './screens/AgreementScreen';
import AccountAuthScreen from './screens/AccountAuthScreen';
import DailyRoutineScreen from './screens/DailyRoutineScreen';
import MyDataLoadingScreen from './screens/MyDataLoadingScreen';
import MyDataScreen from './screens/MyDataScreen';
import MainScreen from './screens/MainScreen';
import PaymentScreen from './screens/PaymentScreen';

import SpecialScheduleModal from './components/SpecialScheduleModal';

import {
  DEMO_WALLET_CARDS,
  getActiveWalletCard,
} from './data/cards';

// =====================================
// 저장 키
// =====================================

const DEMO_SESSION_KEY = 'solpay_demo_session_v1';
const DEMO_FINISHED_KEY = 'solpay_demo_onboarding_v1';
const DEMO_CONSENT_KEY = 'solpay_demo_consent_v1';
const CURRENT_CONSENT_VERSION = 'solpay-demo-consent-v1';
const DEMO_PIN_KEY = 'solpay_demo_pin_v1';
const DEMO_PIN_ATTEMPTS_KEY = 'solpay_demo_pin_attempts_v1';

const MAX_WRONG_ATTEMPTS = 5;
const LOCK_DURATION_MS = 60 * 1000;

// =====================================
// 마이데이터 동의 확인
// 기존 GPS 동의는 더 이상 검사하지 않음
// =====================================

const readStoredConsent = async () => {
  const raw = await SecureStore.getItemAsync(
    DEMO_CONSENT_KEY
  );

  if (!raw) return null;

  try {
    const consent = JSON.parse(raw);

    if (
      consent.version !== CURRENT_CONSENT_VERSION ||
      consent.myDataAgreed !== true
    ) {
      return null;
    }

    return consent;
  } catch {
    return null;
  }
};

// =====================================
// PIN 기록 확인
// =====================================

const readPinRecord = async () => {
  const raw = await SecureStore.getItemAsync(
    DEMO_PIN_KEY
  );

  if (!raw) return null;

  try {
    const record = JSON.parse(raw);

    if (
      record.version !== 1 ||
      typeof record.salt !== 'string' ||
      typeof record.hash !== 'string'
    ) {
      return null;
    }

    return record;
  } catch {
    return null;
  }
};

const pinHash = hashPin;

// =====================================
// 발표용 화면 이동 버튼
// =====================================

const SHOW_SCREEN_NAVIGATION =
  __DEV__ ||
  (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      new URLSearchParams(
        window.location.search
      ).get('demoMenu') === '1'
    )
  );

const DEV_SCREENS = [
  { key: 'Login', label: '1. 아이디 로그인' },
  { key: 'PinLogin', label: '1-1. 간편비밀번호 로그인' },
  { key: 'SignUp', label: '1-2. 회원가입' },
  { key: 'Agreement', label: '2. 약관 동의' },
  { key: 'AccountAuth', label: '3. 계좌 및 자산 연동' },
  { key: 'DailyRoutine', label: '4. 평소 일과 등록' },
  { key: 'MyDataLoading', label: '5. 마이데이터 분석' },
  { key: 'MyDataResult', label: '6. 분석 결과' },
  { key: 'Main', label: '7. 메인 화면' },
  { key: 'Payment', label: '8. 결제 화면' },
];

// =====================================
// 메인 앱
// =====================================

export default function App() {
  const [demoAccount, setDemoAccount] = useState(null);

  const [walletCards, setWalletCards] = useState(
    DEMO_WALLET_CARDS
  );

  const [activeCardId, setActiveCardId] = useState(
    DEMO_WALLET_CARDS[0].id
  );

  const activeCard = getActiveWalletCard(
    walletCards,
    activeCardId
  );

  const [currentScreen, setCurrentScreen] =
    useState('Login');

  const [showDevMenu, setShowDevMenu] = useState(false);
  const [isRestoring, setIsRestoring] = useState(true);
  const [consent, setConsent] = useState(null);
  const [hasSavedPin, setHasSavedPin] = useState(false);

  // 일과 화면을 마친 후 돌아갈 곳
  const [routineReturnTo, setRoutineReturnTo] =
    useState('MyDataLoading');

  // 메인 화면의 특별 일정 관리 창
  const [specialScheduleOpen, setSpecialScheduleOpen] =
    useState(false);

  // =====================================
  // 앱 실행 상태 복원
  // =====================================

  useEffect(() => {
    let mounted = true;

    const restoreApp = async () => {
      try {
        const [
          savedConsent,
          savedPin,
          session,
          finished,
        ] = await Promise.all([
          readStoredConsent(),
          readPinRecord(),
          SecureStore.getItemAsync(DEMO_SESSION_KEY),
          SecureStore.getItemAsync(DEMO_FINISHED_KEY),
        ]);

        if (!mounted) return;

        setConsent(savedConsent);
        setHasSavedPin(!!savedPin);

        if (
          savedPin &&
          session === 'active' &&
          finished === 'yes'
        ) {
          setCurrentScreen('Main');
        } else if (savedPin) {
          setCurrentScreen('PinLogin');
        } else if (session === 'active') {
          setCurrentScreen(
            savedConsent
              ? 'AccountAuth'
              : 'Agreement'
          );
        } else {
          setCurrentScreen('Login');
        }
      } catch (error) {
        console.warn('앱 복원 실패:', error);

        if (mounted) {
          setCurrentScreen('Login');
        }
      } finally {
        if (mounted) {
          setIsRestoring(false);
        }
      }
    };

    restoreApp();

    return () => {
      mounted = false;
    };
  }, []);

  // =====================================
  // 로그인
  // =====================================

  const handleLogin = async (userId, password) => {
    if (!__DEV__ && Platform.OS !== 'web') {
      throw new Error(
        '실제 로그인 서버가 아직 연결되지 않았습니다.'
      );
    }

    const isPublicDemo =
      userId === 'demo' &&
      password === '1234';

    const isSignupDemo =
      demoAccount?.id === userId &&
      demoAccount?.password === password;

    if (!isPublicDemo && !isSignupDemo) {
      throw new Error(
        '시연용 로그인은 demo / 1234 또는 방금 가입한 테스트 계정을 사용하세요.'
      );
    }

    await SecureStore.setItemAsync(
      DEMO_SESSION_KEY,
      'active'
    );

    const [
      savedConsent,
      savedPin,
      finished,
    ] = await Promise.all([
      readStoredConsent(),
      readPinRecord(),
      SecureStore.getItemAsync(DEMO_FINISHED_KEY),
    ]);

    setConsent(savedConsent);
    setHasSavedPin(!!savedPin);

    if (!savedConsent) {
      setCurrentScreen('Agreement');
    } else if (!savedPin) {
      setCurrentScreen('AccountAuth');
    } else {
      setCurrentScreen(
        finished === 'yes'
          ? 'Main'
          : 'MyDataLoading'
      );
    }
  };

  // =====================================
  // 약관 동의 저장
  // =====================================

  const handleAgreementNext = async ({
    myDataAgreed,
  }) => {
    if (myDataAgreed !== true) {
      throw new Error(
        '마이데이터 활용 동의가 필요합니다.'
      );
    }

    const nextConsent = {
      version: CURRENT_CONSENT_VERSION,
      myDataAgreed: true,
      agreedAt: new Date().toISOString(),
    };

    await SecureStore.setItemAsync(
      DEMO_CONSENT_KEY,
      JSON.stringify(nextConsent)
    );

    setConsent(nextConsent);

    const finished = await SecureStore.getItemAsync(
      DEMO_FINISHED_KEY
    );

    if (hasSavedPin && finished === 'yes') {
      setCurrentScreen('Main');
    } else if (hasSavedPin) {
      setCurrentScreen('MyDataLoading');
    } else {
      setCurrentScreen('AccountAuth');
    }
  };

  // =====================================
  // 계좌 연동 + 간편비밀번호 등록
  // 끝나면 평소 일과 등록 화면으로 이동
  // =====================================

  const handleAccountPinComplete = async (pin) => {
    if (!__DEV__ && Platform.OS !== 'web') {
      throw new Error(
        '개발용 PIN 등록 기능입니다.'
      );
    }

    if (!/^\d{6}$/.test(pin)) {
      throw new Error(
        '6자리 숫자를 입력해주세요.'
      );
    }

    const salt = await createPinSalt();
    const hash = await pinHash(salt, pin);

    await SecureStore.setItemAsync(
      DEMO_PIN_KEY,
      JSON.stringify({
        version: 1,
        salt,
        hash,
      })
    );

    await SecureStore.deleteItemAsync(
      DEMO_PIN_ATTEMPTS_KEY
    );

    await SecureStore.setItemAsync(
      DEMO_SESSION_KEY,
      'active'
    );

    setHasSavedPin(true);

    const finished = await SecureStore.getItemAsync(
      DEMO_FINISHED_KEY
    );

    setRoutineReturnTo(
      finished === 'yes'
        ? 'Main'
        : 'MyDataLoading'
    );

    setCurrentScreen('DailyRoutine');
  };

  // =====================================
  // 간편비밀번호 로그인
  // =====================================

  const handleVerifyPin = async (pin) => {
    if (!__DEV__ && Platform.OS !== 'web') {
      throw new Error(
        '개발용 PIN 확인 기능입니다.'
      );
    }

    const record = await readPinRecord();

    if (!record) {
      throw new Error(
        '저장된 간편비밀번호가 없습니다. 아이디로 로그인해주세요.'
      );
    }

    let attempt = {
      count: 0,
      lockedUntil: 0,
    };

    const attemptRaw = await SecureStore.getItemAsync(
      DEMO_PIN_ATTEMPTS_KEY
    );

    if (attemptRaw) {
      try {
        attempt = JSON.parse(attemptRaw);
      } catch {
        attempt = {
          count: 0,
          lockedUntil: 0,
        };
      }
    }

    const now = Date.now();

    if (attempt.lockedUntil > now) {
      const remain = Math.ceil(
        (attempt.lockedUntil - now) / 1000
      );

      throw new Error(
        `5회 연속 실패했습니다. ${remain}초 뒤에 다시 시도해주세요.`
      );
    }

    if (
      attempt.lockedUntil &&
      attempt.lockedUntil <= now
    ) {
      attempt = {
        count: 0,
        lockedUntil: 0,
      };
    }

    const hash = await pinHash(
      record.salt,
      pin
    );

    if (hash !== record.hash) {
      const nextCount =
        (attempt.count || 0) + 1;

      if (nextCount >= MAX_WRONG_ATTEMPTS) {
        await SecureStore.setItemAsync(
          DEMO_PIN_ATTEMPTS_KEY,
          JSON.stringify({
            count: 0,
            lockedUntil: now + LOCK_DURATION_MS,
          })
        );

        throw new Error(
          '5회 틀렸습니다. 60초 동안 간편 로그인 입력이 제한됩니다.'
        );
      }

      await SecureStore.setItemAsync(
        DEMO_PIN_ATTEMPTS_KEY,
        JSON.stringify({
          count: nextCount,
          lockedUntil: 0,
        })
      );

      throw new Error(
        `비밀번호가 다릅니다. 남은 시도: ${
          MAX_WRONG_ATTEMPTS - nextCount
        }회`
      );
    }

    await SecureStore.deleteItemAsync(
      DEMO_PIN_ATTEMPTS_KEY
    );

    await SecureStore.setItemAsync(
      DEMO_SESSION_KEY,
      'active'
    );

    const [
      savedConsent,
      finished,
    ] = await Promise.all([
      readStoredConsent(),
      SecureStore.getItemAsync(DEMO_FINISHED_KEY),
    ]);

    setConsent(savedConsent);

    if (!savedConsent) {
      setCurrentScreen('Agreement');
    } else {
      setCurrentScreen(
        finished === 'yes'
          ? 'Main'
          : 'MyDataLoading'
      );
    }
  };

  // =====================================
  // 마이데이터 분석 완료
  // =====================================

  const handleFinishDemo = async () => {
    try {
      await SecureStore.setItemAsync(
        DEMO_FINISHED_KEY,
        'yes'
      );
    } catch {
      Alert.alert(
        '저장 실패',
        '진행 상태 저장에 실패했어요.'
      );
    }

    setCurrentScreen('Main');
  };

  // =====================================
  // 시연용 회원가입
  // =====================================

  const handleDemoSignUp = (account) => {
    if (account?.id && account?.password) {
      setDemoAccount({
        id: account.id,
        password: account.password,
      });
    }

    setCurrentScreen('Login');
  };

  // =====================================
  // 로그아웃
  // =====================================

  const handleLogout = async () => {
    try {
      await SecureStore.deleteItemAsync(
        DEMO_SESSION_KEY
      );

      setShowDevMenu(false);
      setSpecialScheduleOpen(false);

      setCurrentScreen(
        hasSavedPin
          ? 'PinLogin'
          : 'Login'
      );
    } catch {
      Alert.alert(
        '로그아웃 오류',
        '다시 시도해주세요.'
      );
    }
  };

  // =====================================
  // 메인에서 평소 일과 수정
  // =====================================

  const openDailyRoutine = () => {
    setRoutineReturnTo('Main');
    setCurrentScreen('DailyRoutine');
  };

  // =====================================
  // 개발자 메뉴
  // =====================================

  const moveToScreen = (screen) => {
    if (screen === 'DailyRoutine') {
      setRoutineReturnTo('Main');
    }

    setCurrentScreen(screen);
    setShowDevMenu(false);
    setSpecialScheduleOpen(false);
  };

  // =====================================
  // 초기 로딩
  // =====================================

  if (isRestoring) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator
          size="large"
          color="#1A237E"
        />

        <Text style={styles.loadingText}>
          앱 상태 불러오는 중...
        </Text>
      </View>
    );
  }

  // =====================================
  // 전체 화면
  // =====================================

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' && (
        <View style={styles.demoBanner}>
          <Text style={styles.demoBannerText}>
            발표용 시뮬레이터 · 실명/실제 비밀번호 입력 금지 · 실제 결제/가입 아님
          </Text>
        </View>
      )}

      {/* 아이디 로그인 */}
      {currentScreen === 'Login' && (
        <LoginScreen
          onLogin={handleLogin}
          onSignUp={() =>
            setCurrentScreen('SignUp')
          }
          demoAccountReady={Boolean(demoAccount)}
        />
      )}

      {/* PIN 로그인 */}
      {currentScreen === 'PinLogin' && (
        <PinLoginScreen
          onVerify={handleVerifyPin}
          onUsePassword={() =>
            setCurrentScreen('Login')
          }
        />
      )}

      {/* 회원가입 */}
      {currentScreen === 'SignUp' && (
        <SignUpScreen
          onBack={() =>
            setCurrentScreen('Login')
          }
          onComplete={handleDemoSignUp}
          isIdTaken={(candidate) =>
            candidate === 'demo' ||
            candidate === demoAccount?.id
          }
        />
      )}

      {/* 약관 동의 */}
      {currentScreen === 'Agreement' && (
        <AgreementScreen
          initialConsent={consent}
          onBack={handleLogout}
          onNext={handleAgreementNext}
        />
      )}

      {/* 계좌 및 자산 연동 */}
      {currentScreen === 'AccountAuth' && (
        <AccountAuthScreen
          onBack={() =>
            setCurrentScreen('Agreement')
          }
          onNext={handleAccountPinComplete}
        />
      )}

      {/* 평소 일과 등록 */}
      {currentScreen === 'DailyRoutine' && (
        <DailyRoutineScreen
          onContinue={() =>
            setCurrentScreen(routineReturnTo)
          }
          onBack={() =>
            setCurrentScreen(
              routineReturnTo === 'Main'
                ? 'Main'
                : 'AccountAuth'
            )
          }
        />
      )}

      {/* 마이데이터 분석 */}
      {currentScreen === 'MyDataLoading' && (
        <MyDataLoadingScreen
          onNext={() =>
            setCurrentScreen('MyDataResult')
          }
        />
      )}

      {/* 마이데이터 분석 결과 */}
      {currentScreen === 'MyDataResult' && (
        <MyDataScreen
          onNext={handleFinishDemo}
        />
      )}

      {/* 메인 상단 일과 관리 영역 */}
      {currentScreen === 'Main' && (
        <View style={styles.routinePanel}>
          <View style={styles.routineTitleArea}>
            <Text style={styles.routineTitle}>
              🗓️ 오늘의 일과
            </Text>

            <Text style={styles.routineSubtitle}>
              평소와 다른 일정이 있으신가요?
            </Text>
          </View>

          <View style={styles.routineActions}>
            <TouchableOpacity
              style={styles.routineSecondaryButton}
              onPress={openDailyRoutine}
              accessibilityRole="button"
            >
              <Text style={styles.routineSecondaryText}>
                평소 일과 수정
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.routinePrimaryButton}
              onPress={() =>
                setSpecialScheduleOpen(true)
              }
              accessibilityRole="button"
            >
              <Text style={styles.routinePrimaryText}>
                + 특별 일정 기록
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 기존 메인 화면 */}
      {currentScreen === 'Main' && (
        <MainScreen
          walletCards={walletCards}
          activeCardId={activeCardId}
          onSelectCard={setActiveCardId}
          onLogout={handleLogout}
        />
      )}

      {/* 기존 결제 화면 */}
      {currentScreen === 'Payment' && (
        <PaymentScreen
          card={activeCard}
          cards={walletCards}
          onSelectCard={setActiveCardId}
          onClose={() =>
            setCurrentScreen('Main')
          }
        />
      )}

      {/* 메인 화면의 특별 일정 등록 창 */}
      <SpecialScheduleModal
        visible={specialScheduleOpen}
        onClose={() =>
          setSpecialScheduleOpen(false)
        }
      />

      {/* 발표용 화면 이동 */}
      {SHOW_SCREEN_NAVIGATION && (
        <>
          {showDevMenu && (
            <View style={styles.devMenu}>
              <Text style={styles.devTitle}>
                🛠 개발자 화면 이동
              </Text>

              <Text style={styles.devSubtitle}>
                이동할 화면을 선택하세요.
              </Text>

              <ScrollView
                style={styles.devScroll}
                nestedScrollEnabled
              >
                {DEV_SCREENS.filter(
                  (item) =>
                    item.key !== 'PinLogin' ||
                    hasSavedPin
                ).map((screen) => {
                  const active =
                    currentScreen === screen.key;

                  return (
                    <TouchableOpacity
                      key={screen.key}
                      style={[
                        styles.devMenuItem,
                        active &&
                          styles.devMenuItemActive,
                      ]}
                      onPress={() =>
                        moveToScreen(screen.key)
                      }
                    >
                      <Text
                        style={[
                          styles.devMenuText,
                          active &&
                            styles.devMenuTextActive,
                        ]}
                      >
                        {screen.label}
                      </Text>

                      {active && (
                        <Text style={styles.activeMark}>
                          ✓
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.devNotice}>
                발표·개발용 화면 이동 메뉴입니다.
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.devFloatingButton}
            onPress={() =>
              setShowDevMenu(!showDevMenu)
            }
          >
            <Text style={styles.devFloatingText}>
              {showDevMenu
                ? '✕ 닫기'
                : '🔧 화면 이동'}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// =====================================
// 전체 스타일
// =====================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  demoBanner: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#EAF1FF',
    alignItems: 'center',
  },

  demoBannerText: {
    color: '#245196',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },

  loadingText: {
    marginTop: 14,
    fontSize: 14,
    color: '#767676',
  },

  // 메인 일과 관리 영역
  routinePanel: {
    backgroundColor: '#EDF4FF',
    borderBottomWidth: 1,
    borderBottomColor: '#DDE8FA',
    paddingHorizontal: 15,
    paddingVertical: 13,
    gap: 11,
  },

  routineTitleArea: {
    gap: 5,
  },

  routineTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#204580',
  },

  routineSubtitle: {
    fontSize: 12,
    color: '#637DAB',
  },

  routineActions: {
    flexDirection: 'row',
    gap: 8,
  },

  routinePrimaryButton: {
    flex: 1,
    backgroundColor: '#245DE5',
    borderRadius: 11,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },

  routinePrimaryText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },

  routineSecondaryButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D9F7',
    borderRadius: 11,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },

  routineSecondaryText: {
    color: '#315C9D',
    fontSize: 12,
    fontWeight: '800',
  },

  // 발표용 화면 이동
  devFloatingButton: {
    position: 'absolute',
    bottom: 35,
    right: 16,
    backgroundColor: '#222222',
    paddingHorizontal: 17,
    paddingVertical: 13,
    borderRadius: 30,
    elevation: 20,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },

  devFloatingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },

  devMenu: {
    position: 'absolute',
    bottom: 95,
    right: 16,
    width: 235,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 15,
    elevation: 20,
    zIndex: 9998,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },

  devTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111111',
    marginBottom: 5,
  },

  devSubtitle: {
    fontSize: 11,
    color: '#888888',
    marginBottom: 12,
  },

  devScroll: {
    maxHeight: 350,
  },

  devMenuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 3,
    backgroundColor: '#F8F9FA',
  },

  devMenuItemActive: {
    backgroundColor: '#E8F0FF',
  },

  devMenuText: {
    color: '#333333',
    fontSize: 13,
    fontWeight: '500',
  },

  devMenuTextActive: {
    color: '#0046FF',
    fontWeight: 'bold',
  },

  activeMark: {
    color: '#0046FF',
    fontSize: 15,
    fontWeight: 'bold',
  },

  devNotice: {
    textAlign: 'center',
    color: '#AAAAAA',
    fontSize: 10,
    marginTop: 10,
  },
});
