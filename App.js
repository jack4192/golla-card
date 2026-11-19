import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Alert } from './utils/demoAlert';
import * as DemoStore from './utils/demoStore';
import { createPinSalt, hashPin } from './utils/pinCrypto';
import {
  deleteDemoData,
  hasPendingReset,
} from './utils/privacyData';
import {
  buildWallet,
  readWallet,
  saveWalletSelection,
  validWalletId,
  waitForWalletWrites,
  walletIdForCode,
} from './utils/wallet';

import LoginScreen from './screens/LoginScreen';
import PinLoginScreen from './screens/PinLoginScreen';
import PinSetupScreen from './screens/PinSetupScreen';
import { DEMO_EMAIL, isValidEmail, normalizeEmail } from './utils/demoEmail';
import SignUpScreen, { isValidPhone, isValidSignUpPassword } from './screens/SignUpScreen';
import AgreementScreen from './screens/AgreementScreen';
import DetailedRoutineScreen from './screens/DetailedRoutineScreen';
import RoutineRecommendationScreen from './screens/RoutineRecommendationScreen';
import MyDataLoadingScreen from './screens/MyDataLoadingScreen';
import MyDataScreen from './screens/MyDataScreen';
import MainScreen from './screens/MainScreen';
import PaymentScreen from './screens/PaymentScreen';

import PrivacyDataModal from './components/PrivacyDataModal';

import {
  DEMO_WALLET_CARDS,
  getActiveWalletCard,
} from './data/cards';

const SESSION_KEY = 'solpay_demo_session_v1';
const ACCOUNT_KEY = 'solpay_demo_account_v1';
const FULL_LOGOUT_KEY = 'solpay_demo_full_logout_v1';
const FINISHED_KEY = 'solpay_demo_onboarding_v1';
const CONSENT_KEY = 'solpay_demo_consent_v1';
const PIN_KEY = 'solpay_demo_pin_v1';
const ATTEMPTS_KEY = 'solpay_demo_pin_attempts_v1';
const LEGACY_CONSENT_VERSION = 'solpay-demo-consent-v1';
const LEGACY_OPTIONS_VERSION = 'solpay-onboarding-options-v2';
const ONBOARDING_OPTIONS_VERSION = 'solpay-onboarding-options-v3';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60000;
const PIN_SESSION_STATES = new Set(['active', 'locked']);

const DEV_SCREENS = [
  { key: 'Login', label: '1. 이메일 로그인' },
  { key: 'SignUp', label: '1-1. 회원가입' },
  { key: 'PinLogin', label: '기존 이용자 · PIN 로그인' },
  { key: 'Agreement', label: '2. 서비스 이용 동의' },
  { key: 'PinSetup', label: '3. 간편비밀번호 설정' },
  { key: 'DailyRoutine', label: '4. 오늘의 특별 일정' },
  { key: 'RoutineRecommendation', label: '5. 일과 맞춤 카드 추천' },
  { key: 'Main', label: '6. 메인 화면' },
  { key: 'Payment', label: '7. 결제 화면' },
  { key: 'MyDataLoading', label: '소비 분석 불러오기' },
  { key: 'MyDataResult', label: '소비 분석 결과' },
];

async function readConsent() {
  const raw = await DemoStore.getItemAsync(CONSENT_KEY);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw);
    if (value?.version === ONBOARDING_OPTIONS_VERSION && value.termsAgreed === true && typeof value.savedAt === 'string') {
      return value;
    }
    if (value?.version === LEGACY_OPTIONS_VERSION) {
      return { morningNotificationAgreed: value.morningNotificationAgreed === true };
    }
    if (value?.version === LEGACY_CONSENT_VERSION && value.myDataAgreed === true) {
      return { morningNotificationAgreed: false };
    }
    return null;
  } catch {
    return null;
  }
}

async function readPin() {
  const raw = await DemoStore.getItemAsync(PIN_KEY);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw);

    return value?.version === 1 &&
      typeof value.salt === 'string' &&
      typeof value.hash === 'string' &&
      /^[a-f0-9]{32}$/i.test(value.salt) &&
      /^[a-f0-9]{64}$/i.test(value.hash)
      ? value
      : null;
  } catch {
    return null;
  }
}

async function readDemoAccount() {
  const raw = await DemoStore.getItemAsync(ACCOUNT_KEY);
  if (!raw) return null;

  try {
    const account = JSON.parse(raw);
    return account?.version === 1 &&
      isValidEmail(account.email) && /^01\d{9}$/.test(account.phone) &&
      /^[a-f0-9]{32}$/i.test(account.salt) && /^[a-f0-9]{64}$/i.test(account.hash) &&
      typeof account.firstLogin === 'boolean' ? account : null;
  } catch {
    return null;
  }
}

