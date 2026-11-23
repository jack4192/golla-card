import BenefitReport from '../components/BenefitReport';
import { CARD_CATALOG_40, findCatalog40Product } from '../data/cardCatalog40';
import { PROMOTION_BRANDS } from '../data/promotionBrands';
import { PROMOTIONS, activePromotions } from '../data/promotions';
import PinDotsInput from '../components/PinDotsInput';
import { MYSHOP_LOGOS } from '../data/myshopLogos';
import WalletDeck from '../components/WalletDeck';
import RecommendationLaunchPopup from '../components/RecommendationLaunchPopup';
import AccountWithdrawal from '../components/AccountWithdrawal';
import TodaySchedulePanel from '../components/TodaySchedulePanel';
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Image, Linking, TouchableOpacity, ScrollView, FlatList, StyleSheet, SafeAreaView, TextInput, Switch, Modal, KeyboardAvoidingView, Platform, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import YearEndReport from '../components/YearEndReport';
import PaymentCardOrder from '../components/PaymentCardOrder';
import QuickPaySheet from '../components/QuickPaySheet';
import NotificationCenter, { NotificationBell, useInbox } from '../components/NotificationCenter';
import { PHONE_NOTIFICATIONS_SUPPORTED, addPhoneNotificationOpenListener, refreshDailyNotifications, requestPhonePermission, syncPhoneNotifications } from '../utils/notifications';
import { eventTitle, readEvents } from '../utils/routineData';
import { Alert } from '../utils/demoAlert';
import * as SecureStore from '../utils/demoStore';
import { createPinSalt, hashPin } from '../utils/pinCrypto';
import PaymentScreen, { realProductCard, realWalletCards } from './PaymentScreen';
import { getActiveWalletCard } from '../data/cards';
import { canRegisterWalletCard } from '../utils/wallet';
import { SERVER_MODE, api } from '../utils/api';
import { suggestionsFor, toChatHistory } from '../utils/homeChat';
import { useCardCatalog } from '../utils/serverCatalog';
const NAV = [{
  id: 'home',
  label: '홈',
  icon: 'home-outline',
  active: 'home'
}, {
  id: 'benefits',
  label: '혜택',
  icon: 'gift-outline',
  active: 'gift'
}, {
  id: 'payment',
  label: '결제',
  icon: 'qr-code-outline',
  active: 'qr-code'
}, {
  id: 'schedule',
  label: '오늘의 일정',
  icon: 'calendar-outline',
  active: 'calendar'
}, {
  id: 'cards',
  label: '카드',
  icon: 'card-outline',
  active: 'card'
}];
const MYSHOP_ROWS = [['살롱드마샬', '최대 20% 할인', null, null, '2026-11-20', '2026-11-30', ''], ['11번가', '3,000원 캐시백', 50000, null, '2026-11-01', '2026-11-30', ''], ['CU', '500원 캐시백', null, null, '2026-11-01', '2026-11-15', ''], ['마켓컬리', '20% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['에이치몰', '5% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['알리익스프레스', '10% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['신라아이파크면세점', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['동원몰', '7% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['할리스', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['신세계면세점', '11% 캐시백', null, 100000, '2026-11-01', '2026-11-30', ''], ['닥터자르트', '12% 캐시백', null, 50000, '2026-11-01', '2026-11-30', ''], ['현대백화점', '15% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['SSG닷컴', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['이마트몰', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['차앤박(CNP)', '12% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['오설록', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['레드캡투어', '12% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['야놀자', '8% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['교보문고', '10% 캐시백', 30000, 20000, '2026-11-01', '2026-11-30', ''], ['위메프', '20% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['올리브영', '25% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['파리바게뜨', '12% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['유니클로', '16% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['미식 브랜드(식별불가)', '16% 캐시백', 30000, 30000, '2026-11-01', '2026-11-30', '가맹점명 원본 확인 필요'], ['종합쇼핑몰(식별불가)', '8,000원 캐시백', 200000, null, '2026-11-01', '2026-11-30', '가맹점명 원본 확인 필요']];
const ALL_BENEFITS = [...PROMOTIONS, ...MYSHOP_ROWS.map((row, index) => ({
  id: `myshop-${index + 1}`,
  type: '마이샵',
  merchant: row[0],
  benefit: row[1],
  minimum: row[2],
  cap: row[3],
  start: row[4],
  end: row[5],
  payout: '결제일에 따라 다름',
  method: '마이샵 혜택 ON 설정 후 신한카드 결제',
  note: row[6]
}))];
const money = value => value == null ? '원본에 미기재' : `${Number(value).toLocaleString('ko-KR')}원`;
const kstToday = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const benefitStatus = benefit => {
  const today = kstToday();
  if (today < benefit.start) return '진행 예정';
  if (today > benefit.end) return '기간 종료';
  return '기간 내';
};

// 카드별 혜택 요약.
// 상품 조건은 시연용 데이터로 제공하며
// 실제 혜택 적용 여부는 카드사 안내서를 확인해야 합니다.
const WALLET_CARD_BENEFITS = {
  focus: {
    highlights: [{
      icon: 'fast-food-outline',
      label: 'CU 간편식',
      value: '5% 즉시할인'
    }, {
      icon: 'storefront-outline',
      label: 'CU',
      value: '10% 캐시백'
    }, {
      icon: 'bus-outline',
      label: '후불교통',
      value: '10% 캐시백'
    }],
    condition: 'CU 캐시백·교통 혜택: 전월 30만원 이상',
    limit: '간편식 1회 2천원 · 교통 월 1천원 등',
    description: '편의점 간편식과 대중교통 이용 시 혜택이 있는 카드',
    note: 'CU 간편식 할인은 대상 상품에 한하며, CU 캐시백 한도는 전월 실적 구간에 따라 다릅니다. 혜택 중복·제외 매장 확인이 필요합니다.'
  },
  gsall: {
    highlights: [{
      icon: 'storefront-outline',
      label: 'GS25',
      value: '10% 포인트'
    }, {
      icon: 'card-outline',
      label: '일반 결제',
      value: '0.2% 포인트'
    }],
    condition: '전월 20만원 이상',
    limit: 'GS25 특별적립 월 5,000P 등',
    description: 'GS25와 일반 가맹점에서 GS ALL 포인트를 적립하는 카드',
    note: 'GS리테일 대상 가맹점·적립 제외 결제 등 상품별 조건을 확인해야 합니다. 포인트는 현금과 동일하게 환산하지 않습니다.'
  },
  solmate: {
    highlights: [{
      icon: 'cafe-outline',
      label: '카페',
      value: '1~2% 적립'
    }, {
      icon: 'card-outline',
      label: '일반 결제',
      value: '0.2~0.4%'
    }],
    condition: '전월 20만원 이상 · 60만원 이상 시 우대',
    limit: '영역별 이용액 월 30만원 · 통합 월 3만P 등',
    description: '카페와 일상 결제에서 SOL포인트를 적립하는 카드',
    note: '기본 적립과 특별 적립은 중복 적용되지 않으며, 카드사 업종 분류와 적립 제외 거래를 확인해야 합니다.'
  },
  naver: {
    highlights: [{
      icon: 'bag-outline',
      label: '네이버 온라인',
      value: '1~2% 적립'
    }, {
      icon: 'card-outline',
      label: '일반 결제',
      value: '0.1% 적립'
    }],
    condition: '네이버 적립률은 전월 실적별 1~2% · 일반 0.1%',
    limit: '네이버 결제 월 10,000P 등',
    description: '네이버쇼핑·네이버페이 온라인 결제가 많은 경우 유용',
    note: '네이버 결제 적립률은 전월 30만원·60만원 구간 등에 따라 달라집니다. 실제 월 한도 잔여분은 미확인입니다.'
  },
  starbucks: {
    highlights: [{
      icon: 'cafe-outline',
      label: '스타벅스',
      value: '별 리워드'
    }, {
      icon: 'star-outline',
      label: '누적 1만원당',
      value: '별 1~2개'
    }],
    condition: '전월 20만원 이상 · 30만원 이상 시 우대',
    limit: '월 최대 3개 또는 10개 등',
    description: '스타벅스를 자주 이용할 때 별을 적립하는 카드',
    note: '당월 스타벅스 누적 결제액과 이미 받은 별에 따라 적립 수가 달라집니다. 별은 원화 할인과 단순 비교할 수 없습니다.'
  },
  yogi: {
    highlights: [{
      icon: 'restaurant-outline',
      label: '요기요',
      value: '1,000원 캐시백'
    }, {
      icon: 'receipt-outline',
      label: '1회 결제',
      value: '2만원 이상'
    }],
    condition: '전월 30만원 이상 · 요기요 공식 앱 직접 결제',
    limit: '일 1회·월 3회 · 특화서비스 통합 한도 적용',
    description: '요기요 배달 주문에 맞춘 캐시백 혜택',
    note: '특화서비스 통합 한도는 전월 실적 구간에 따라 달라지고 실제 사용 횟수·잔여 한도는 확인되지 않습니다.'
  },
  chunsik: {
    highlights: [{
      icon: 'storefront-outline',
      label: '편의점',
      value: '5% 적립'
    }, {
      icon: 'phone-portrait-outline',
      label: '카카오페이',
      value: '2% 적립'
    }],
    condition: '전월 30만원 이상',
    limit: '편의점 건당 1,000P · 카카오페이 월 10,000P 등',
    description: '편의점·카카오페이 결제에 활용하기 좋은 체크카드',
    note: '편의점 혜택은 일 1회·월 3회 등 횟수 제한이 있고 일부 결제·업종은 제외됩니다. 중복 적립은 별도 확인이 필요합니다.'
  },
  ryan: {
    highlights: [{
      icon: 'cafe-outline',
      label: '커피전문점',
      value: '5% 적립'
    }, {
      icon: 'bus-outline',
      label: '대중교통',
      value: '5% 적립'
    }, {
      icon: 'phone-portrait-outline',
      label: '카카오페이',
      value: '2% 적립'
    }],
    condition: '전월 30만원 이상',
    limit: '커피 건당 1,000P · 교통 월 3,000P 등',
    description: '커피·대중교통·카카오페이 이용 시 혜택이 있는 카드',
    note: '커피 혜택은 일 1회·월 3회 등 횟수 조건이 있으며, 카카오페이 적립은 월 10,000P 한도 등이 적용됩니다. 실제 보유 실적·잔여 한도는 미연동입니다.'
  }
};
const UI_SETTINGS_KEY = 'solpay_ui_settings_v1';
const CONSENT_KEY = 'solpay_demo_consent_v1';
const PIN_KEY = 'solpay_demo_pin_v1';
const PIN_ATTEMPTS_KEY = 'solpay_demo_pin_attempts_v1';
const PIN_FAILURE_LIMIT = 5;
const PIN_LOCK_MS = 60000;
const SettingsGroup = ({
  title,
  children
}) => <View style={styles.settingGroup}>
    <Text style={styles.settingGroupTitle}>{title}</Text>
    <View style={styles.settingPanel}>{children}</View>
  </View>;
const SettingsItem = ({
  icon,
  title,
  subtitle,
  value,
  onPress,
  danger = false
}) => <TouchableOpacity style={styles.settingRow} onPress={onPress} disabled={!onPress}>
    <View style={styles.settingIcon}>
      <Ionicons name={icon} size={19} color={danger ? '#C54444' : '#315AAB'} />
    </View>
    <View style={styles.settingTextArea}>
      <Text style={[styles.settingLabel, danger && styles.dangerText]}>
        {title}
      </Text>
      {!!subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    {!!value && <Text style={styles.settingValue}>{value}</Text>}
    {!!onPress && <Ionicons name="chevron-forward" size={17} color="#9AA6BA" />}
  </TouchableOpacity>;
const SettingsToggle = ({
  icon,
  title,
  subtitle,
  value,
  onChange,
  disabled = false
}) => <View style={styles.settingRow}>
    <View style={styles.settingIcon}>
      <Ionicons name={icon} size={19} color="#315AAB" />
    </View>
    <View style={styles.settingTextArea}>
      <Text style={styles.settingLabel}>{title}</Text>
      {!!subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
    </View>
    <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{
    false: '#D3D9E3',
    true: '#8FB3FF'
  }} thumbColor={value ? '#2860E6' : '#FFFFFF'} />
  </View>;
export default function MainScreen({
  onLogout,
  canLock = false,
  onOpenChat,
  onEditRoutine,
  onViewBenefits,
  scheduleDisabled = false,
  allowAutomaticAds = false,
  walletCards = [],
  activeCardId,
  onRegisterCard,
  onSelectCard = () => {}
}) {
  const [tab, setTab] = useState('home');
  const [schedulePayment, setSchedulePayment] = useState(null);
  const [sampleActive, setSampleActive] = useState(null);
  const [adRequest, setAdRequest] = useState(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogFilter, setCatalogFilter] = useState('all');
  // 지갑에 등록된 카드의 상품 코드 (카드 탭에서 '내 카드' 표시용)
  // 카드 탭 상품 목록: 서버 모드에서는 서버 데이터, 아니면 앱 데이터 (utils/serverCatalog.js)
  const { cards: catalogCards } = useCardCatalog();
  const ownedCatalogCodes = useMemo(() => {
    const codes = new Set(walletCards.map(card => findCatalog40Product(card)?.code || card.catalogCode).filter(Boolean));
    // 상품 목록(CARD_CATALOG_40)에 있는 카드만 세서 '내 카드 N' 숫자와 목록이 맞게 합니다.
    return new Set(catalogCards.filter(card => codes.has(card.code)).map(card => card.code));
  }, [walletCards, catalogCards]);
  const [selectedCatalog, setSelectedCatalog] = useState(null);
  const [registeringCard, setRegisteringCard] = useState(false);
  const currentCard = getActiveWalletCard(walletCards, activeCardId);
  const [filter, setFilter] = useState('전체');
  const [search, setSearch] = useState('');
  const [selectedBenefit, setSelectedBenefit] = useState(null);
  const [walletBenefitDetailsOpen, setWalletBenefitDetailsOpen] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatBusy, setChatBusy] = useState(false);   // AI 챗봇이 답하는 중
  const chatSeq = React.useRef(0);
  const chatScroll = React.useRef(null);   // 새 답이 오면 맨 아래로 내린다
  const [exitOpen, setExitOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [yearEndOpen, setYearEndOpen] = useState(false);
  // '이 카드로 결제' QR 결제 바텀시트(열려 있으면 결제 맥락: cardId, 일정 정보 등)
  const [paySheet, setPaySheet] = useState(null);
  // 홈 일정 카드가 AI 미리보기를 다시 물을 때 올리는 번호: 홈 추천 팝업(일정 행사를 계산함)이 닫히거나 챗봇 규칙을 확정했을 때 (2026-11-23)
  const [aiRefresh, setAiRefresh] = useState(0);
  const refreshAi = () => setAiRefresh(value => value + 1);
  const openPaySheet = context => {
    if (context?.cardId) onSelectCard(context.cardId);
    setPaySheet({ ...context, returnTab: tab });
  };
  // 시트에서 '혜택 자세히 보기' → 기존 결제 화면(혜택 비교 포함)으로
  const openFullPayment = () => {
    const context = paySheet;
    setPaySheet(null);
    setSchedulePayment(context);
    setTab('payment');
  };
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [phoneNotifyBusy, setPhoneNotifyBusy] = useState(false);
  const inbox = useInbox();
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinForm, setPinForm] = useState({
    old: '',
    next: '',
    confirm: ''
  });
  const [pinSaving, setPinSaving] = useState(false);
  // 간편비밀번호 변경: 0 현재 → 1 새 번호 → 2 새 번호 확인 (한 상자 안에서 진행)
  const [pinStep, setPinStep] = useState(0);
  const [pinMsg, setPinMsg] = useState('');
  const [hasPin, setHasPin] = useState(false);
  const [appNotice, setAppNotice] = useState(true);
  const [vibrationOn, setVibrationOn] = useState(true);
  const [savedConsent, setSavedConsent] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [sessionOpenedAt] = useState(new Date());
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [rawSettings, rawConsent, rawPin] = await Promise.all([SecureStore.getItemAsync(UI_SETTINGS_KEY), SecureStore.getItemAsync(CONSENT_KEY), SecureStore.getItemAsync(PIN_KEY)]);
        if (!active) return;
        if (rawSettings) {
          const settings = JSON.parse(rawSettings);
          if (typeof settings.appNotice === 'boolean') {
            setAppNotice(settings.appNotice);
          }
          if (typeof settings.vibrationOn === 'boolean') {
            setVibrationOn(settings.vibrationOn);
          }
        }
        if (rawConsent) {
          const consentValue = JSON.parse(rawConsent);
          setSavedConsent(consentValue);
        }
        setHasPin(!!rawPin);
      } catch (error) {
        console.warn('설정 불러오기 실패', error);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, []);
  // 앱을 열 때 오늘 알림(일정·혜택)을 알림함에 넣고, 동의한 경우 폰 알림 예약을 맞춥니다.
  useEffect(() => {
    let active = true;
    readEvents().catch(() => []).then(events => {
      if (!active) return;
      refreshDailyNotifications({ events, titleOf: eventTitle, promotions: activePromotions() }).catch(() => {});
      if (savedConsent) {
        syncPhoneNotifications({ agreed: savedConsent.morningNotificationAgreed === true, events, titleOf: eventTitle }).catch(() => {});
      }
    });
    return () => { active = false; };
  }, [savedConsent]);
  // 알림(알림함 또는 폰 알림)을 눌렀을 때 해당 화면으로 이동
  const openNotificationTarget = target => {
    setNotificationsOpen(false);
    setSettingsOpen(false);
    if (target === 'yearend') setYearEndOpen(true);
    else if (['home', 'benefits', 'schedule', 'cards', 'payment'].includes(target)) selectTab(target);
  };
  useEffect(() => addPhoneNotificationOpenListener(target => openNotificationTarget(target)), []);
  // 설정 > 폰 알림 받기: 켜면 권한을 요청하고, 동의 기록(알림 수신 동의)도 함께 바꿉니다.
  const togglePhoneNotifications = async value => {
    if (phoneNotifyBusy) return;
    setPhoneNotifyBusy(true);
    try {
      if (value && !(await requestPhonePermission())) {
        Alert.alert('알림 권한 필요', '휴대폰 설정에서 SOL·Pay(또는 Expo Go) 알림을 허용한 뒤 다시 켜주세요.');
        return;
      }
      const next = { ...(savedConsent || {}), morningNotificationAgreed: value, savedAt: new Date().toISOString() };
      await SecureStore.setItemAsync(CONSENT_KEY, JSON.stringify(next));
      setSavedConsent(next);
    } catch {
      Alert.alert('저장 실패', '알림 설정을 저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      setPhoneNotifyBusy(false);
    }
  };
  const persistUISettings = async (notice, vibration) => {
    setSettingsBusy(true);
    try {
      await SecureStore.setItemAsync(UI_SETTINGS_KEY, JSON.stringify({
        appNotice: notice,
        vibrationOn: vibration
      }));
      setAppNotice(notice);
      setVibrationOn(vibration);
    } catch {
      Alert.alert('저장 실패', '설정이 저장되지 않았어요. 다시 시도해주세요.');
    } finally {
      setSettingsBusy(false);
    }
  };
  const resetPinChange = () => {
    setPinForm({
      old: '',
      next: '',
      confirm: ''
    });
    setPinStep(0);
    setPinMsg('');
  };
  const closePinChange = () => {
    if (pinSaving) return;
    resetPinChange();
    setPinChangeOpen(false);
  };
  const PIN_STEPS = [['old', '현재 간편비밀번호', '현재 사용 중인 6자리를 입력해주세요.'], ['next', '새 간편비밀번호', '새로 사용할 6자리를 입력해주세요.'], ['confirm', '새 간편비밀번호 확인', '새 번호를 한 번 더 입력해주세요.']];
  // 6자리가 채워지면 자동으로 다음 단계로 넘어갑니다.
  const onPinDigits = value => {
    if (pinSaving) return;
    const digits = value.replace(/\D/g, '').slice(0, 6);
    const key = PIN_STEPS[pinStep][0];
    setPinForm(previous => ({ ...previous, [key]: digits }));
    setPinMsg('');
    if (digits.length < 6) return;
    if (pinStep === 0) {
      setPinStep(1);
      return;
    }
    if (pinStep === 1) {
      if (digits === pinForm.old) {
        setPinMsg('현재와 다른 번호를 입력해주세요.');
        setPinForm(previous => ({ ...previous, next: '' }));
        return;
      }
      setPinStep(2);
      return;
    }
    if (digits !== pinForm.next) {
      setPinMsg('새 번호가 서로 달라요. 새 간편비밀번호부터 다시 입력해주세요.');
      setPinForm(previous => ({ ...previous, next: '', confirm: '' }));
      setPinStep(1);
      return;
    }
    saveChangedPin(digits);
  };
  const saveChangedPin = async confirmValue => {
    const {
      old,
      next
    } = pinForm;
    const confirm = confirmValue ?? pinForm.confirm;
    if (![old, next, confirm].every(v => /^\d{6}$/.test(v))) {
      Alert.alert('입력 확인', '현재·새·확인 간편비밀번호를 각각 6자리로 입력해주세요.');
      return;
    }
    if (next !== confirm) {
      Alert.alert('입력 확인', '새 간편비밀번호가 일치하지 않아요.');
      return;
    }
    if (old === next) {
      Alert.alert('입력 확인', '기존과 다른 6자리 번호를 설정해주세요.');
      return;
    }
    if (pinSaving) return;
    setPinSaving(true);
    try {
      const recordRaw = await SecureStore.getItemAsync(PIN_KEY);
      if (!recordRaw) {
        throw new Error('등록된 간편비밀번호를 찾지 못했어요.');
      }
      const record = JSON.parse(recordRaw);
      if (record.version !== 1 || !record.salt || !record.hash) {
        throw new Error('간편비밀번호 정보가 올바르지 않아요.');
      }
      let attempts = {
        count: 0,
        lockedUntil: 0
      };
      const attemptsRaw = await SecureStore.getItemAsync(PIN_ATTEMPTS_KEY);
      if (attemptsRaw) {
        try {
          attempts = JSON.parse(attemptsRaw);
        } catch {
          attempts = {
            count: 0,
            lockedUntil: 0
          };
        }
      }
      const now = Date.now();
      if (attempts.lockedUntil > now) {
        const seconds = Math.ceil((attempts.lockedUntil - now) / 1000);
        throw new Error(`${seconds}초 뒤에 다시 시도할 수 있어요.`);
      }
      if (attempts.lockedUntil && attempts.lockedUntil <= now) {
        attempts = {
          count: 0,
          lockedUntil: 0
        };
      }
      const candidateHash = await hashPin(record.salt, old);
      if (candidateHash !== record.hash) {
        const count = (attempts.count || 0) + 1;
        const lock = count >= PIN_FAILURE_LIMIT;
        await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, JSON.stringify({
          count: lock ? 0 : count,
          lockedUntil: lock ? now + PIN_LOCK_MS : 0
        }));
        throw new Error(lock ? '5회 연속 실패하여 60초간 변경이 제한돼요.' : `현재 비밀번호가 다릅니다. 남은 시도: ${PIN_FAILURE_LIMIT - count}회`);
      }
      const salt = await createPinSalt();
      const hash = await hashPin(salt, next);
      await SecureStore.setItemAsync(PIN_KEY, JSON.stringify({
        version: 1,
        salt,
        hash
      }));
      await SecureStore.deleteItemAsync(PIN_ATTEMPTS_KEY);
      setPinChangeOpen(false);
      resetPinChange();
      Alert.alert('변경 완료', '다음 로그인부터 새 6자리 간편비밀번호를 사용해요.');
    } catch (error) {
      Alert.alert('변경 실패', error?.message || '다시 시도해주세요.');
      resetPinChange();
    } finally {
      setPinSaving(false);
    }
  };
  const resetViewSettings = () => {
    Alert.alert('화면 설정 초기화', '앱 내 알림과 진동 설정만 기본값으로 바꿀까요? PIN과 동의 기록은 유지돼요.', [{
      text: '취소',
      style: 'cancel'
    }, {
      text: '초기화',
      onPress: () => persistUISettings(true, true)
    }]);
  };
  const goFromSettings = nextTab => {
    setSettingsOpen(false);
    selectTab(nextTab);
  };
  const visibleBenefits = useMemo(() => ALL_BENEFITS.filter(item => {
    if (filter !== '전체' && item.type !== filter) {
      return false;
    }
    const keyword = search.trim().toLowerCase();
    return !keyword || `${item.merchant} ${item.benefit}`.toLowerCase().includes(keyword);
  }), [filter, search]);
  const selectTab = nextTab => {
    setSchedulePayment(null);
    setTab(nextTab);
  };
  const registerCard = async code => {
    if (!onRegisterCard || registeringCard) return;
    setRegisteringCard(true);
    try {
      await onRegisterCard(code);
    } catch (error) {
      Alert.alert('카드 등록', error?.message || '카드를 등록하지 못했어요.');
    } finally {
      setRegisteringCard(false);
    }
  };
  // 화면(탭)에 맞춘 추천 질문. AI 챗봇 평가 질문에서 골라 내 카드 이름을 넣는다 (utils/homeChat.js)
  const chatQuick = useMemo(() => suggestionsFor(tab, walletCards), [tab, walletCards]);
  const openChat = () => {
    if (typeof onOpenChat === 'function') {
      onOpenChat({
        cardId: currentCard?.id,
        cardName: currentCard?.name
      });
      return;
    }
    const where = { home: '홈', schedule: '오늘의 일정', benefits: '혜택', cards: '카드' }[tab] || '홈';
    setChatMessages([{
      id: 'greeting',
      role: 'bot',
      greeting: true,
      text: `안녕하세요, SOL 카드 도우미예요. ${where} 화면에서 궁금한 점을 물어보세요.` + (currentCard ? ` 지금 결제 카드는 ${currentCard.name}예요.` : '')
    }]);
    setChatInput('');
    setChatVisible(true);
  };
  // 앱 안의 기본 안내 (데모 모드, 또는 AI 챗봇에 연결하지 못했을 때)
  const localAnswer = q => {
    let answer = '카드 정보, 진행 중인 프로모션, 일정 등록 방법을 안내해드려요. 아래 추천 질문을 눌러보세요.';
    if (/프로모션|이벤트|진행/.test(q)) {
      const list = activePromotions();
      answer = list.length
        ? `지금 진행 중인 프로모션이 ${list.length}개 있어요. 예: ${[...new Set(list.map(item => item.merchant))].slice(0, 3).join(', ')}. 혜택 탭에서 각 항목을 누르면 결제 조건과 기간을 볼 수 있어요.`
        : '지금 진행 중인 프로모션이 없어요.';
    } else if (/일정.*(추가|등록|어떻게)|어떻게.*일정/.test(q)) {
      answer = '오늘의 일정 탭에서 [+ 일정 추가]를 누르면 반차·회식 같은 일정이나 카페·편의점 같은 장소 일정을 등록할 수 있어요. 등록한 일정에 맞는 카드는 홈에서 추천해드려요.';
    } else if (/일정|추천/.test(q)) {
      answer = currentCard
        ? `홈의 '오늘의 일정'에서 지금 일정에 맞는 카드를 추천해드려요. 일정이 없으면 현재 결제 카드(${currentCard.name})를 보여드려요.`
        : '카드를 먼저 등록하면 일정에 맞는 카드를 추천해드려요. 카드 탭에서 등록해보세요.';
    } else if (/등록/.test(q)) {
      answer = '카드 탭의 카드 상품에서 원하는 카드를 열어 내 카드로 등록할 수 있어요.';
    } else if (/바꾸|변경|순서/.test(q)) {
      answer = '결제 탭 위쪽의 [카드 변경]이나 아래 \'내 카드\' 목록에서 카드를 누르면 결제 카드가 바뀌어요. 목록의 ☰를 끌면 순서도 바꿀 수 있어요.';
    } else if (/내 카드|카드 정보|현재 카드|이유|왜/.test(q)) {
      answer = walletCards.length
        ? `내 카드는 ${walletCards.length}장이에요: ${walletCards.map(card => card.name).join(', ')}.` + (currentCard ? ` 지금 결제 카드는 ${currentCard.name}예요.` : '')
        : '등록된 카드가 없어요. 카드 탭에서 등록해보세요.';
    } else if (/혜택|할인|적립|어디/.test(q)) {
      answer = '혜택 탭에서 진행 중인 이벤트와 마이샵을 확인할 수 있어요. 항목을 누르면 결제 조건과 기간이 나와요.';
    } else if (/실적|한도/.test(q)) {
      answer = '전월 실적과 남은 혜택 한도는 실제 금융 데이터가 연결되지 않아 확인할 수 없어요.';
    }
    return answer;
  };
  const updateChat = (id, change) => setChatMessages(items => items.map(item => (item.id === id ? { ...item, ...change } : item)));
  // 서버 모드에서는 AI 챗봇(/api/ai/chat)에 묻는다 (2026-11-23 결정: 앱 사용법·프로모션도 AI 가 답한다).
  const askBot = (question = chatInput) => {
    const q = String(question).trim();
    if (!q || chatBusy) return;
    setChatInput('');
    const id = ++chatSeq.current;
    if (!SERVER_MODE) {
      setChatMessages(items => [...items, { id: 'q' + id, role: 'user', text: q }, { id, role: 'bot', text: localAnswer(q) }]);
      return;
    }
    const history = toChatHistory(chatMessages);
    setChatBusy(true);
    setChatMessages(items => [...items, { id: 'q' + id, role: 'user', text: q }, { id, role: 'bot', pending: true, text: '답변을 준비하고 있어요…' }]);
    api.aiChat({ message: q, history, screen: { name: tab } })
      .then(data => {
        if (!data?.reply) return { text: localAnswer(q), offline: true };
        const draft = data.rule_draft?.draft_id != null
          ? { id: data.rule_draft.draft_id, summary: data.rule_draft.summary || '', state: 'pending' }
          : null;
        return { text: data.reply, draft };
      })
      .catch(() => ({ text: localAnswer(q), offline: true }))
      .then(answer => {
        updateChat(id, { pending: false, ...answer });
        setChatBusy(false);
      });
  };
  // 챗봇이 만든 규칙 초안을 저장하거나 버린다
  const decideDraft = (item, action) => {
    updateChat(item.id, { draft: { ...item.draft, state: 'working' } });
    (action === 'confirm' ? api.aiConfirmRuleDraft(item.draft.id) : api.aiCancelRuleDraft(item.draft.id))
      .then(() => {
        if (action === 'confirm') refreshAi();
        return action === 'confirm' ? 'saved' : 'cancelled';
      })
      .catch(() => 'error')
      .then(state => updateChat(item.id, { draft: { ...item.draft, state } }));
  };
  const benefitTile = item => {
    const logo = PROMOTION_BRANDS[item.merchant]?.image || MYSHOP_LOGOS[item.merchant];
    return <TouchableOpacity
      key={item.id}
      accessibilityRole="button"
      accessibilityLabel={item.merchant + ' ' + item.benefit + ' 상세 조건'}
      style={styles.benefitTile}
      activeOpacity={0.8}
      onPress={() => setSelectedBenefit(item)}
    >
      <View style={styles.tileLogoArea}>
        {logo
          ? <Image source={logo} resizeMode="contain" style={styles.tileLogo} accessible={false} />
          : <Text style={styles.tileMerchant} numberOfLines={2}>{item.merchant}</Text>}
      </View>
      {logo && <Text style={styles.tileBrandLabel} numberOfLines={1}>{item.merchant}</Text>}
      <Text style={[styles.tileAmount, styles.tileCentered]}>{item.benefit}</Text>
      <View style={styles.tileFooter}>
        <Text style={styles.tileStatus}>{item.type} · {benefitStatus(item)}</Text>
        <Ionicons name="chevron-forward" size={15} color="#3168DF" />
      </View>
    </TouchableOpacity>;
  };
  const renderSchedule = (home = false) => <TodaySchedulePanel
    home={home}
    onOpenCards={() => selectTab('cards')}
    cardList={home ? <PaymentCardOrder cards={realWalletCards(currentCard, walletCards)} selectedId={currentCard?.id} onSelect={onSelectCard} /> : null}
    onOpenSchedule={() => selectTab('schedule')}
    disabled={scheduleDisabled}
    aiRefresh={aiRefresh}
    onEditRoutine={onEditRoutine}
    onViewBenefits={onViewBenefits}
    cards={realWalletCards(currentCard, walletCards)}
    selectedCard={currentCard}
    sampleActive={sampleActive}
    onStartSample={setSampleActive}
    onEndSample={() => setSampleActive(null)}
    onPay={openPaySheet}
  />;
  // 연말 결산 바로가기
  const renderYearEndTile = () => <TouchableOpacity accessibilityRole="button" accessibilityLabel="올해 카드 결산 보기"
      style={styles.yearEndTile} onPress={() => setYearEndOpen(true)}>
      <View style={styles.yearEndIcon}><Ionicons name="stats-chart-outline" size={20} color="#1459F5" /></View>
      <View style={styles.flexOne}>
        <Text style={styles.yearEndTitle}>올해 카드 결산</Text>
        <Text style={styles.yearEndText}>추천 카드로 얼마나 아꼈는지, 놓친 혜택은 얼마인지 확인해요</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#647890" />
    </TouchableOpacity>;

  const renderHomeHighlights = () => {
    const [promotion, ...morePromotions] = activePromotions();
    const [benefit, ...moreBenefits] = ALL_BENEFITS.filter(item =>
      item.type === '마이샵' && item.merchant !== promotion?.merchant && benefitStatus(item) === '기간 내'
    );
    const highlights = [];
    for (const item of [promotion, benefit, ...morePromotions, ...moreBenefits]) {
      if (item && !highlights.some(highlight => highlight.merchant === item.merchant)) highlights.push(item);
      if (highlights.length === 3) break;
    }
    if (!highlights.length) return null;

    return <View style={styles.homeHighlights}>
      <View style={styles.homeHighlightsHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>프로모션·혜택</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="혜택 더 보기"
          style={styles.homeHighlightsLink} onPress={() => selectTab('benefits')}>
          <Text style={styles.tileStatus}>혜택 더 보기</Text>
          <Ionicons name="chevron-forward" size={14} color="#3168DF" />
        </TouchableOpacity>
      </View>
      <View style={styles.homeHighlightsRow}>
        {highlights.map((item, index) => {
          const logo = PROMOTION_BRANDS[item.merchant]?.image || MYSHOP_LOGOS[item.merchant];
          return <TouchableOpacity key={item.id} accessibilityRole="button"
            accessibilityLabel={item.merchant + ' ' + item.benefit + ' 상세 조건'}
            style={[styles.homeHighlight, index === 1 && styles.homeHighlightMint, index === 2 && styles.homeHighlightPeach]}
            onPress={() => setSelectedBenefit(item)}>
            <View style={styles.homeHighlightIcon}>
              {logo ? <Image source={logo} resizeMode="contain" style={styles.homeHighlightLogo} accessible={false} />
                : <Ionicons name="gift-outline" size={20} color="#245DE5" accessible={false} />}
            </View>
            <Text style={styles.homeHighlightMerchant} numberOfLines={1}>{item.merchant}</Text>
            <Text style={styles.homeHighlightAmount} numberOfLines={2}>{item.benefit}</Text>
          </TouchableOpacity>;
        })}
      </View>
    </View>;
  };
  const renderBenefits = () => <>

      <BenefitReport offers={ALL_BENEFITS} date={kstToday()} />
      <Text accessibilityRole="header" style={styles.sectionTitle}>혜택 둘러보기</Text>
      {appNotice && <View style={styles.noticeStrip}>
        <Ionicons name="notifications-outline" size={16} color="#2C60C2" />
        <Text style={styles.noticeStripText}>이번 달 혜택 {ALL_BENEFITS.filter(item => benefitStatus(item) === '기간 내').length}건</Text>
      </View>}
      {[['sparkles-outline', '오늘의 카드 추천', 'recommendation'], ['pricetag-outline', '오늘의 프로모션', 'promotion']].map(([icon, label, kind]) =>
        <TouchableOpacity key={kind} accessibilityRole="button" accessibilityLabel={label}
          style={styles.homeLink} onPress={() => setAdRequest({ kind })}>
          <View style={styles.homeLinkIcon}><Ionicons name={icon} color="#174BCA" size={21} /></View>
          <Text style={styles.homeLinkTitle}>{label}</Text>
          <Ionicons name="chevron-forward" size={17} color="#66768D" />
        </TouchableOpacity>)}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#8C98AE" />
        <TextInput style={styles.searchInput} placeholder="가맹점 또는 혜택 검색" value={search} onChangeText={setSearch} placeholderTextColor="#99A4B3" />
        {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#A6AFBD" />
          </TouchableOpacity>}
      </View>

      <View style={styles.filterRow}>
        {['전체', '이벤트', '마이샵'].map(item => <TouchableOpacity key={item} style={[styles.filterChip, filter === item && styles.filterChipActive]} onPress={() => setFilter(item)}>
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>
              {item}
            </Text>
          </TouchableOpacity>)}
        <Text style={styles.filteredCount}>
          {visibleBenefits.length}개
        </Text>
      </View>

      <View style={styles.benefitGrid}>
        {visibleBenefits.map(item => benefitTile(item))}
      </View>

      {visibleBenefits.length === 0 && <Text style={styles.emptyText}>
          검색 결과가 없어요. 검색어를 바꿔주세요.
        </Text>}

      <Text style={styles.disclaimer}>
        현재 이용 가능 여부와 카드별 적용 조건은 각 혜택의 상세 안내를 확인해주세요.
      </Text>
    </>;
  const renderCardsHeader = () => <View style={styles.catalogHeading}>
      <WalletDeck cards={walletCards} selected={currentCard} onSelect={onSelectCard} canPay={Boolean(realProductCard(currentCard))} onPay={() => openPaySheet({ cardId: currentCard?.id })}
        highlight={findCatalog40Product(currentCard)?.benefits[0]?.name || WALLET_CARD_BENEFITS[currentCard?.id]?.highlights[0]?.value}
        status={currentCard?.status} onDetails={() => {
          const product = findCatalog40Product(currentCard);
          if (product) setSelectedCatalog(product);
          else if (WALLET_CARD_BENEFITS[currentCard?.id]) setWalletBenefitDetailsOpen(true);
        }} />

      {/* 내 지갑(보유 카드)과 전체 카드 상품을 확실히 나눠서, 상품 목록이 내 카드처럼 보이지 않게 합니다. */}
      <View style={styles.catalogDivider} />
      <Text style={{
      fontSize: 18,
      fontWeight: "800",
      color: '#203251'
    }}>
        전체 카드 상품
      </Text>
      <Text style={styles.catalogIssuer}>
        내 카드가 아닌 상품도 함께 보여요. 눌러서 혜택을 보고 내 카드로 등록할 수 있어요.
      </Text>

      <View style={styles.catalogFilterRow} accessibilityRole="tablist">
        {[['all', '전체'], ['owned', `내 카드 ${ownedCatalogCodes.size}`], ['notOwned', '미보유']].map(([key, label]) => {
        const active = catalogFilter === key;
        return <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: active }}
            onPress={() => setCatalogFilter(key)} style={[styles.catalogFilterChip, active && styles.catalogFilterChipActive]}>
            <Text style={[styles.catalogFilterText, active && styles.catalogFilterTextActive]}>{label}</Text>
          </TouchableOpacity>;
      })}
      </View>

      <TextInput placeholder="카드 이름이나 혜택 검색" value={catalogQuery} onChangeText={setCatalogQuery} style={{
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: '#E2E8F2',
      padding: 12,
      borderRadius: 12,
      marginBottom: 12
    }} />

    </View>;
  const renderCards = () => {
    const query = catalogQuery.trim().toLowerCase();
    const byQuery = query ? catalogCards.filter(card =>
      [card.name, card.issuer, card.description, ...card.tags, ...card.benefits.map(benefit => benefit.name)]
        .join(' ').toLowerCase().includes(query)
    ) : catalogCards;
    // '전체'에서는 내 카드를 맨 위에, 그 아래에 미보유 카드를 보여준다(같은 묶음 안의 순서는 그대로)
    const results = catalogFilter === 'all'
      ? [...byQuery.filter(card => ownedCatalogCodes.has(card.code)), ...byQuery.filter(card => !ownedCatalogCodes.has(card.code))]
      : byQuery.filter(card => ownedCatalogCodes.has(card.code) === (catalogFilter === 'owned'));
    return <FlatList style={styles.mainScroll} contentContainerStyle={[styles.pageContent, styles.chatClearance]}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      data={results} keyExtractor={card => card.code} ListHeaderComponent={renderCardsHeader()}
      initialNumToRender={5} maxToRenderPerBatch={5} windowSize={3}
      ListEmptyComponent={<Text style={styles.catalogIssuer}>
        {catalogFilter === 'owned' && !query ? '아직 등록한 내 카드가 없어요. 전체 상품에서 카드를 눌러 등록해보세요.' : '검색 결과가 없어요.'}
      </Text>}
      renderItem={({ item }) => {
        const owned = ownedCatalogCodes.has(item.code);
        return <TouchableOpacity accessibilityRole="button" accessibilityLabel={item.name + (owned ? ' 내 카드' : ' 미보유 상품') + ' 상세'}
          onPress={() => setSelectedCatalog(item)} style={[styles.catalogRow, owned && styles.catalogRowOwned]}>
        {!!item.image && <Image source={item.image} resizeMode="contain" fadeDuration={0}
          style={styles.catalogThumb} accessibilityLabel={item.name + ' 상품 이미지'} />}
        <View style={styles.catalogRowText}>
          <View style={[styles.catalogBadge, owned ? styles.catalogBadgeOwned : styles.catalogBadgeProduct]}>
            <Text style={[styles.catalogBadgeText, owned && styles.catalogBadgeTextOwned]}>{owned ? '✓ 내 카드' : '미보유 · 상품'}</Text>
          </View>
          <Text style={styles.catalogName}>{item.name}</Text>
          <Text style={styles.catalogIssuer}>{item.issuer} · {item.type}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#647890" />
      </TouchableOpacity>;
      }}
    />;
  };

  const renderSettings = () => <>
      <View style={styles.settingsHeader}>
        <TouchableOpacity onPress={() => setSettingsOpen(false)} style={styles.settingsHeaderButton}>
          <Ionicons name="arrow-back" size={24} color="#1B2C47" />
        </TouchableOpacity>

        <Text style={styles.settingsHeaderTitle}>설정</Text>

        <TouchableOpacity onPress={() => goFromSettings('home')} style={styles.settingsHeaderButton}>
          <Ionicons name="home-outline" size={24} color="#1B2C47" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.settingsScroll} contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
        <SettingsGroup title="로그인·인증">
          <SettingsItem icon="keypad-outline" title="현재 로그인 방식" subtitle="앱을 다시 열면 6자리 간편비밀번호로 확인해요" value={hasPin ? '간편 PIN' : '미설정'} />
          <SettingsItem icon="lock-closed-outline" title="간편비밀번호 변경" subtitle="기존 번호를 확인한 뒤 새 6자리로 변경" onPress={() => {
          if (!hasPin) {
            Alert.alert('간편비밀번호 미설정', '가입을 마치고 간편비밀번호를 등록해주세요.');
            return;
          }
          setPinChangeOpen(true);
        }} />
        </SettingsGroup>

        <SettingsGroup title="결산">
          <SettingsItem icon="stats-chart-outline" title="연말 결산" subtitle="올해 아낀 금액·놓친 금액과 월별 추천 기록" onPress={() => setYearEndOpen(true)} />
        </SettingsGroup>

        <SettingsGroup title="알림">
          <SettingsToggle icon="notifications-outline" title="앱 내 혜택 알림" subtitle="혜택 탭에 진행 중인 혜택 안내 표시" value={appNotice} disabled={settingsBusy} onChange={value => persistUISettings(value, vibrationOn)} />
        </SettingsGroup>

        <SettingsGroup title="편의 기능">
          <SettingsItem icon="qr-code-outline" title="결제" subtitle="QR·바코드 및 예상 혜택 확인" onPress={() => goFromSettings('payment')} />
          <SettingsItem icon="card-outline" title="카드 관리" subtitle="등록된 카드 목록" onPress={() => goFromSettings('cards')} />
          <SettingsToggle icon="phone-portrait-outline" title="버튼 진동" value={vibrationOn} disabled={settingsBusy} onChange={value => persistUISettings(appNotice, value)} />
          <SettingsItem icon="pulse-outline" title="진동 확인" subtitle="버튼 진동 설정이 켜져 있을 때만 작동" onPress={() => {
          if (vibrationOn) {
            if (Platform.OS !== 'web') {
              Vibration.vibrate(30);
            }
          } else {
            Alert.alert('진동 꺼짐', '버튼 진동을 켜고 다시 시도해주세요.');
          }
        }} />
        </SettingsGroup>

        <SettingsGroup title="서비스·이용 동의">
          {PHONE_NOTIFICATIONS_SUPPORTED
            ? <SettingsToggle icon="notifications-outline" title="폰 알림 받기 (알림 수신 동의)" subtitle="매일 아침 8시 안내 · 일정 30분 전 알림" value={savedConsent?.morningNotificationAgreed === true} disabled={phoneNotifyBusy || !savedConsent} onChange={togglePhoneNotifications} />
            : <SettingsItem icon="notifications-outline" title="알림 수신 동의" value={savedConsent ? savedConsent.morningNotificationAgreed ? '선택함' : '선택 안 함' : '기록 없음'} subtitle="폰 알림은 아이폰·안드로이드 앱에서만 받을 수 있어요" />}
        </SettingsGroup>

        <SettingsGroup title="앱 정보">
          <SettingsItem icon="time-outline" title="이번 접속" value={sessionOpenedAt.toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })} />
          <SettingsItem icon="refresh-outline" title="화면 설정 초기화" subtitle="혜택 알림·진동만 기본값으로 복원" onPress={resetViewSettings} />
          <SettingsItem icon="log-out-outline" title="잠금 및 로그아웃" subtitle="간편비밀번호 또는 이메일 로그인 선택" onPress={() => setExitOpen(true)} />
        </SettingsGroup>

        <AccountWithdrawal />

      </ScrollView>
    </>;
  return <SafeAreaView style={styles.root}><RecommendationLaunchPopup onClosed={refreshAi} selectedWalletCard={currentCard} allowAutomaticAds={tab === 'home' && allowAutomaticAds} onViewPromotions={() => selectTab('benefits')} promotions={activePromotions()} openRequest={adRequest} enabled={(tab === 'home' || tab === 'benefits') && !settingsOpen && !exitOpen && !pinChangeOpen && !chatVisible && !selectedBenefit && !walletBenefitDetailsOpen && !selectedCatalog} />
      {!settingsOpen && tab !== 'payment' && <View style={[styles.topBar, tab === 'cards' && styles.walletTopBar]}>
          <View>
            <Text style={[styles.brand,{color:tab === 'cards' ? "#FFFFFF" : "#134CCA",fontSize:27}]}>SOL·Pay</Text>

          </View>

          <View style={styles.headerActions}>
            <NotificationBell items={inbox} onPress={() => setNotificationsOpen(true)} />

            <TouchableOpacity style={styles.iconCircle} onPress={() => setSettingsOpen(true)}>
              <Ionicons name="settings-outline" size={21} color="#244E9C" />
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button" accessibilityLabel="잠금 및 로그아웃" style={styles.iconCircle} onPress={() => setExitOpen(true)}>
              <Ionicons name="log-out-outline" size={21} color="#244E9C" />
            </TouchableOpacity>
          </View>
        </View>}

      <View style={styles.mainArea}>
        {settingsOpen ? renderSettings() : tab === 'payment' ? <PaymentScreen
          key={schedulePayment ? 'schedule-payment' : 'standard-payment'}
          card={currentCard}
          cards={walletCards}
          schedule={schedulePayment}
          onSelectCard={onSelectCard}
          onClose={() => selectTab(schedulePayment?.returnTab || 'home')}
          onOpenCards={() => selectTab('cards')}
        /> : tab === 'cards' ? renderCards() : <ScrollView key={tab} style={styles.mainScroll} contentContainerStyle={[styles.pageContent, styles.chatClearance]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {tab === 'home' && <>{renderSchedule(true)}{renderYearEndTile()}{renderHomeHighlights()}</>}
            {tab === 'benefits' && renderBenefits()}
            {tab === 'schedule' && renderSchedule()}
          </ScrollView>}
        {!settingsOpen && tab !== 'payment' && !chatVisible && <View pointerEvents="box-none" style={styles.chatDock}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="챗봇 열기" onPress={openChat} style={styles.chatFab}>
            <Image source={require('../assets/chatbot-avatar.png')} resizeMode="contain" style={styles.chatAvatar} />
          </TouchableOpacity>
        </View>}
      </View>

      {!settingsOpen && <View style={styles.bottomNav}>
          {NAV.map(item => {
        const active = item.id === tab;
        return <TouchableOpacity key={item.id} accessibilityRole="tab" accessibilityState={{selected:active}} style={[styles.navItem,active && {borderTopWidth:3,borderTopColor:"#175BE3"}]} onPress={() => item.id === 'payment' && realProductCard(currentCard) ? openPaySheet({ cardId: currentCard.id }) : selectTab(item.id)}>
                <Ionicons name={active ? item.active : item.icon} size={23} color={active ? '#245CEA' : '#98A2B4'} />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>;
      })}
        </View>}

      {Platform.OS === 'web' && <View style={styles.devClearance} />}

      <YearEndReport visible={yearEndOpen} onClose={() => setYearEndOpen(false)} />
      <QuickPaySheet visible={!!paySheet} cards={walletCards} cardId={currentCard?.id} context={paySheet}
        onSelectCard={onSelectCard} onClose={() => setPaySheet(null)} onOpenDetails={openFullPayment} />
      <NotificationCenter visible={notificationsOpen} items={inbox} onClose={() => setNotificationsOpen(false)} onOpenTarget={openNotificationTarget} />

      <Modal visible={exitOpen} transparent animationType="fade" onRequestClose={() => setExitOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.exitSheet}>
            <Text accessibilityRole="header" style={styles.exitTitle}>잠금 및 로그아웃</Text>
            {canLock && <TouchableOpacity accessibilityRole="button" style={styles.exitOption} onPress={() => {setExitOpen(false); onLogout?.('lock');}}>
              <Text style={styles.exitOptionTitle}>잠금</Text>
              <Text style={styles.exitHint}>간편비밀번호로 다시 열기</Text>
            </TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" style={styles.exitOption} onPress={() => {setExitOpen(false); onLogout?.('logout');}}>
              <Text style={[styles.exitOptionTitle,{color:'#B93842'}]}>완전 로그아웃</Text>
              <Text style={styles.exitHint}>이메일과 비밀번호로 다시 로그인</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.exitCancel} onPress={() => setExitOpen(false)}>
              <Text style={styles.exitOptionTitle}>취소</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={pinChangeOpen} transparent animationType="slide" onRequestClose={closePinChange}>
        <KeyboardAvoidingView style={styles.pinModalDim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>
              간편비밀번호 변경
            </Text>
            <Text style={styles.pinStepText}>{pinStep + 1} / 3 단계</Text>
            <Text style={styles.pinInputLabel}>{PIN_STEPS[pinStep][1]}</Text>
            <Text style={styles.pinModalDesc}>{PIN_STEPS[pinStep][2]}</Text>

            <View style={styles.pinDotsWrap}>
              <PinDotsInput key={pinStep} value={pinForm[PIN_STEPS[pinStep][0]]} onChangeText={onPinDigits} autoFocus editable={!pinSaving} accessibilityLabel={PIN_STEPS[pinStep][1]} />
            </View>

            {!!pinMsg && <Text style={styles.pinErrorText} accessibilityLiveRegion="polite">{pinMsg}</Text>}
            {pinSaving && <Text style={styles.pinModalDesc}>저장 중...</Text>}

            <View style={styles.pinModalButtons}>
              <TouchableOpacity style={styles.pinCancel} onPress={closePinChange} disabled={pinSaving}>
                <Text style={styles.pinCancelText}>
                  취소
                </Text>
              </TouchableOpacity>


            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 카드별 혜택 상세보기 */}
      <Modal visible={walletBenefitDetailsOpen} transparent animationType="fade" onRequestClose={() => setWalletBenefitDetailsOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <ScrollView contentContainerStyle={styles.modalBody}>
              <Text style={styles.modalEyebrow}>
                내 지갑 · 카드 혜택
              </Text>
              <Text style={styles.modalTitle}>
                {currentCard?.name}
              </Text>

              {WALLET_CARD_BENEFITS[currentCard?.id] ? <>
                  <Text style={styles.walletBenefitDetailIntro}>
                    {WALLET_CARD_BENEFITS[currentCard.id].description}
                  </Text>

                  {WALLET_CARD_BENEFITS[currentCard.id].highlights.map((entry, index) => <View key={index} style={styles.detailRow}>
                        <Text style={styles.detailKey}>
                          {entry.label}
                        </Text>
                        <Text style={styles.detailVal}>
                          {entry.value}
                        </Text>
                      </View>)}

                  <View style={styles.detailRow}>
                    <Text style={styles.detailKey}>
                      이용 조건
                    </Text>
                    <Text style={styles.detailVal}>
                      {WALLET_CARD_BENEFITS[currentCard.id].condition}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailKey}>
                      한도·횟수
                    </Text>
                    <Text style={styles.detailVal}>
                      {WALLET_CARD_BENEFITS[currentCard.id].limit}
                    </Text>
                  </View>

                  <Text style={styles.noticeTitle}>
                    알아두세요
                  </Text>
                  <Text style={styles.noticeText}>
                    {WALLET_CARD_BENEFITS[currentCard.id].note}
                  </Text>

                  <Text style={styles.modalFineprint}>
                    {currentCard.source || '제공된 상품 안내서'} 참고.
                    전월 실적과 남은 혜택 한도는 카드사에서 확인해주세요.
                  </Text>
                </> : <Text style={styles.noticeText}>
                  정확한 카드 상품 안내서가 없어 혜택을
                  임의로 표시하지 않았습니다.
                </Text>}
            </ScrollView>

            <TouchableOpacity style={styles.modalDone} onPress={() => setWalletBenefitDetailsOpen(false)}>
              <Text style={styles.modalDoneText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 이벤트·마이샵 상세보기 */}
      <Modal visible={!!selectedBenefit} transparent animationType="fade" onRequestClose={() => setSelectedBenefit(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalPanel}>
            <ScrollView contentContainerStyle={styles.modalBody}>
              {selectedBenefit && <>
                  <Text style={styles.modalEyebrow}>
                    {selectedBenefit.type} 상세 정보
                  </Text>
                  <Text style={styles.modalTitle}>
                    {selectedBenefit.merchant}
                  </Text>

                  <View style={styles.modalHighlight}>
                    <Text style={styles.modalHighlightLabel}>
                      혜택 내용
                    </Text>
                    <Text style={styles.modalHighlightValue}>
                      {selectedBenefit.benefit}
                    </Text>
                  </View>

                  {[['결제 조건', selectedBenefit.method], ['최소 결제', money(selectedBenefit.minimum)], ['최대 혜택한도', money(selectedBenefit.cap)], ['기간', `${selectedBenefit.start} ~ ${selectedBenefit.end}`], ['혜택 지급일', selectedBenefit.payout], ['현재 기간 상태', benefitStatus(selectedBenefit)]].map(([label, value]) => <View style={styles.detailRow} key={label}>
                      <Text style={styles.detailKey}>{label}</Text>
                      <Text style={styles.detailVal}>{value}</Text>
                    </View>)}

                  <Text style={styles.noticeTitle}>
                    유의사항
                  </Text>
                  <Text style={styles.noticeText}>
                    {selectedBenefit.note || '원본 자료에 별도 유의사항 미기재'}
                  </Text>

                  {selectedBenefit.type === '마이샵' && <Text style={styles.noticeText}>
                      마이샵 혜택은 해당 항목을 ON으로
                      설정해야 합니다.
                    </Text>}

                  <Text style={styles.modalFineprint}>
                    개인별 혜택 적용 및 중복 사용 여부는 카드사 안내를 확인해주세요.
                  </Text>
                </>}
            </ScrollView>

            <TouchableOpacity style={styles.modalDone} onPress={() => setSelectedBenefit(null)}>
              <Text style={styles.modalDoneText}>확인</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 챗봇 */}
      <Modal visible={chatVisible} animationType="slide" onRequestClose={() => setChatVisible(false)}>
        <SafeAreaView style={styles.chatRoot}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle}>
              🤖 SOL 카드 도우미
            </Text>
            <TouchableOpacity onPress={() => setChatVisible(false)}>
              <Ionicons name="close" size={25} color="#27344D" />
            </TouchableOpacity>
          </View>

          <Text style={styles.chatInfo}>
            {currentCard ? '현재 카드: ' + currentCard.name : '등록된 카드가 없습니다'}
          </Text>

          <KeyboardAvoidingView style={{
          flex: 1
        }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView ref={chatScroll} onContentSizeChange={() => chatScroll.current?.scrollToEnd({ animated: true })} style={{
            flex: 1
          }} contentContainerStyle={styles.messages}>
              {chatMessages.map((item, index) => <View key={item.id ?? index} style={[styles.chatBubble, item.role === 'user' && styles.chatUserBubble]}>
                  <Text style={[styles.chatBubbleText, item.role === 'user' && styles.chatUserText]}>
                    {item.text}
                  </Text>
                  {!!item.offline && <Text style={styles.chatNote}>AI 챗봇에 연결하지 못해 기본 안내로 답했어요.</Text>}
                  {!!item.draft && <View style={styles.chatDraft}>
                      {!!item.draft.summary && <Text style={styles.chatBubbleText}>{item.draft.summary}</Text>}
                      {(item.draft.state === 'pending' || item.draft.state === 'error') && <View style={styles.chatDraftButtons}>
                          <TouchableOpacity accessibilityRole="button" style={styles.chatDraftSave} onPress={() => decideDraft(item, 'confirm')}>
                            <Text style={styles.chatDraftSaveText}>저장</Text>
                          </TouchableOpacity>
                          <TouchableOpacity accessibilityRole="button" style={styles.quickButton} onPress={() => decideDraft(item, 'cancel')}>
                            <Text style={styles.quickButtonText}>취소</Text>
                          </TouchableOpacity>
                        </View>}
                      {item.draft.state === 'working' && <Text style={styles.chatNote}>처리하고 있어요…</Text>}
                      {item.draft.state === 'saved' && <Text style={styles.chatNote}>저장했어요. 다음 결제 화면부터 적용돼요.</Text>}
                      {item.draft.state === 'cancelled' && <Text style={styles.chatNote}>저장하지 않았어요.</Text>}
                      {item.draft.state === 'error' && <Text style={styles.chatNote}>처리하지 못했어요. 다시 눌러 주세요.</Text>}
                    </View>}
                </View>)}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickArea} contentContainerStyle={{
            paddingHorizontal: 14
          }}>
              {chatQuick.map(item => <TouchableOpacity key={item} disabled={chatBusy} style={[styles.quickButton, chatBusy && { opacity: 0.5 }]} onPress={() => askBot(item)}>
                  <Text style={styles.quickButtonText}>
                    {item}
                  </Text>
                </TouchableOpacity>)}
            </ScrollView>

            <View style={styles.chatInputRow}>
              <TextInput style={styles.chatInput} value={chatInput} onChangeText={setChatInput} placeholder="질문을 입력하세요" returnKeyType="send" onSubmitEditing={() => askBot()} />
              <TouchableOpacity style={[styles.chatSend, chatBusy && { opacity: 0.5 }]} disabled={chatBusy} onPress={() => askBot()}>
                <Ionicons name="send" size={19} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <Modal visible={!!selectedCatalog} transparent animationType="fade" onRequestClose={() => setSelectedCatalog(null)}>
        <View style={{
        flex: 1,
        backgroundColor: 'rgba(15,28,52,0.55)',
        justifyContent: 'center',
        padding: 18
      }}>
          <View style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 20,
          maxHeight: '85%'
        }}>
            <ScrollView contentContainerStyle={{
            padding: 20
          }}>
              {selectedCatalog && <>
                  <Text style={{
                fontSize: 19,
                fontWeight: "800",
                color: '#1E3150'
              }}>
                    {selectedCatalog.name}
                  </Text>

                  <Text style={{
                fontSize: 12,
                color: '#62738E',
                marginTop: 8,
                marginBottom: 14
              }}>
                    {selectedCatalog.description}
                  </Text>
                  {!!selectedCatalog.image && <Image source={selectedCatalog.image} resizeMode="contain" style={styles.catalogPlate} accessibilityLabel={selectedCatalog.name + ' 상품 이미지'}/>}
                  {onRegisterCard && canRegisterWalletCard(selectedCatalog.code) && (
                    walletCards.some(card => card.catalogCode === selectedCatalog.code)
                      ? <Text style={styles.catalogIssuer}>지갑에 등록된 카드</Text>
                      : <TouchableOpacity accessibilityRole="button" disabled={registeringCard}
                          style={styles.walletBenefitDetailButton} onPress={() => registerCard(selectedCatalog.code)}>
                          <Text style={styles.walletBenefitDetailButtonText}>{registeringCard ? '등록 중…' : '보유 카드로 등록'}</Text>
                        </TouchableOpacity>
                  )}
                  {selectedCatalog.registryCardId != null && <Text style={styles.catalogFee}>
                    국내 연회비 {money(selectedCatalog.annualFeeDomestic)} · 해외 연회비 {money(selectedCatalog.annualFeeOverseas)}
                  </Text>}
                  {selectedCatalog.code === 'DB40_21' && <TouchableOpacity accessibilityRole="link"
                    style={styles.walletBenefitDetailButton} onPress={() => Linking.openURL(selectedCatalog.sourcePage).catch(() => Alert.alert('상품 안내', '브라우저에서 BC카드 상품 안내를 열어주세요.'))}>
                    <Text style={styles.walletBenefitDetailButtonText}>BC카드 공식 상품 안내</Text>
                  </TouchableOpacity>}

                  {selectedCatalog.benefits.map((b, i) => <View key={i} style={{
                paddingVertical: 11,
                borderBottomWidth: 1,
                borderBottomColor: "#E3EAF4"
              }}>
                      <Text style={{
                  fontWeight: '700',
                  color: '#1D304D'
                }}>
                        {b.name}
                      </Text>

                      <Text style={{
                  color: "#245DE5",
                  fontWeight: '800',
                  marginTop: 4
                }}>
                        {b.rate != null ? Math.round(b.rate * 10000) / 100 + '% · ' + b.type : b.fixedAmount != null ? b.fixedAmount.toLocaleString('ko-KR') + (b.type === 'POINT' ? 'P' : '원') + ' · ' + b.type : selectedCatalog.registryCardId ? b.type : '부가 혜택 · ' + b.type}
                      </Text>

                      {!selectedCatalog.registryCardId && <Text style={{
                  color: '#6B7990',
                  fontSize: 12,
                  marginTop: 5
                }}>
                        {b.minPrevSpend == null ? '실적 조건 미기재' : b.minPrevSpend === 0 ? '전월 실적 없음' : '전월 ' + b.minPrevSpend.toLocaleString('ko-KR') + '원 이상'}
                        {b.monthlyCap != null ? ' · 월 한도 ' + b.monthlyCap.toLocaleString('ko-KR') : ''}
                      </Text>}

                      {!!b.note && <Text style={{
                  color: '#8894A6',
                  fontSize: 12,
                  marginTop: 4
                }}>
                          {b.note}
                        </Text>}
                    </View>)}

                  {!!selectedCatalog.tiers.length && <Text style={{
                fontSize: 16,
                fontWeight: "800",
                marginTop: 16
              }}>
                      실적별 한도
                    </Text>}

                  {selectedCatalog.tiers.map((t, i) => <Text key={i} style={{
                color: '#5B6D85',
                fontSize: 12,
                lineHeight: 20,
                marginTop: 8
              }}>
                      {t.capGroup} · 전월{' '}
                      {Number(t.minPrevSpend).toLocaleString('ko-KR')}원
                      이상 ·{' '}
                      {Number(t.monthlyCap).toLocaleString('ko-KR')}{' '}
                      {t.unit}
                    </Text>)}

                  <Text style={{
                color: '#96A1B1',
                fontSize: 12,
                marginTop: 15
              }}>
                    혜택 적용 여부와 남은 한도는 카드사에서 확인해주세요.
                  </Text>
                </>}
            </ScrollView>

            <TouchableOpacity onPress={() => setSelectedCatalog(null)} style={{
            backgroundColor: "#245DE5",
            padding: 14,
            alignItems: 'center',
            margin: 15,
            borderRadius: 12
          }}>
              <Text style={{
              color: "#FFFFFF",
              fontWeight: '800'
            }}>
                닫기
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>;
}
const styles = StyleSheet.create({
  exitSheet:{width:'100%',maxWidth:400,alignSelf:'center',backgroundColor:'#FFFFFF',borderRadius:24,padding:20,gap:10},
  exitTitle:{fontSize:21,fontWeight:'800',color:'#142D4E',marginBottom:2},
  exitOption:{minHeight:62,backgroundColor:'#F0F5FE',borderRadius:14,padding:12,justifyContent:'center',gap:4},
  exitOptionTitle:{fontSize:16,fontWeight:'700',color:'#142D4E'},
  exitHint:{fontSize:13,color:'#526783'},
  exitCancel:{minHeight:44,alignItems:'center',justifyContent:'center'},
  catalogHeading:{gap:8},
  catalogRow:{flexDirection:'row',alignItems:'center',gap:12,minHeight:82,padding:10,borderRadius:14,backgroundColor:'#FFFFFF'},
  catalogRowText:{flex:1,gap:4},
  catalogName:{fontSize:14,fontWeight:'800',color:'#1D304D'},
  catalogIssuer:{fontSize:12,color:'#586E8B'},
  catalogThumb:{width:92,height:62},
  yearEndTile:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#FFFFFF',borderRadius:16,padding:14,marginTop:14},
  yearEndIcon:{width:40,height:40,borderRadius:20,backgroundColor:'#E4EDFF',alignItems:'center',justifyContent:'center'},
  yearEndTitle:{fontSize:15,fontWeight:'800',color:'#1D304D'},
  yearEndText:{fontSize:12,lineHeight:18,color:'#586E8B',marginTop:2},
  flexOne:{flex:1},
  catalogDivider:{height:1,backgroundColor:'#E2E8F2',marginTop:18,marginBottom:6},
  catalogFilterRow:{flexDirection:'row',gap:8,marginTop:4},
  catalogFilterChip:{paddingHorizontal:14,paddingVertical:8,borderRadius:999,backgroundColor:'#EEF2F8'},
  catalogFilterChipActive:{backgroundColor:'#1459F5'},
  catalogFilterText:{fontSize:13,fontWeight:'700',color:'#4A5D7A'},
  catalogFilterTextActive:{color:'#FFFFFF'},
  catalogRowOwned:{borderWidth:1.5,borderColor:'#9DB8F5'},
  catalogBadge:{alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:2,borderRadius:6},
  catalogBadgeOwned:{backgroundColor:'#E4EDFF'},
  catalogBadgeProduct:{backgroundColor:'#F1F3F6'},
  catalogBadgeText:{fontSize:11,fontWeight:'700',color:'#6A7A91'},
  catalogBadgeTextOwned:{color:'#1459F5'},
  catalogPlate:{width:'100%',maxWidth:300,height:180,alignSelf:'center'},
  catalogFee:{fontSize:13,lineHeight:20,color:'#526783',marginVertical:8},
  chatClearance:{paddingBottom:90},
  chatDock:{position:'absolute',bottom:14,width:'100%',maxWidth:640,alignSelf:'center',alignItems:'flex-end',paddingRight:16,zIndex:2},
  chatFab:{width:62,height:62,borderRadius:31,backgroundColor:'#FFFFFF',borderWidth:1,borderColor:'#DDE7F5',alignItems:'center',overflow:'hidden'},
  chatAvatar:{position:'absolute',left:-20,top:1,width:100,height:56},
  tileLogoArea:{height:64,justifyContent:'center',alignItems:'center',backgroundColor:'#FFFFFF'},
  tileLogo:{width:'92%',maxWidth:132,height:48},
  tileBrandLabel:{fontSize:12,color:'#536C88',textAlign:'center',marginTop:5},
  tileCentered:{textAlign:'center',marginTop:6},
  walletTopBar:{backgroundColor:'#0B1940'},
  homeLinkIcon:{height:38,width:38,borderRadius:12,backgroundColor:'#EDF4FF',alignItems:'center',justifyContent:'center'},
  homeLink:{flexDirection:'row',alignItems:'center',minHeight:54,gap:14},
  homeLinkTitle:{flex:1,fontSize:17,fontWeight:'700',color:'#13223B'},
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF"
  },
  topBar: {
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: "#FFFFFF",
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: "#E3EAF4",
    borderBottomWidth: 0,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingVertical: 16
  },
  brand: {
    fontSize: 25,
    fontWeight: "800",
    color: "#142D4E"
  },
  brandCaption: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: "#5A6E89",
    marginTop: 2
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#EDF3FF",
    justifyContent: 'center',
    alignItems: 'center'
  },
  mainArea: {
    flex: 1
  },
  mainScroll: {
    flex: 1
  },
  pageContent: {
    paddingTop: 18,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    gap: 14
  },
  homeHighlights: { gap: 8 },
  homeHighlightsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  homeHighlightsLink: { minHeight: 44, flexDirection: 'row', gap: 4, alignItems: 'center' },
  homeHighlightsRow: { flexDirection: 'row', gap: 8 },
  homeHighlight: {
    flexBasis: 0, flexGrow: 1, minWidth: 0, maxWidth: '33.33%', minHeight: 106, maxHeight: 178, aspectRatio: 1.1,
    alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 5, paddingVertical: 8,
    borderRadius: 18, borderWidth: 1, borderColor: '#E3ECFC', backgroundColor: '#EEF4FF'
  },
  homeHighlightMint: { borderColor: '#DDEFEA', backgroundColor: '#ECF8F3' },
  homeHighlightPeach: { borderColor: '#F7E9DB', backgroundColor: '#FFF5EA' },
  homeHighlightIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  homeHighlightLogo: { width: 28, height: 25 },
  homeHighlightMerchant: { maxWidth: '100%', color: '#526783', fontSize: 11, textAlign: 'center' },
  homeHighlightAmount: { color: '#142D4E', fontSize: 12, lineHeight: 15, fontWeight: '800', textAlign: 'center' },
  hero: {
    borderRadius: 24,
    backgroundColor: "#245DE5",
    padding: 24,
    marginBottom: 0
  },
  heroEyebrow: {
    color: '#A9CAF9',
    fontWeight: '800',
    letterSpacing: 0.8,
    fontSize: 12,
    marginBottom: 14,
    lineHeight: 19
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 39
  },
  heroSub: {
    color: '#D0E0FF',
    fontSize: 14,
    lineHeight: 23,
    marginTop: 10
  },
  heroAction: {
    alignSelf: 'flex-start',
    marginTop: 20,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46
  },
  heroActionText: {
    color: '#173E89',
    fontSize: 13,
    fontWeight: '800'
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 0
  },
  sectionTitle: {
    color: "#142D4E",
    fontSize: 19,
    fontWeight: "800",
    lineHeight: 28
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center'
  },
  moreText: {
    color: '#6A7590',
    fontSize: 12,
    fontWeight: '600'
  },
  walletHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
    paddingHorizontal: 4
  },
  walletHintText: {
    fontSize: 12,
    color: '#6980A3',
    flexShrink: 1,
    lineHeight: 17
  },
  walletBenefitDetailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#E9EEF6',
    paddingTop: 13
  },
  walletBenefitDetailButtonText: {
    fontSize: 13,
    color: '#225CD6',
    fontWeight: '800'
  },
  walletBenefitDetailIntro: {
    color: '#63728B',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 11,
    marginBottom: 15
  },
  walletCard: {
    borderRadius: 20,
    padding: 24,
    minHeight: 194,
    gap: 12,
    justifyContent: 'space-between'
  },
  walletCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  walletIssuer: {
    fontSize: 13,
    fontWeight: '700',
    opacity: 0.9
  },
  walletCardName: {
    fontSize: 22,
    fontWeight: '800'
  },
  walletCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  chipMark: {
    width: 39,
    height: 27,
    borderRadius: 5,
    backgroundColor: '#EED277',
    borderWidth: 1,
    borderColor: '#D5B15E'
  },
  cardDigits: {
    flexShrink: 1,
    marginLeft: 12,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1.8
  },
  benefitTile: {
    width: '48%',
    minHeight: 176,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 20,
    padding: 18,
    marginBottom: 10,
    justifyContent: 'space-between'
  },
  tileTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 5
  },
  tileMerchant: {
    flex: 1,
    color: '#23314B',
    fontSize: 12,
    fontWeight: '800'
  },
  smallCategory: {
    color: '#5A7BC2',
    backgroundColor: "#EDF3FF",
    fontSize: 12,
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3
  },
  tileAmount: {
    color: '#2462E5',
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
    marginTop: 11
  },
  tileCondition: {
    color: '#7C8799',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6
  },
  tileFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EEF2F7',
    paddingTop: 9,
    marginTop: 10
  },
  tileStatus: {
    fontSize: 12,
    fontWeight: '700',
    color: '#74829A'
  },
  demoLabel: {
    fontSize: 12,
    color: '#2860CE',
    backgroundColor: "#EDF3FF",
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontWeight: '800'
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10
  },
  botAvatar: {
    width: 66,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center'
  },
  botEmoji: {
    fontSize: 35
  },
  botName: {
    color: '#2462DD',
    fontWeight: "800",
    fontSize: 12,
    marginTop: 3
  },
  speechBubble: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: '#DFE6F1',
    borderRadius: 17,
    padding: 15
  },
  speechCategory: {
    color: '#2462DD',
    fontSize: 12,
    fontWeight: '800'
  },
  speechName: {
    color: "#142D4E",
    fontSize: 15,
    fontWeight: '800',
    marginTop: 7
  },
  speechReason: {
    color: '#6C7890',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 9
  },
  chatLink: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EBF0F7',
    marginTop: 13,
    paddingTop: 11
  },
  chatLinkText: {
    flex: 1,
    color: '#275FDC',
    fontSize: 12,
    fontWeight: '800'
  },
  ruleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#E4EAF4'
  },
  ruleCopy: {
    flex: 1,
    paddingRight: 8
  },
  ruleTitle: {
    color: '#22314A',
    fontWeight: '800',
    fontSize: 15
  },
  ruleDesc: {
    color: '#727D90',
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17
  },
  ruleHint: {
    color: '#9CA5B5',
    fontSize: 12,
    marginTop: 6
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: '#E4EAF4',
    borderRadius: 13,
    paddingHorizontal: 13,
    height: 48
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#23314B'
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
    marginBottom: 17
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: '#E4EAF4'
  },
  filterChipActive: {
    backgroundColor: '#235DE6',
    borderColor: '#235DE6'
  },
  filterText: {
    color: '#65728B',
    fontSize: 12,
    fontWeight: '700'
  },
  filterTextActive: {
    color: "#FFFFFF"
  },
  filteredCount: {
    marginLeft: 'auto',
    color: '#7B8AA3',
    fontSize: 12,
    fontWeight: '800'
  },
  benefitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  emptyText: {
    color: '#7B8799',
    textAlign: 'center',
    padding: 25
  },
  disclaimer: {
    fontSize: 12,
    color: '#8B95A5',
    lineHeight: 17,
    marginTop: 10
  },
  cardListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 18,
    marginBottom: 11,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: '#E4EAF4'
  },
  miniCard: {
    width: 75,
    height: 49,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center'
  },
  cardListCopy: {
    flex: 1,
    paddingHorizontal: 12
  },
  cardListName: {
    fontWeight: '800',
    color: '#1F304B',
    fontSize: 13
  },
  cardListSub: {
    color: '#8B96A7',
    fontSize: 12,
    marginTop: 6
  },
  cardHintBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: "#EDF3FF",
    padding: 14,
    borderRadius: 13,
    marginTop: 8
  },
  cardHintText: {
    flex: 1,
    color: '#496995',
    fontSize: 12,
    lineHeight: 19
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: "#245DE5",
    borderRadius: 14,
    padding: 15,
    alignItems: 'center',
    marginTop: 17,
    minHeight: 44
  },
  outlineButtonText: {
    fontSize: 14,
    color: "#245DE5",
    fontWeight: '800'
  },
  bottomNav: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E3EAF4",
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: 12,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center"
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minHeight: 48
  },
  navLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: "#5A6E89",
    lineHeight: 18
  },
  navLabelActive: {
    color: "#245DE5"
  },
  devClearance: {
    height: 50,
    backgroundColor: "#FFFFFF"
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20,31,55,0.52)',
    justifyContent: 'center',
    paddingHorizontal: 20
  },
  modalPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    maxHeight: '83%',
    overflow: 'hidden',
    width: "100%",
    maxWidth: 620,
    alignSelf: "center"
  },
  modalBody: {
    padding: 24
  },
  modalEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2962D8'
  },
  modalTitle: {
    color: "#142D4E",
    fontWeight: "800",
    fontSize: 23,
    marginTop: 8
  },
  modalHighlight: {
    backgroundColor: "#EDF3FF",
    borderRadius: 13,
    padding: 17,
    marginVertical: 18
  },
  modalHighlightLabel: {
    color: '#6982AB',
    fontSize: 12
  },
  modalHighlightValue: {
    color: "#245DE5",
    fontSize: 21,
    fontWeight: "800",
    marginTop: 8
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 15,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7'
  },
  detailKey: {
    color: '#8792A2',
    fontSize: 12,
    width: 96
  },
  detailVal: {
    flex: 1,
    color: '#26344B',
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'right'
  },
  noticeTitle: {
    fontSize: 14,
    color: "#142D4E",
    fontWeight: "800",
    marginTop: 18
  },
  noticeText: {
    fontSize: 12,
    color: '#53627A',
    lineHeight: 19,
    marginTop: 8
  },
  modalFineprint: {
    marginTop: 15,
    fontSize: 12,
    lineHeight: 17,
    color: '#9AA4B4'
  },
  modalDone: {
    backgroundColor: "#245DE5",
    marginHorizontal: 20,
    marginBottom: 18,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center'
  },
  modalDoneText: {
    color: "#FFFFFF",
    fontWeight: '800',
    fontSize: 15
  },
  chatRoot: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  chatHeader: {
    backgroundColor: "#FFFFFF",
    padding: 17,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  chatTitle: {
    color: "#142D4E",
    fontSize: 18,
    fontWeight: '800'
  },
  chatInfo: {
    color: '#406BB1',
    backgroundColor: "#EDF3FF",
    fontSize: 12,
    padding: 12
  },
  messages: {
    padding: 16
  },
  chatBubble: {
    maxWidth: '88%',
    alignSelf: 'flex-start',
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 15,
    marginBottom: 12
  },
  chatUserBubble: {
    alignSelf: 'flex-end',
    backgroundColor: "#245DE5"
  },
  chatNote: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: '#5A6E89'
  },
  chatDraft: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    gap: 8
  },
  chatDraftButtons: {
    flexDirection: 'row',
    gap: 6
  },
  chatDraftSave: {
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1756DF'
  },
  chatDraftSaveText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800'
  },
  chatBubbleText: {
    color: '#374459',
    fontSize: 13,
    lineHeight: 20
  },
  chatUserText: {
    color: "#FFFFFF"
  },
  quickArea: {
    flexGrow: 0,
    marginVertical: 10
  },
  quickButton: {
    padding: 10,
    backgroundColor: '#E4EEFF',
    borderRadius: 14,
    marginRight: 8
  },
  quickButtonText: {
    color: '#235BCB',
    fontWeight: '700',
    fontSize: 12
  },
  chatInputRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: "#FFFFFF",
    padding: 13,
    alignItems: 'center'
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F3F6FA',
    padding: 12,
    borderRadius: 14,
    fontSize: 14,
    minHeight: 48
  },
  chatSend: {
    backgroundColor: "#245DE5",
    width: 42,
    height: 42,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center'
  },
  settingsHeader: {
    height: 66,
    backgroundColor: "#FFFFFF",
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 17,
    borderBottomWidth: 1,
    borderBottomColor: '#E9EDF4',
    width: "100%",
    maxWidth: 800,
    alignSelf: "center"
  },
  settingsHeaderButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center'
  },
  settingsHeaderTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: '#192844'
  },
  settingsScroll: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  settingsContent: {
    paddingBottom: 28,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 16,
    gap: 12
  },
  settingGroup: {
    marginTop: 0,
    backgroundColor: "#FFFFFF",
    paddingTop: 18,
    borderRadius: 20,
    overflow: "hidden"
  },
  settingGroupTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#7A879C',
    paddingHorizontal: 21,
    marginBottom: 7
  },
  settingPanel: {
    backgroundColor: "#FFFFFF",
    paddingBottom: 7
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 17,
    minHeight: 69,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E3EAF4"
  },
  settingIcon: {
    width: 33,
    height: 33,
    backgroundColor: '#F1F5FD',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10
  },
  settingTextArea: {
    flex: 1,
    paddingRight: 7
  },
  settingLabel: {
    fontSize: 14,
    color: '#243650',
    fontWeight: '700'
  },
  settingSubtitle: {
    fontSize: 12,
    color: "#5A6E89",
    lineHeight: 21,
    marginTop: 4
  },
  settingValue: {
    fontSize: 12,
    color: '#6F819D',
    marginRight: 7,
    maxWidth: 140
  },
  dangerText: {
    color: "#C53D56"
  },
  noticeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 11,
    backgroundColor: "#EDF3FF",
    borderRadius: 12,
    marginTop: 13
  },
  noticeStripText: {
    fontSize: 12,
    color: '#315FAD',
    fontWeight: '700',
    flex: 1
  },
  pinModalDim: {
    flex: 1,
    backgroundColor: 'rgba(18,30,54,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 22
  },
  pinModalCard: {
    borderRadius: 24,
    padding: 24,
    backgroundColor: "#FFFFFF",
    width: "100%",
    maxWidth: 480,
    alignSelf: "center"
  },
  pinStepText: {
    marginTop: 14,
    fontSize: 12,
    fontWeight: '800',
    color: '#245DE5'
  },
  pinDotsWrap: {
    marginTop: 14
  },
  pinErrorText: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 18,
    color: '#B24141'
  },
  pinModalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: "#142D4E"
  },
  pinModalDesc: {
    fontSize: 12,
    color: '#718097',
    marginTop: 9,
    lineHeight: 19
  },
  pinInputSection: {
    marginTop: 16
  },
  pinInputLabel: {
    fontSize: 12,
    color: '#43536E',
    fontWeight: '800',
    marginBottom: 7
  },
  pinInput: {
    borderColor: '#DDE5F0',
    borderWidth: 1,
    borderRadius: 11,
    height: 48,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#1E2D47',
    backgroundColor: '#F9FAFD'
  },
  pinModalButtons: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 22
  },
  pinCancel: {
    flex: 1,
    backgroundColor: '#F0F3F8',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14
  },
  pinCancelText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#50627C'
  },
  pinSave: {
    flex: 1,
    backgroundColor: "#245DE5",
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 14
  },
  pinSaveText: {
    fontSize: 14,
    fontWeight: '800',
    color: "#FFFFFF"
  }
});
