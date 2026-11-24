import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Alert } from './utils/demoAlert';
import * as DemoStore from './utils/demoStore';
import { createRandomHex, hashPassword } from './utils/demoCrypto';
import { SERVER_MODE, api, clearToken, readToken, setSessionExpiredHandler } from './utils/api';
import { SESSION_EXPIRED_MESSAGE, startupKeepsSession } from './utils/sessionCore';
import { addServerCardByCode, registerServerCard, removeServerCard, resetServerCards } from './utils/serverCards';
import { applySignupJob, rememberSignupJob } from './utils/signupJob';
import { cancelPhoneNotifications, requestPhonePermission } from './utils/notifications';
import {
  deleteDemoData,
  hasPendingReset,
  PREVIEW_CARDS_KEY,
} from './utils/privacyData';
import {
  buildWallet,
  canRegisterWalletCard,
  readWallet,
  saveWalletSelection,
  validWalletId,
  waitForWalletWrites,
  walletIdForCode,
} from './utils/wallet';
import { readPreferences, savePreferences } from './utils/cardRecommendation';

import LoginScreen from './screens/LoginScreen';
import { DEMO_EMAIL, isValidEmail, normalizeEmail } from './utils/demoEmail';
import SignUpScreen, { isValidPhone, isValidSignUpPassword, jobLabel } from './screens/SignUpScreen';
import { consentFromServer } from './utils/consentCore';
import AgreementScreen from './screens/AgreementScreen';
import DetailedRoutineScreen from './screens/DetailedRoutineScreen';
import RoutineRecommendationScreen from './screens/RoutineRecommendationScreen';
import MainScreen from './screens/MainScreen';
import PaymentScreen from './screens/PaymentScreen';

import PrivacyDataModal from './components/PrivacyDataModal';

import { getActiveWalletCard } from './data/cards';

// 로그인 상태('active'). 로그아웃하면 지우고, 앱을 다시 열 때 있으면 로그인을 이어 갑니다.
const SESSION_KEY = 'solpay_demo_session_v1';
// 마지막으로 이메일 로그인한 계정(데모 계정 카드 자동 등록 판단용)
const LOGIN_EMAIL_KEY = 'solpay_demo_login_email_v1';
const ACCOUNT_KEY = 'solpay_demo_account_v1';
const FINISHED_KEY = 'solpay_demo_onboarding_v1';
const CONSENT_KEY = 'solpay_demo_consent_v1';
const PREVIEW_CARDS_STORAGE_KEY = 'solpay_public_demo_' + PREVIEW_CARDS_KEY;
const LEGACY_CONSENT_VERSION = 'solpay-demo-consent-v1';
const LEGACY_OPTIONS_VERSION = 'solpay-onboarding-options-v2';
const ONBOARDING_OPTIONS_VERSION = 'solpay-onboarding-options-v3';

// 데모 계정(demo@example.com)으로 로그인했을 때 지갑이 비어 있으면 미리 넣어두는 카드
const DEMO_WALLET_CODES = [
  'SH_DISCOUNT_PLAN',
  'SH_EVERYWHERE',
  'SH_SOL_TRAVEL_CHECK',
  'SH_SOLMATE_SOL_PLAN_CHECK',
  'SH_HI_POINT_PLAN',
];