async function readAttempts(now) {
  const raw = await DemoStore.getItemAsync(ATTEMPTS_KEY);
  if (!raw) return { count: 0, lockedUntil: 0 };

  try {
    const value = JSON.parse(raw);

    if (
      !value ||
      Array.isArray(value) ||
      !Number.isInteger(value.count) ||
      value.count < 0 ||
      value.count >= MAX_ATTEMPTS ||
      !Number.isSafeInteger(value.lockedUntil) ||
      value.lockedUntil < 0
    ) {
      throw Error('invalid');
    }

    return value.lockedUntil && value.lockedUntil <= now
      ? { count: 0, lockedUntil: 0 }
      : value;
  } catch {
    const locked = {
      count: 0,
      lockedUntil: now + LOCK_MS,
    };

    await DemoStore.setItemAsync(
      ATTEMPTS_KEY,
      JSON.stringify(locked)
    );

    return locked;
  }
}

export default function App() {
  const [demoAccount, setDemoAccount] = useState(null);
  const [walletCards, setWalletCards] = useState(DEMO_WALLET_CARDS);
  const [walletWarning, setWalletWarning] = useState('');

  const selectedCardRef = useRef(DEMO_WALLET_CARDS[0].id);
  const walletRevision = useRef(0);

  const [activeCardId, setActiveCardId] = useState(
    DEMO_WALLET_CARDS[0].id
  );

  const activeCard = getActiveWalletCard(
    walletCards,
    activeCardId
  );

  const [currentScreen, setCurrentScreen] = useState('Login');
  const [isRestoring, setIsRestoring] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [allowAutomaticAds, setAllowAutomaticAds] = useState(false);
  const [consent, setConsent] = useState(null);
  const [consentDraft, setConsentDraft] = useState(null);
  const [hasSavedPin, setHasSavedPin] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState({});
  const [routineMode, setRoutineMode] = useState('onboarding');

  const [showDevMenu, setShowDevMenu] = useState(false);
  const [previewScreen, setPreviewScreen] = useState(null);

  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const [dataEpoch, setDataEpoch] = useState(0);

  const actionBusy = useRef(false);

  useEffect(() => {
    let active = true;

    const restore = async () => {
      if (await hasPendingReset()) {
        if (active) {
          setResetPending(true);
          setPrivacyOpen(true);
          setCurrentScreen('Login');
        }
        return;
      }

      const [savedConsent, savedPin, fullLogout, finished, savedAccount, session] = await Promise.all([
        readConsent(),
        readPin(),
        DemoStore.getItemAsync(FULL_LOGOUT_KEY),
        DemoStore.getItemAsync(FINISHED_KEY),
        readDemoAccount(),
        DemoStore.getItemAsync(SESSION_KEY),
      ]);

      if (!active) return;

      const completed = !savedAccount?.firstLogin && finished === 'yes' &&
        savedConsent?.termsAgreed === true && Boolean(savedPin);
      setDemoAccount(savedAccount);
      setConsent(savedConsent);
      setHasSavedPin(Boolean(savedPin) && !savedAccount?.firstLogin);
      setOnboardingComplete(completed);
      const canUsePin = !fullLogout && completed && PIN_SESSION_STATES.has(session);
      setCurrentScreen(canUsePin ? 'PinLogin' : 'Login');
    };

    restore()
      .catch(() => {
        if (active) setCurrentScreen('Login');
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    Keyboard.dismiss();
  }, [currentScreen, previewScreen]);

  const navigate = screen => {
    setShowDevMenu(false);
    setCurrentScreen(screen);
  };

  const runAction = async action => {
    if (actionBusy.current) {
      throw Error('처리 중입니다. 잠시 기다려주세요.');
    }

    actionBusy.current = true;

    try {
      if (resetPending || await hasPendingReset()) {
        setResetPending(true);
        setPrivacyOpen(true);

        throw Error(
          '데이터 관리에서 진행 중인 계정 초기화를 먼저 완료해주세요.'
        );
      }

      return await action();
    } finally {
      actionBusy.current = false;
    }
  };

  const requireAuthentication = () => {
    if (!authenticated) {
      throw Error('먼저 로그인해주세요.');
    }
  };

  const reloadWallet = async () => {
    const revision = ++walletRevision.current;

    try {
      const savedConsent = await readConsent();
      const snapshot = await readWallet(savedConsent?.myDataAgreed === true);
      if (revision !== walletRevision.current) return;

      setWalletCards(snapshot.cards);
      selectedCardRef.current = snapshot.id;
      setActiveCardId(snapshot.id);
      setWalletWarning(snapshot.warning);
    } catch {
      if (revision !== walletRevision.current) return;

      setWalletCards(DEMO_WALLET_CARDS);
      selectedCardRef.current = DEMO_WALLET_CARDS[0].id;
      setActiveCardId(DEMO_WALLET_CARDS[0].id);
      setWalletWarning(
        '등록한 카드를 읽지 못했습니다. 기존 기록을 덮어쓰지 않았습니다.'
      );
    }
  };

  const handleSelectCard = id => {
    if (
      actionBusy.current ||
      !authenticated ||
      !walletCards.some(card => card.id === id)
    ) {
      return;
    }

    walletRevision.current += 1;
    selectedCardRef.current = id;
    setActiveCardId(id);

    saveWalletSelection(id)
      .then(() => {
        if (selectedCardRef.current === id) {
          setWalletWarning('');
        }
      })
      .catch(() => {
        if (selectedCardRef.current === id) {
          setWalletWarning(
            '카드는 선택됐지만 저장하지 못했습니다. 같은 카드를 다시 선택해 저장해주세요.'
          );
        }
      });
  };

  const handlePreferencesSaved = async preferences => {
    if (!authenticated || previewScreen || privacyBusy) return;

    walletRevision.current += 1;

    const cards = buildWallet(preferences, consent?.myDataAgreed === true);
    const id = validWalletId(cards, selectedCardRef.current);

    setWalletCards(cards);
    selectedCardRef.current = id;
    setActiveCardId(id);

    try {
      await saveWalletSelection(id);
      setWalletWarning('');
    } catch {
      setWalletWarning(
        '지갑 선택 상태를 저장하지 못했습니다. 다시 저장해주세요.'
      );

      throw Error(
        '보유 목록은 저장됐지만 지갑 선택 상태를 저장하지 못했습니다. 다시 시도해주세요.'
      );
    }
  };

  const handleUseCard = code => runAction(async () => {
    requireAuthentication();

    const snapshot = await readWallet(consent?.myDataAgreed === true);

    if (!snapshot.preferences.owned.includes(code)) {
      throw Error('보유 카드로 등록하고 저장한 후 선택해주세요.');
    }

    const id = walletIdForCode(code);

    if (
      !snapshot.cards.some(
        card => card.id === id && card.isManuallyRegistered
      )
    ) {
      throw Error('등록된 카드를 찾지 못했습니다. 다시 저장해주세요.');
    }

    await saveWalletSelection(id);

    walletRevision.current += 1;
    setWalletCards(snapshot.cards);
    selectedCardRef.current = id;
    setActiveCardId(id);
    setWalletWarning('');
    navigate('Payment');
  });

  const afterAuthentication = async ({ firstSignupLogin = false } = {}) => {
    const [savedConsent, savedPin, finished] = await Promise.all([
      readConsent(),
      readPin(),
      DemoStore.getItemAsync(FINISHED_KEY),
    ]);

    await DemoStore.deleteItemAsync(FULL_LOGOUT_KEY);
    await DemoStore.setItemAsync(SESSION_KEY, 'active');

    const completed = finished === 'yes' && savedConsent?.termsAgreed === true && Boolean(savedPin);
    setAuthenticated(true);
    setAllowAutomaticAds(completed && !firstSignupLogin);
    setConsent(savedConsent);
    setHasSavedPin(Boolean(savedPin));
    setOnboardingComplete(completed);
    setRoutineMode('onboarding');

    await reloadWallet();

    if (savedConsent?.termsAgreed !== true) {
      navigate('Agreement');
    } else if (!savedPin) {
      navigate('PinSetup');
    } else {
      navigate(completed ? 'Main' : 'DailyRoutine');
    }
  };

  const handleLogin = (email, password) => runAction(async () => {
    if (!__DEV__ && Platform.OS !== 'web') {
      throw Error('현재 이메일 로그인을 사용할 수 없어요.');
    }

    const address = normalizeEmail(email);
    if (!isValidEmail(address)) throw Error('올바른 이메일 형식을 입력해주세요.');

    const customMatches =
      demoAccount?.email === address && typeof password === 'string'
        ? await hashPin(demoAccount.salt, password) === demoAccount.hash
        : false;

    const valid =
      (address === DEMO_EMAIL && password === '1234') ||
      customMatches;

    if (!valid) {
      throw Error('이메일 또는 비밀번호를 확인해주세요.');
    }

    if (demoAccount?.firstLogin && !customMatches) {
      throw Error('가입을 마치려면 방금 등록한 이메일로 로그인해주세요.');
    }

    const firstSignupLogin = customMatches && demoAccount.firstLogin === true;
    if (firstSignupLogin) {
      // A new demo registration starts onboarding even on a previously used device.
      for (const key of [FINISHED_KEY, CONSENT_KEY, PIN_KEY, ATTEMPTS_KEY]) {
        await DemoStore.deleteItemAsync(key);
      }
      const account = { ...demoAccount, firstLogin: false };
      await DemoStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
      setDemoAccount(account);
      setConsentDraft(null);
      setScheduleEditor({});
    }
    await afterAuthentication({ firstSignupLogin });
  });

  const handleVerifyPin = pin => runAction(async () => {
    if (!__DEV__ && Platform.OS !== 'web') {
      throw Error('현재 간편비밀번호로 로그인할 수 없어요.');
    }

    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      throw Error('6자리 숫자를 입력해주세요.');
    }

    if (!onboardingComplete || demoAccount?.firstLogin) {
      throw Error('이메일로 로그인한 뒤 가입 절차를 완료해주세요.');
    }

    const [fullLogout, session] = await Promise.all([
      DemoStore.getItemAsync(FULL_LOGOUT_KEY),
      DemoStore.getItemAsync(SESSION_KEY),
    ]);
    if (fullLogout || !PIN_SESSION_STATES.has(session)) {
      throw Error('로그아웃한 상태입니다. 이메일과 비밀번호로 로그인해주세요.');
    }

    const record = await readPin();

    if (!record) {
      throw Error(
        '등록된 간편비밀번호가 없습니다. 이메일로 로그인해주세요.'
      );
    }

    const now = Date.now();
    const attempts = await readAttempts(now);

    if (attempts.lockedUntil > now) {
      const seconds = Math.ceil(
        (attempts.lockedUntil - now) / 1000
      );

      throw Error(`${seconds}초 뒤에 다시 시도해주세요.`);
    }

    const candidate = await hashPin(record.salt, pin);

    if (candidate !== record.hash) {
      const count = attempts.count + 1;
      const lock = count >= MAX_ATTEMPTS;

      await DemoStore.setItemAsync(
        ATTEMPTS_KEY,
        JSON.stringify({
          count: lock ? 0 : count,
          lockedUntil: lock ? now + LOCK_MS : 0,
        })
      );

      throw Error(
        lock
          ? '5회 실패했습니다. 60초 동안 입력이 제한됩니다.'
          : `비밀번호가 다릅니다. 남은 시도: ${MAX_ATTEMPTS - count}회`
      );
    }

    await DemoStore.deleteItemAsync(ATTEMPTS_KEY);
    await afterAuthentication();
  });

  const handleAgreementNext = value => runAction(async () => {
    requireAuthentication();

    if (value?.termsAgreed !== true) {
      throw Error('필수 이용 약관을 확인해주세요.');
    }

    const nextConsent = {
      version: ONBOARDING_OPTIONS_VERSION,
      savedAt: new Date().toISOString(),
      termsAgreed: true,
      myDataAgreed: value.myDataAgreed === true,
      morningNotificationAgreed: value.morningNotificationAgreed === true,
    };

    await DemoStore.setItemAsync(
      CONSENT_KEY,
      JSON.stringify(nextConsent)
    );

    setConsent(nextConsent);
    setConsentDraft(nextConsent);
    await reloadWallet();

    const [pin, finished] = await Promise.all([
      readPin(),
      DemoStore.getItemAsync(FINISHED_KEY),
    ]);

    const completed = Boolean(pin) && finished === 'yes';
    setHasSavedPin(Boolean(pin));
    setOnboardingComplete(completed);
    navigate(!pin ? 'PinSetup' : completed ? 'Main' : 'DailyRoutine');
  });

  const handlePinSetup = pin => runAction(async () => {
    requireAuthentication();

    if (!__DEV__ && Platform.OS !== 'web') {
      throw Error('현재 간편비밀번호를 등록할 수 없어요.');
    }

    if (consent?.termsAgreed !== true) {
      throw Error('필수 이용 약관에 먼저 동의해주세요.');
    }

    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      throw Error('6자리 숫자를 입력해주세요.');
    }

    if (await readPin()) {
      throw Error(
        'PIN이 이미 등록되어 있습니다. 메인 설정에서 변경해주세요.'
      );
    }

    const salt = await createPinSalt();
    const hash = await hashPin(salt, pin);

    await DemoStore.deleteItemAsync(ATTEMPTS_KEY);
    await DemoStore.setItemAsync(
      PIN_KEY,
      JSON.stringify({ version: 1, salt, hash })
    );

    setHasSavedPin(true);
    setRoutineMode('onboarding');
    navigate('DailyRoutine');
  });

  const handlePinContinue = () => {
    if (!authenticated || !hasSavedPin) return;
    navigate('DailyRoutine');
  };

  const handleRoutineContinue = () => {
    if (!authenticated) return;
    navigate('RoutineRecommendation');
  };

  const handleFinishDemo = async () => {
    if (actionBusy.current) return;

    actionBusy.current = true;

    try {
      requireAuthentication();

      if ((await readConsent())?.termsAgreed !== true || !(await readPin())) {
        throw Error(
          '필수 이용 약관 동의와 간편비밀번호 설정을 먼저 완료해주세요.'
        );
      }

      await DemoStore.setItemAsync(FINISHED_KEY, 'yes');
      await reloadWallet();

      setOnboardingComplete(true);
      setRoutineMode('edit');
      navigate('Main');
    } catch (error) {
      Alert.alert(
        '진행 상태 저장 실패',
        error?.message || '다시 시도해주세요.'
      );
    } finally {
      actionBusy.current = false;
    }
  };

  const handleLogout = async (mode = 'logout') => {
    if (actionBusy.current) return;
    actionBusy.current = true;

    try {
      const lock = mode === 'lock';
      if (lock && !await readPin()) {
        Alert.alert('간편비밀번호 미설정', '간편비밀번호를 먼저 등록해주세요.');
        return;
      }
      if (lock) {
        await DemoStore.setItemAsync(SESSION_KEY, 'locked');
      } else {
        await DemoStore.setItemAsync(FULL_LOGOUT_KEY, 'yes');
        await DemoStore.deleteItemAsync(SESSION_KEY);
      }
      setAuthenticated(false);
      setAllowAutomaticAds(false);
      setConsentDraft(null);
      setScheduleEditor({});
      setPreviewScreen(null);

      walletRevision.current += 1;
      setWalletCards(DEMO_WALLET_CARDS);
      selectedCardRef.current = DEMO_WALLET_CARDS[0].id;
      setActiveCardId(DEMO_WALLET_CARDS[0].id);
      setWalletWarning('');

      navigate(lock ? 'PinLogin' : 'Login');
    } catch {
      Alert.alert('화면 전환 실패', '다시 시도해주세요.');
    } finally {
      actionBusy.current = false;
    }
  };

  const isDemoEmailTaken = value => {
    const address = normalizeEmail(value);
    return address === DEMO_EMAIL || address === demoAccount?.email;
  };

  const isDemoPhoneTaken = phone => demoAccount?.phone === phone;

  const handleDemoSignUp = account => runAction(async () => {
    if (
      typeof account?.email !== 'string' ||
      !isValidEmail(account.email) ||
      !isValidPhone(account.phone) ||
      !isValidSignUpPassword(account.password)
    ) {
      throw Error('가입 정보를 확인해주세요.');
    }

    const email = normalizeEmail(account.email);

    if (isDemoEmailTaken(email)) {
      throw Error('이미 사용 중인 이메일입니다.');
    }

    if (isDemoPhoneTaken(account.phone)) {
      throw Error('이미 사용 중인 전화번호입니다.');
    }

    const salt = await createPinSalt();
    const hash = await hashPin(salt, account.password);

    const record = { version: 1, email, phone: account.phone, salt, hash, firstLogin: true };
    await DemoStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(record));
    setDemoAccount(record);
    setOnboardingComplete(false);
    navigate('Login');
  });

  const openPrivacy = () => {
    if (actionBusy.current || previewScreen) return;

    setShowDevMenu(false);
    setPrivacyOpen(true);
  };

  const handleDeleteData = async scope => {
    if (actionBusy.current || previewScreen) {
      throw Error('현재 처리가 끝난 후 다시 시도해주세요.');
    }

    if (!['personal', 'account'].includes(scope)) {
      throw Error('삭제 범위를 확인해주세요.');
    }

    if (resetPending && scope !== 'account') {
      throw Error('계정 초기화를 먼저 완료해주세요.');
    }

    actionBusy.current = true;
    setPrivacyBusy(true);

    walletRevision.current += 1;
    setWalletCards(DEMO_WALLET_CARDS);
    selectedCardRef.current = DEMO_WALLET_CARDS[0].id;
    setActiveCardId(DEMO_WALLET_CARDS[0].id);
    setWalletWarning('');

    setScheduleEditor({});
    setConsentDraft(null);
    setPreviewScreen(null);
    setShowDevMenu(false);

    if (scope === 'account') {
      setResetPending(true);
      setDemoAccount(null);
      setAuthenticated(false);
      setAllowAutomaticAds(false);
      setConsent(null);
      setHasSavedPin(false);
      setOnboardingComplete(false);
      setRoutineMode('onboarding');
      setActiveCardId(DEMO_WALLET_CARDS[0].id);
      setCurrentScreen('Login');
    }

    try {
      await waitForWalletWrites();

      const report = await deleteDemoData(scope);

      if (scope === 'personal') {
        await reloadWallet();
      }

      if (scope === 'account') {
        setResetPending(report.pending);
      }

      return report;
    } finally {
      setDataEpoch(value => value + 1);
      actionBusy.current = false;
      setPrivacyBusy(false);
    }
  };

  const openRoutine = (date, entryId) => {
    setScheduleEditor({ date, entryId });
    setRoutineMode('edit');
    navigate('DailyRoutine');
  };

  // 개발자 체험용 이동. 실제 로그인 상태는 변경하지 않습니다.
  const previewGo = screen => {
    Keyboard.dismiss();
    setPreviewScreen(screen);
    setShowDevMenu(false);
  };

  const toggleDevMenu = () => {
    if (actionBusy.current || privacyOpen || privacyBusy) return;
    Keyboard.dismiss();
    setShowDevMenu(visible => !visible);
  };

  const previewSelect = id => {
    if (!walletCards.some(card => card.id === id)) return;

    selectedCardRef.current = id;
    setActiveCardId(id);
  };

  const previewPreferences = async preferences => {
    const cards = buildWallet(preferences);
    const id = validWalletId(cards, selectedCardRef.current);

    setWalletCards(cards);
    selectedCardRef.current = id;
    setActiveCardId(id);
  };

  const previewUseCard = async code => {
    const snapshot = await readWallet();
    const id = walletIdForCode(code);

    if (!snapshot.cards.some(card => card.id === id)) {
      throw Error('보유 카드로 등록하고 저장해주세요.');
    }

    setWalletCards(snapshot.cards);
    selectedCardRef.current = id;
    setActiveCardId(id);

    previewGo('Payment');
  };

  const renderScreen = (screen, preview = false) => {
    // 개발자 미리보기: 입력과 버튼을 활성화하고 체험 경로에 연결합니다.
    if (preview) {
      switch (screen) {
        case 'Login':
          return (
            <LoginScreen
              onLogin={async () => previewGo('Agreement')}
              onSignUp={() => previewGo('SignUp')}
            />
          );

        case 'PinLogin':
          return (
            <PinLoginScreen
              onVerify={async pin => {
                if (!/^\d{6}$/.test(pin)) {
                  throw Error('6자리 숫자를 입력해주세요.');
                }

                previewGo('Main');
              }}
              onUsePassword={() => previewGo('Login')}
            />
          );

        case 'SignUp':
          return (
            <SignUpScreen
              onBack={() => previewGo('Login')}
              onComplete={() => previewGo('Login')}
              isEmailTaken={isDemoEmailTaken}
              isPhoneTaken={isDemoPhoneTaken}
            />
          );

        case 'Agreement':
          return (
            <AgreementScreen
              initialDraft={consentDraft}
              onDraftChange={setConsentDraft}
              onBack={() => previewGo('Login')}
              onNext={async () => previewGo('PinSetup')}
            />
          );

        case 'PinSetup':
          return (
            <PinSetupScreen
              configured={false}
              readOnly={false}
              onBack={() => previewGo('Agreement')}
              onContinue={() => previewGo('DailyRoutine')}
              onNext={async () => previewGo('DailyRoutine')}
            />
          );

        case 'DailyRoutine':
          return (
            <DetailedRoutineScreen
              {...scheduleEditor}
              onBack={() => previewGo('Main')}
              onContinue={() => previewGo('RoutineRecommendation')}
            />
          );

        case 'RoutineRecommendation':
          return (
            <RoutineRecommendationScreen
              scheduleDate={scheduleEditor.date}
              onBack={() => previewGo('DailyRoutine')}
              onNext={async () => previewGo('Main')}
              onPreferencesChange={previewPreferences}
              onUseCard={previewUseCard}
            />
          );

        case 'MyDataLoading':
          return (
            <MyDataLoadingScreen
              onNext={() => previewGo('MyDataResult')}
            />
          );

        case 'MyDataResult':
          return (
            <MyDataScreen
              onNext={() => previewGo('RoutineRecommendation')}
            />
          );

        case 'Payment':
          return (
            <PaymentScreen
              card={activeCard}
              cards={walletCards}
              onSelectCard={previewSelect}
              onClose={() => previewGo('Main')}
              navigation={{
                navigate: target =>
                  previewGo(
                    target === 'MainScreen' ? 'Main' : target
                  ),
              }}
            />
          );

        case 'Main':
          return (
            <View style={styles.screen}>
              <MainScreen
                walletCards={walletCards}
                activeCardId={activeCardId}
                onSelectCard={previewSelect}
                onLogout={mode => previewGo(mode === 'lock' ? 'PinLogin' : 'Login')}
                canLock
                onEditRoutine={(date, entryId) => {
                  setScheduleEditor({ date, entryId });
                  previewGo('DailyRoutine');
                }}
                onViewBenefits={() =>
                  previewGo('RoutineRecommendation')
                }
                onOpenChat={() =>
                  Alert.alert(
                    '안내',
                    '카드 도우미는 홈에서 이용할 수 있어요.'
                  )
                }
              />

              <TouchableOpacity
                style={styles.pinLoginBack}
                onPress={() => previewGo('Payment')}
              >
                <Text style={styles.previewCloseText}>
                  선택한 카드로 결제 화면 열기
                </Text>
              </TouchableOpacity>
            </View>
          );

        default:
          return (
            <LoginScreen
              onLogin={async () => previewGo('Agreement')}
              onSignUp={() => previewGo('SignUp')}
            />
          );
      }
    }

    // 일반 사용자 흐름
    switch (screen) {
      case 'Login':
        return (
          <LoginScreen
            onLogin={handleLogin}
            onSignUp={() => navigate('SignUp')}
          />
        );

      case 'PinLogin':
        return (
          <PinLoginScreen
            onVerify={handleVerifyPin}
            onUsePassword={() => navigate('Login')}
          />
        );

      case 'SignUp':
        return (
          <SignUpScreen
            onBack={() => navigate('Login')}
            onComplete={handleDemoSignUp}
            isEmailTaken={isDemoEmailTaken}
            isPhoneTaken={isDemoPhoneTaken}
          />
        );

      case 'Agreement':
        return (
          <AgreementScreen
            initialConsent={consent}
            initialDraft={consentDraft}
            onDraftChange={setConsentDraft}
            onBack={() => navigate('Login')}
            onNext={handleAgreementNext}
          />
        );

      case 'PinSetup':
        return (
          <PinSetupScreen
            configured={hasSavedPin}
            readOnly={false}
            onContinue={handlePinContinue}
            onBack={() => navigate('Agreement')}
            onNext={handlePinSetup}
          />
        );

      case 'DailyRoutine':
        return (
          <DetailedRoutineScreen
            {...scheduleEditor}
            onContinue={handleRoutineContinue}
            onBack={() =>
              navigate(
                routineMode === 'edit' ? 'Main' : 'PinSetup'
              )
            }
          />
        );

      case 'RoutineRecommendation':
        return (
          <RoutineRecommendationScreen
            scheduleDate={scheduleEditor.date}
            onBack={() => navigate('DailyRoutine')}
            onNext={handleFinishDemo}
              includeMyData={consent?.myDataAgreed === true}
            onPreferencesChange={handlePreferencesSaved}
            onUseCard={handleUseCard}
          />
        );

      case 'MyDataLoading':
        return (
          <MyDataLoadingScreen
            onNext={() => navigate('MyDataResult')}
          />
        );

      case 'MyDataResult':
        return <MyDataScreen onNext={handleFinishDemo} includeMyData={consent?.myDataAgreed === true} />;

      case 'Payment':
        return (
          <PaymentScreen
            card={activeCard}
            cards={walletCards}
            onSelectCard={handleSelectCard}
            onClose={() => navigate(onboardingComplete ? 'Main' : 'RoutineRecommendation')}
          />
        );

      case 'Main':
        return (
          <View style={styles.screen}>
            <MainScreen
              walletCards={walletCards}
              activeCardId={activeCardId}
              onSelectCard={handleSelectCard}
              onLogout={handleLogout}
              canLock={onboardingComplete && hasSavedPin}
              allowAutomaticAds={allowAutomaticAds}
              includeMyData={consent?.myDataAgreed === true}
              scheduleDisabled={Boolean(previewScreen) || privacyOpen}
              onEditRoutine={openRoutine}
              onViewBenefits={() => {
                setScheduleEditor({});
                setRoutineMode('edit');
                navigate('RoutineRecommendation');
              }}
            />
          </View>
        );

      default:
        return null;
    }
  };

  if (isRestoring) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1A237E" />
        <Text style={styles.loadingText}>
          앱 상태 불러오는 중...
        </Text>
      </View>
    );
  }

  const showInlinePreviewButton =
    __DEV__ && (Platform.OS !== 'web' || (previewScreen || currentScreen) === 'DailyRoutine');
  const inlinePreviewButton = showInlinePreviewButton && (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ expanded: showDevMenu }}
      disabled={privacyOpen || privacyBusy}
      style={styles.privacyButton}
      onPress={toggleDevMenu}
    >
      <Text style={styles.previewCloseText}>
        {showDevMenu ? '화면 이동 닫기' : '화면 이동'}
      </Text>
    </TouchableOpacity>
  );

  const showAccountActions = !previewScreen && ['Login', 'PinLogin', 'Main'].includes(currentScreen);

  return (
    <View style={styles.container}>
      {(showAccountActions || (!previewScreen && (showInlinePreviewButton || !!walletWarning))) && <View style={styles.accountBanner}>
        <View style={showInlinePreviewButton && styles.bannerActions}>
          {showAccountActions && (
              <TouchableOpacity
                disabled={privacyBusy}
                style={styles.privacyButton}
                onPress={openPrivacy}
              >
                <Text style={styles.previewCloseText}>
                  데이터 관리
                </Text>
              </TouchableOpacity>
            )}

          {!previewScreen && authenticated && currentScreen === 'Main' && (
            <TouchableOpacity
              style={styles.privacyButton}
              onPress={() => {
                if (!actionBusy.current) {
                  setRoutineMode('edit');
                  navigate('RoutineRecommendation');
                }
              }}
            >
              <Text style={styles.previewCloseText}>
                카드 등록·추천
              </Text>
            </TouchableOpacity>
          )}

          {!previewScreen && inlinePreviewButton}
        </View>

        {!!walletWarning && !previewScreen && (
          <View>
            <Text style={styles.loadingText}>
              {walletWarning}
            </Text>

            <TouchableOpacity
              disabled={privacyBusy}
              onPress={reloadWallet}
            >
              <Text style={styles.previewCloseText}>
                지갑 다시 불러오기
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>}

      <View
        key={dataEpoch}
        style={[
          styles.screen,
          previewScreen && styles.hidden,
        ]}
      >
        {privacyBusy ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#245DE5" />
            <Text style={styles.loadingText}>
              기록 삭제 중...
            </Text>
          </View>
        ) : (
          renderScreen(currentScreen)
        )}
      </View>

      <PrivacyDataModal
        visible={privacyOpen && !previewScreen}
        pendingReset={resetPending}
        onClose={() => {
          if (!actionBusy.current) {
            setPrivacyOpen(false);
          }
        }}
        onDelete={handleDeleteData}
      />

      {__DEV__ && previewScreen && (
        <View style={styles.previewLayer}>
          <View style={styles.previewBar}>
            <Text style={styles.previewLabel}>
              개발자 체험 · 버튼 조작 가능
            </Text>

            <View style={styles.bannerActions}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => {
                  setPreviewScreen(null);
                  setShowDevMenu(false);
                }}
                style={styles.previewClose}
              >
                <Text style={styles.previewCloseText}>
                  사용자 흐름으로 복귀
                </Text>
              </TouchableOpacity>
              {inlinePreviewButton}
            </View>
          </View>

          <View style={styles.screen}>
            {renderScreen(previewScreen, true)}
          </View>
        </View>
      )}

      {__DEV__ && (
        <>
          {showDevMenu && (
            <View style={[styles.devMenu, showInlinePreviewButton ? styles.inlineDevMenu : styles.webDevMenu]}>
              <Text style={styles.devTitle}>
                🛠 개발자 화면 미리보기
              </Text>

              <Text style={styles.devSubtitle}>
                미리보기 로그인은 화면 이동용입니다.
                일과·카드·설정 변경은 이 기기에 저장됩니다.
              </Text>

              <ScrollView
                style={styles.devScroll}
                nestedScrollEnabled
              >
                {DEV_SCREENS.map(screen => (
                  <TouchableOpacity
                    key={screen.key}
                    style={[
                      styles.devMenuItem,
                      previewScreen === screen.key &&
                        styles.devMenuItemActive,
                    ]}
                    onPress={() => {
                      if (actionBusy.current) return;

                      previewGo(screen.key);
                    }}
                  >
                    <Text
                      style={[
                        styles.devMenuText,
                        previewScreen === screen.key &&
                          styles.devMenuTextActive,
                      ]}
                    >
                      {screen.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {previewScreen && (
                <TouchableOpacity
                  onPress={() => {
                    setPreviewScreen(null);
                    setShowDevMenu(false);
                  }}
                >
                  <Text style={styles.devNotice}>
                    미리보기 닫고 원래 화면으로
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {Platform.OS === 'web' && !showInlinePreviewButton && <TouchableOpacity
            disabled={privacyOpen || privacyBusy}
            style={styles.devFloatingButton}
            onPress={toggleDevMenu}
          >
            <Text style={styles.devFloatingText}>
              {showDevMenu ? '✕ 닫기' : '🔧 화면 미리보기'}
            </Text>
          </TouchableOpacity>}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  screen: {
    flex: 1,
  },
  pinLoginBack: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  hidden: {
    display: 'none',
  },
  accountBanner: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#EAF1FF',
    alignItems: 'center',
  },
  bannerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  privacyButton: {
    marginTop: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
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
  previewLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FFFFFF',
    zIndex: 100,
  },
  previewBar: {
    padding: 12,
    backgroundColor: '#FFF2D9',
    gap: 8,
  },
  previewLabel: {
    color: '#7A551B',
    fontWeight: '800',
    fontSize: 12,
  },
  previewClose: {
    alignSelf: 'flex-start',
    padding: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
  },
  previewCloseText: {
    color: '#315C9D',
    fontSize: 12,
    fontWeight: '800',
  },
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
    right: 16,
    width: 250,
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
  inlineDevMenu: {
    top: 84,
    maxHeight: '80%',
  },
  webDevMenu: { bottom: 95 },
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
  devNotice: {
    textAlign: 'center',
    color: '#315C9D',
    fontSize: 11,
    marginTop: 12,
    padding: 8,
  },
});