const DEV_SCREENS = [
  { key: 'Login', label: '1. 이메일 로그인' },
  { key: 'SignUp', label: '1-1. 회원가입' },
  { key: 'Agreement', label: '2. 서비스 이용 동의' },
  { key: 'DailyRoutine', label: '3. 일정 관리' },
  { key: 'RoutineRecommendation', label: '4. 일과 맞춤 카드 추천' },
  { key: 'Main', label: '5. 메인 화면' },
  { key: 'Payment', label: '6. 결제 화면' },
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

// 화면 미리보기: 개발 중이거나 웹(Vercel 데모)일 때만 보여줍니다. 실제 휴대폰 앱 배포본에는 나오지 않습니다.
const PREVIEW_ENABLED = __DEV__ || Platform.OS === 'web';

function readPreviewCardCodes() {
  if (!PREVIEW_ENABLED || Platform.OS !== 'web') return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREVIEW_CARDS_STORAGE_KEY));
    return Array.isArray(saved) ? saved.filter(canRegisterWalletCard) : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [demoAccount, setDemoAccount] = useState(null);
  const [walletCards, setWalletCards] = useState([]);
  const [walletWarning, setWalletWarning] = useState('');

  const selectedCardRef = useRef(null);
  const walletRevision = useRef(0);

  const [activeCardId, setActiveCardId] = useState(null);

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
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [scheduleEditor, setScheduleEditor] = useState({});
  const [routineMode, setRoutineMode] = useState('onboarding');
  // '일정 맞춤 추천'에서 '‹ 일정 다시 확인'을 누르면 돌아갈 곳 (2026-11-24 수정사항):
  //   'DailyRoutine' = 일정 관리(가입 흐름·일정 관리에서 다음), 그 밖은 메인의 그 탭('schedule' = 오늘의 일정, 'home')
  const [recommendBack, setRecommendBack] = useState('DailyRoutine');
  const [mainTab, setMainTab] = useState('home');          // 메인을 열 때 처음 보일 탭
  const [previewBack, setPreviewBack] = useState('DailyRoutine');
  const [previewMainTab, setPreviewMainTab] = useState('home');

  const [showDevMenu, setShowDevMenu] = useState(false);
  const [previewScreen, setPreviewScreen] = useState(null);
  const [previewWallet, setPreviewWallet] = useState(null);
  const [previewCardCodes, setPreviewCardCodes] = useState(readPreviewCardCodes);
  const registeredPreviewCards = buildWallet({ owned: previewCardCodes }).filter(card =>
    !walletCards.some(owned => owned.id === card.id)
  );
  const previewBase = [...walletCards, ...registeredPreviewCards];
  const previewCards = previewWallet?.cards ?? (previewBase.length ? previewBase : buildWallet({ owned: DEMO_WALLET_CODES }));
  const previewCardId = previewWallet?.id ?? activeCardId ?? previewCards[0]?.id;
  const previewCard = getActiveWalletCard(previewCards, previewCardId);

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

      // Remove records left by the retired local unlock flow.
      await Promise.allSettled([
        DemoStore.deleteItemAsync('solpay_demo_pin_v1'),
        DemoStore.deleteItemAsync('solpay_demo_pin_attempts_v1'),
        DemoStore.deleteItemAsync('solpay_demo_full_logout_v1'),
      ]);

      const [savedAccount, session, savedToken] = await Promise.all([
        readDemoAccount(),
        DemoStore.getItemAsync(SESSION_KEY),
        SERVER_MODE ? readToken() : null,
      ]);
      if (!active) return;
      setDemoAccount(savedAccount);

      // 로그아웃하지 않고 앱을 닫았거나 새로고침했으면 로그인 상태를 이어 갑니다.
      // 서버 모드에서는 저장된 로그인 정보가 아직 유효한지 서버에 확인합니다.
      let resume = session === 'active' && !savedAccount?.firstLogin && (!SERVER_MODE || Boolean(savedToken));
      if (SERVER_MODE && resume) {
        try {
          await api.me();
        } catch (error) {
          // 401(만료·무효)일 때만 로그아웃. 서버가 잠깐 안 되는 연결 오류면 로그인을 유지한다 (2026-11-24)
          resume = startupKeepsSession(error);
        }
        if (!active) return;
      }

      if (resume) {
        await afterAuthentication();
        return;
      }
      await DemoStore.deleteItemAsync(SESSION_KEY);
      if (SERVER_MODE && savedToken) await clearToken();
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
    if (screen !== 'Main') setMainTab('home');
    setCurrentScreen(screen);
  };
  const backFromRecommendation = () => {
    if (recommendBack === 'DailyRoutine') {
      navigate('DailyRoutine');
      return;
    }
    navigate('Main');
    setMainTab(recommendBack);
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
      const snapshot = await readWallet();
      if (revision !== walletRevision.current) return;

      setWalletCards(snapshot.cards);
      selectedCardRef.current = snapshot.id;
      setActiveCardId(snapshot.id);
      setWalletWarning(snapshot.warning);
    } catch {
      if (revision !== walletRevision.current) return;

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

    const cards = buildWallet(preferences);
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

  // 카드 탭 상세의 '내 카드로 추가' (2026-11-24). serverCode: 서버 상품 번호(서버 목록에서 열었을 때)
  const handleRegisterCard = (code, serverCode) => runAction(async () => {
    requireAuthentication();
    if (SERVER_MODE) {
      // 서버에 먼저 등록하고, 서버 목록을 다시 읽어 지갑을 맞춥니다.
      if (serverCode) await addServerCardByCode(serverCode);
      else {
        if (!canRegisterWalletCard(code)) throw Error('등록할 수 없는 카드 상품입니다.');
        await registerServerCard(code);
      }
      await reloadWallet();
      return;
    }
    if (!canRegisterWalletCard(code)) throw Error('등록할 수 없는 카드 상품입니다.');
    const preferences = await readPreferences();
    if (preferences.owned.includes(code)) return;
    const next = await savePreferences({ ...preferences, owned: [...preferences.owned, code] });
    await handlePreferencesSaved(next);
  });

  // 카드 탭 상세의 '내 카드에서 빼기' (2026-11-24). card: 지갑 카드 (id, catalogCode)
  const handleRemoveCard = card => runAction(async () => {
    requireAuthentication();
    if (!card?.id) throw Error('뺄 카드를 찾지 못했습니다.');
    if (SERVER_MODE) {
      await removeServerCard(card.id);
      await reloadWallet();
      return;
    }
    const preferences = await readPreferences();
    const next = await savePreferences({ ...preferences, owned: preferences.owned.filter(code => code !== card.catalogCode) });
    await handlePreferencesSaved(next);
  });

  const handleUseCard = code => runAction(async () => {
    requireAuthentication();

    const snapshot = await readWallet();

    if (!snapshot.preferences.owned.includes(code)) {
      throw Error('내 지갑에 있는 카드만 결제에 쓸 수 있어요. 카드 탭에서 \'내 카드로 추가\'를 먼저 눌러주세요.');
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
    let [savedConsent, finished] = await Promise.all([
      readConsent(),
      DemoStore.getItemAsync(FINISHED_KEY),
    ]);

    // 서버 모드: 다른 기기에서 필수 동의를 했으면(users.mydata_agreed) 이 기기에서도 다시 묻지 않고 홈으로 (2026-11-24)
    if (SERVER_MODE && savedConsent?.termsAgreed !== true) {
      try {
        const restored = consentFromServer(await api.me(), savedConsent, ONBOARDING_OPTIONS_VERSION);
        if (restored) {
          await DemoStore.setItemAsync(CONSENT_KEY, JSON.stringify(restored));
          await DemoStore.setItemAsync(FINISHED_KEY, 'yes');
          savedConsent = restored;
          finished = 'yes';
        }
      } catch {
        // 서버 동의를 못 읽으면 기기 기록대로 진행합니다(동의 화면).
      }
    }

    const completed = finished === 'yes' && savedConsent?.termsAgreed === true;
    await DemoStore.setItemAsync(SESSION_KEY, 'active');
    setAuthenticated(true);
    setAllowAutomaticAds(completed && !firstSignupLogin);
    setConsent(savedConsent);
    setOnboardingComplete(completed);
    setRoutineMode('onboarding');

    try {
      const loginEmail = await DemoStore.getItemAsync(LOGIN_EMAIL_KEY);
      // 기록이 없던 이전 버전 로그인은, 직접 가입한 계정이 없으면 데모 계정으로 봅니다.
      const isDemoAccount = loginEmail === DEMO_EMAIL || (!loginEmail && !(await readDemoAccount()));
      if (isDemoAccount) {
        const preferences = await readPreferences();
        if (preferences.owned.length === 0) {
          await savePreferences({ ...preferences, owned: DEMO_WALLET_CODES });
        }
      }
    } catch {
      // 데모 카드를 못 넣어도 로그인은 계속 진행합니다.
    }

    await reloadWallet();

    if (savedConsent?.termsAgreed !== true) {
      navigate('Agreement');
    } else {
      navigate(completed ? 'Main' : 'DailyRoutine');
    }
  };

  const handleLogin = (email, password) => runAction(async () => {
    if (!__DEV__ && Platform.OS !== 'web' && !SERVER_MODE) {
      throw Error('현재 이메일 로그인을 사용할 수 없어요.');
    }

    const address = normalizeEmail(email);
    if (!isValidEmail(address)) throw Error('올바른 이메일 형식을 입력해주세요.');

    if (SERVER_MODE) {
      await api.login(address, password);
      const previousEmail = await DemoStore.getItemAsync(LOGIN_EMAIL_KEY);
      const switchedAccount = previousEmail !== address;
      if (switchedAccount) {
        // 다른 계정으로 로그인하면 이 기기의 이전 계정 정보(동의·일정·카드)를 지우고 처음부터 시작합니다.
        await deleteDemoData('personal').catch(() => {});
        for (const key of [FINISHED_KEY, CONSENT_KEY]) {
          await DemoStore.deleteItemAsync(key);
        }
        setConsentDraft(null);
        setScheduleEditor({});
      }
      await DemoStore.setItemAsync(LOGIN_EMAIL_KEY, address);
      await applySignupJob(address);
      await afterAuthentication({ firstSignupLogin: switchedAccount });
      return;
    }

    const customMatches =
      demoAccount?.email === address && typeof password === 'string'
        ? await hashPassword(demoAccount.salt, password) === demoAccount.hash
        : false;

    const valid =
      (address === DEMO_EMAIL && password === 'Demo1234!') ||
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
      for (const key of [FINISHED_KEY, CONSENT_KEY]) {
        await DemoStore.deleteItemAsync(key);
      }
      const account = { ...demoAccount, firstLogin: false };
      await DemoStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(account));
      setDemoAccount(account);
      setConsentDraft(null);
      setScheduleEditor({});
    }
    await DemoStore.setItemAsync(LOGIN_EMAIL_KEY, customMatches ? 'custom' : DEMO_EMAIL);
    if (customMatches) await applySignupJob(address);
    await afterAuthentication({ firstSignupLogin });
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
      morningNotificationAgreed: value.morningNotificationAgreed === true,
    };

    // 서버 모드: 필수 동의를 서버에 먼저 남깁니다 (users.mydata_agreed, 2026-11-24). 실패하면 동의 화면에 머뭅니다.
    if (SERVER_MODE) {
      try {
        await api.saveAgreement(true);
      } catch (error) {
        throw Error('동의를 서버에 저장하지 못했어요. 다시 시도해주세요. ' + (error?.message || ''));
      }
    }

    await DemoStore.setItemAsync(
      CONSENT_KEY,
      JSON.stringify(nextConsent)
    );

    setConsent(nextConsent);
    setConsentDraft(nextConsent);
    // 알림 수신에 동의했으면 폰 알림 권한을 요청합니다(거절해도 가입은 계속).
    if (nextConsent.morningNotificationAgreed) await requestPhonePermission().catch(() => false);
    await reloadWallet();

    const completed = await DemoStore.getItemAsync(FINISHED_KEY) === 'yes';
    setOnboardingComplete(completed);
    navigate(completed ? 'Main' : 'DailyRoutine');
  });

  const handleRoutineContinue = () => {
    if (!authenticated) return;
    setRecommendBack('DailyRoutine');
    navigate('RoutineRecommendation');
  };

  const handleFinishDemo = async () => {
    if (actionBusy.current) return;

    actionBusy.current = true;

    try {
      requireAuthentication();

      if ((await readConsent())?.termsAgreed !== true) {
        throw Error(
          '필수 이용 약관에 먼저 동의해주세요.'
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

  // 로그인 만료(서버 401): 서버 로그아웃 없이 이 기기 세션만 정리하고 로그인 화면으로 (2026-11-24 사용자 결정)
  const expireSession = useRef(null);
  expireSession.current = async () => {
    if (!authenticated) return;
    resetServerCards();
    await cancelPhoneNotifications().catch(() => {});
    await DemoStore.deleteItemAsync(SESSION_KEY).catch(() => {});
    setAuthenticated(false);
    setAllowAutomaticAds(false);
    setConsentDraft(null);
    setScheduleEditor({});
    setPreviewScreen(null);
    setPreviewWallet(null);
    walletRevision.current += 1;
    setWalletCards([]);
    selectedCardRef.current = null;
    setActiveCardId(null);
    setWalletWarning('');
    navigate('Login');
    Alert.alert('로그인 만료', SESSION_EXPIRED_MESSAGE);
  };
  useEffect(() => {
    if (!SERVER_MODE) return undefined;
    setSessionExpiredHandler(() => { expireSession.current?.(); });
    return () => setSessionExpiredHandler(null);
  }, []);

  const handleLogout = async () => {
    if (actionBusy.current) return;
    actionBusy.current = true;

    try {
      if (SERVER_MODE) {
        await api.logout();
        resetServerCards();
      }
      await cancelPhoneNotifications().catch(() => {});
      await DemoStore.deleteItemAsync(SESSION_KEY);
      setAuthenticated(false);
      setAllowAutomaticAds(false);
      setConsentDraft(null);
      setScheduleEditor({});
      setPreviewScreen(null);
      setPreviewWallet(null);

      walletRevision.current += 1;
      setWalletCards([]);
      selectedCardRef.current = null;
      setActiveCardId(null);
      setWalletWarning('');

      navigate('Login');
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

    // 직장은 그 이메일로 처음 로그인할 때 일과 질문의 직업 답으로 채웁니다.
    await rememberSignupJob(email, account.job, account.jobOther).catch(() => {});

    if (SERVER_MODE) {
      await api.signup({ ...account, email, workplaceName: jobLabel(account.job, account.jobOther) });
      setOnboardingComplete(false);
      navigate('Login');
      Alert.alert('가입 완료', '가입한 이메일과 비밀번호로 로그인해주세요.');
      return;
    }

    if (isDemoEmailTaken(email)) {
      throw Error('이미 사용 중인 이메일입니다.');
    }

    if (isDemoPhoneTaken(account.phone)) {
      throw Error('이미 사용 중인 전화번호입니다.');
    }

    const salt = await createRandomHex();
    const hash = await hashPassword(salt, account.password);

    const record = { version: 1, email, phone: account.phone, job: account.job, jobOther: account.jobOther || '', salt, hash, firstLogin: true };
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
    setWalletCards([]);
    selectedCardRef.current = null;
    setActiveCardId(null);
    setWalletWarning('');

    setScheduleEditor({});
    setConsentDraft(null);
    setPreviewScreen(null);
    setPreviewWallet(null);
    setPreviewCardCodes(readPreviewCardCodes());
    setShowDevMenu(false);

    if (scope === 'account') {
      setResetPending(true);
      setDemoAccount(null);
      setAuthenticated(false);
      setAllowAutomaticAds(false);
      setConsent(null);
      setOnboardingComplete(false);
      setRoutineMode('onboarding');
      setCurrentScreen('Login');
    }

    try {
      await waitForWalletWrites();

      // '동의 철회 및 이 기기의 계정 초기화': 서버 모드면 서버의 필수 동의도 철회합니다 (2026-11-24). 실패해도 기기 초기화는 계속
      if (scope === 'account' && SERVER_MODE) {
        await api.saveAgreement(false).catch(() => {});
      }

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
    if (screen !== 'Main') setPreviewMainTab('home');
    setPreviewScreen(screen);
    setShowDevMenu(false);
  };

  const toggleDevMenu = () => {
    if (actionBusy.current || privacyOpen || privacyBusy) return;
    Keyboard.dismiss();
    setShowDevMenu(visible => !visible);
  };

  const previewSelect = id => {
    if (previewCards.some(card => card.id === id)) {
      setPreviewWallet({ cards: previewCards, id });
    }
  };

  const previewPreferences = async preferences => {
    const cards = buildWallet(preferences);
    setPreviewWallet({ cards, id: validWalletId(cards, previewCardId) });
  };

  const previewRegister = code => {
    if (!canRegisterWalletCard(code)) throw Error('등록할 수 없는 카드 상품입니다.');
    if (previewCards.some(card => card.catalogCode === code)) return;
    if (Platform.OS === 'web') {
      const codes = [...new Set([...readPreviewCardCodes(), code])];
      window.localStorage.setItem(PREVIEW_CARDS_STORAGE_KEY, JSON.stringify(codes));
      setPreviewCardCodes(codes);
    }
    const cards = [...previewCards, ...buildWallet({ owned: [code] })];
    setPreviewWallet({ cards, id: walletIdForCode(code) });
  };

  const previewRemove = card => {
    if (!card?.id) return;
    if (Platform.OS === 'web') {
      const codes = readPreviewCardCodes().filter(code => code !== card.catalogCode);
      window.localStorage.setItem(PREVIEW_CARDS_STORAGE_KEY, JSON.stringify(codes));
      setPreviewCardCodes(codes);
    }
    const cards = previewCards.filter(item => item.id !== card.id);
    setPreviewWallet({ cards, id: validWalletId(cards, previewCardId === card.id ? null : previewCardId) });
  };

  const previewUseCard = async code => {
    const id = walletIdForCode(code);
    const cards = previewCards.some(card => card.id === id) ? previewCards : (await readWallet()).cards;

    if (!cards.some(card => card.id === id)) {
      throw Error('내 지갑에 있는 카드만 결제에 쓸 수 있어요. 이 카드는 \'카드 신청\'으로 먼저 신청해주세요.');
    }

    setPreviewWallet({ cards, id });
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

        case 'SignUp':
          return (
            <SignUpScreen
              onBack={() => previewGo('Login')}
              onComplete={() => previewGo('Login')}
              isEmailTaken={SERVER_MODE ? api.isEmailTaken : isDemoEmailTaken}
              isPhoneTaken={SERVER_MODE ? api.isPhoneTaken : isDemoPhoneTaken}
            />
          );

        case 'Agreement':
          return (
            <AgreementScreen
              initialDraft={consentDraft}
              onDraftChange={setConsentDraft}
              onBack={() => previewGo('Login')}
              onNext={async () => previewGo('DailyRoutine')}
            />
          );

        case 'DailyRoutine':
          return (
            <DetailedRoutineScreen
              {...scheduleEditor}
              onBack={() => previewGo('Main')}
              onContinue={() => { setPreviewBack('DailyRoutine'); previewGo('RoutineRecommendation'); }}
            />
          );

        case 'RoutineRecommendation':
          return (
            <RoutineRecommendationScreen
              scheduleDate={scheduleEditor.date}
              selectedWalletCard={previewCard}
              onBack={() => {
                if (previewBack === 'DailyRoutine') previewGo('DailyRoutine');
                else { previewGo('Main'); setPreviewMainTab(previewBack); }
              }}
              onNext={async () => previewGo('Main')}
              onPreferencesChange={previewPreferences}
              onUseCard={previewUseCard}
            />
          );

        case 'Payment':
          return (
            <PaymentScreen
              card={previewCard}
              cards={previewCards}
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
                initialTab={previewMainTab}
                walletCards={previewCards}
                activeCardId={previewCardId}
                onSelectCard={previewSelect}
                onRegisterCard={previewRegister}
                onRemoveCard={previewRemove}
                onLogout={() => previewGo('Login')}
                onEditRoutine={(date, entryId) => {
                  setScheduleEditor({ date, entryId });
                  previewGo('DailyRoutine');
                }}
                onViewBenefits={() => {
                  setPreviewBack('schedule');
                  previewGo('RoutineRecommendation');
                }}
              />
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

      case 'SignUp':
        return (
          <SignUpScreen
            onBack={() => navigate('Login')}
            onComplete={handleDemoSignUp}
            isEmailTaken={SERVER_MODE ? api.isEmailTaken : isDemoEmailTaken}
            isPhoneTaken={SERVER_MODE ? api.isPhoneTaken : isDemoPhoneTaken}
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

      case 'DailyRoutine':
        return (
          <DetailedRoutineScreen
            {...scheduleEditor}
            onContinue={handleRoutineContinue}
            onBack={() =>
              navigate(
                routineMode === 'edit' ? 'Main' : 'Agreement'
              )
            }
          />
        );

      case 'RoutineRecommendation':
        return (
          <RoutineRecommendationScreen
            scheduleDate={scheduleEditor.date}
            selectedWalletCard={activeCard}
            onBack={backFromRecommendation}
            onNext={handleFinishDemo}
            onPreferencesChange={handlePreferencesSaved}
            onUseCard={handleUseCard}
          />
        );

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
              initialTab={mainTab}
              walletCards={walletCards}
              activeCardId={activeCardId}
              onSelectCard={handleSelectCard}
              onRegisterCard={handleRegisterCard}
              onRemoveCard={handleRemoveCard}
              onLogout={handleLogout}
              allowAutomaticAds={allowAutomaticAds}
              scheduleDisabled={Boolean(previewScreen) || privacyOpen}
              onEditRoutine={openRoutine}
              onViewBenefits={() => {
                setScheduleEditor({});
                setRoutineMode('edit');
                setRecommendBack('schedule');
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
    PREVIEW_ENABLED && (Platform.OS !== 'web' || (previewScreen || currentScreen) === 'DailyRoutine');
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

  const showAccountActions = !previewScreen && ['Login', 'Main'].includes(currentScreen);

  return (
    // iPhone 노치·홈 인디케이터에 가려지지 않도록 전체를 안전 영역 안에 둡니다.
    <SafeAreaView style={styles.container}>
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
                  setRecommendBack('home');
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

      {PREVIEW_ENABLED && previewScreen && (
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

      {PREVIEW_ENABLED && (
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
    </SafeAreaView>
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
  hidden: {
    display: 'none',
  },
  accountBanner: {
    paddingVertical: 3,
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
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 5,
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
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#FFF2D9',
    gap: 4,
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
    bottom: 6,
    right: 16,
    backgroundColor: '#222222',
    paddingHorizontal: 15,
    paddingVertical: 9,
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
