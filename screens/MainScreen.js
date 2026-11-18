import WalletProductCard from '../components/WalletProductCard';
import WalletWheelControls from '../components/WalletWheelControls';
import RecommendationLaunchPopup from '../components/RecommendationLaunchPopup';
import MyDataCardStatus, { useMyDataSnapshot, mergeImportedWallet } from '../components/MyDataCardStatus';
import AccountWithdrawal from '../components/AccountWithdrawal';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, FlatList, StyleSheet, SafeAreaView, TextInput, Switch, Modal, KeyboardAvoidingView, Platform, useWindowDimensions, Vibration } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../utils/demoAlert';
import * as SecureStore from '../utils/demoStore';
import { createPinSalt, hashPin } from '../utils/pinCrypto';
import PaymentScreen from './PaymentScreen';
import { CSV_CARD_CATALOG, getCatalogCardForWallet } from '../data/cardCatalogCsv'; // SOLPAY_CSV_CATALOG_V1
import { DEMO_WALLET_CARDS, getActiveWalletCard } from '../data/cards';
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
  id: 'schedule', label: '오늘의 일정', icon: 'calendar-outline', active: 'calendar'
}, {
  id: 'cards',
  label: '카드',
  icon: 'card-outline',
  active: 'card'
}];
const EVENT_ROWS = [['메가MGC커피', '500 마이신한포인트 적립', null, '2026-11-01', '2026-11-30', '2026-12-13', '신한 슈퍼SOL/SOL페이 바코드 결제', '키오스크에서 바코드 스캔 필요'], ['온라인 다이소몰', '1,000 마이신한포인트 적립', 30000, '2026-11-01', '2026-11-30', '2026-12-10', '신한 슈퍼SOL/SOL페이 결제', '3만 원 이상 결제'], ['온라인 다이소몰', '500 마이신한포인트 추가 적립', null, '2026-11-16', '2026-11-30', '2026-12-10', '신한 슈퍼SOL/SOL페이 결제', '다이소데이 11월 16일 오픈. 기존 행사와 별도이며 중복 적용 여부는 확인 필요'], ['W컨셉(앱/웹)', '10,000 마이신한포인트 적립', 200000, '2026-11-01', '2026-11-30', '2026-12-16', '신한 슈퍼SOL/SOL페이 결제', '20만 원 이상 결제'], ['해피오더', '2,000원 즉시 할인', 15000, '2026-11-11', '2026-12-25', '즉시 할인', '신한 슈퍼SOL/SOL페이 결제', 'X-MAS 사전예약 제품 대상. 매일 오전 10:30부터 선착순'], ['유튜브 프리미엄', '5,000원 캐시백', null, '2026-11-01', '2026-11-30', '2027년 1월 중', '이벤트 응모 후 신규 정기 결제', '2026.05.01~10.31 결제 이력이 없는 고객 대상']];
const MYSHOP_ROWS = [['살롱드마샬', '최대 20% 할인', null, null, '2026-11-20', '2026-11-30', ''], ['11번가', '3,000원 캐시백', 50000, null, '2026-11-01', '2026-11-30', ''], ['CU', '500원 캐시백', null, null, '2026-11-01', '2026-11-15', ''], ['마켓컬리', '20% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['에이치몰', '5% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['알리익스프레스', '10% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['신라아이파크면세점', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['동원몰', '7% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['할리스', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['신세계면세점', '11% 캐시백', null, 100000, '2026-11-01', '2026-11-30', ''], ['닥터자르트', '12% 캐시백', null, 50000, '2026-11-01', '2026-11-30', ''], ['현대백화점', '15% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['SSG닷컴', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['이마트몰', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['차앤박(CNP)', '12% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['오설록', '10% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['레드캡투어', '12% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['야놀자', '8% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['교보문고', '10% 캐시백', 30000, 20000, '2026-11-01', '2026-11-30', ''], ['위메프', '20% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['올리브영', '25% 캐시백', null, 20000, '2026-11-01', '2026-11-30', ''], ['파리바게뜨', '12% 캐시백', 20000, 20000, '2026-11-01', '2026-11-30', ''], ['유니클로', '16% 캐시백', null, 40000, '2026-11-01', '2026-11-30', ''], ['미식 브랜드(식별불가)', '16% 캐시백', 30000, 30000, '2026-11-01', '2026-11-30', '가맹점명 원본 확인 필요'], ['종합쇼핑몰(식별불가)', '8,000원 캐시백', 200000, null, '2026-11-01', '2026-11-30', '가맹점명 원본 확인 필요']];
const ALL_BENEFITS = [...EVENT_ROWS.map((row, index) => ({
  id: `event-${index + 1}`,
  type: '이벤트',
  merchant: row[0],
  benefit: row[1],
  minimum: row[2],
  cap: null,
  start: row[3],
  end: row[4],
  payout: row[5],
  method: row[6],
  note: row[7]
})), ...MYSHOP_ROWS.map((row, index) => ({
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
  schedulePanel,
  onLogout,
  onOpenChat,
  walletCards = DEMO_WALLET_CARDS,
  activeCardId = DEMO_WALLET_CARDS[0].id,
  onSelectCard = () => {}
}) {
  const [walletViewportWidth, setWalletViewportWidth] = useState(0);
  // MYDATA_UI_LINK_V1
  const {
    snapshot: importedMyData
  } = useMyDataSnapshot();
  const [importedSelection, setImportedSelection] = useState(null);
  const suppliedCards = walletCards;
  const suppliedActive = activeCardId;
  const suppliedSelect = onSelectCard;
  useEffect(() => {
    setImportedSelection(null);
  }, [suppliedActive, importedMyData?.userId]);
  walletCards = mergeImportedWallet(walletCards, importedMyData);
  activeCardId = walletCards.some(c => c.id === importedSelection) ? importedSelection : walletCards.some(c => c.id === suppliedActive) ? suppliedActive : walletCards[0]?.id;
  onSelectCard = id => {
    if (!walletCards.some(c => c.id === id)) return;
    setImportedSelection(id);
    if (suppliedCards.some(c => c.id === id)) suppliedSelect(id);
  };
  const {
    width
  } = useWindowDimensions();
  const cardWidth = Math.max(1, walletViewportWidth || width - 40);
  const [tab, setTab] = useState('home');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [selectedCatalog, setSelectedCatalog] = useState(null);
  const walletRef = useRef(null);
  const currentCard = getActiveWalletCard(walletCards, activeCardId);
  const activeCardIndex = Math.max(0, walletCards.findIndex(card => card.id === currentCard.id));
  const [filter, setFilter] = useState('전체');
  const [search, setSearch] = useState('');
  const [selectedBenefit, setSelectedBenefit] = useState(null);
  const [walletBenefitDetailsOpen, setWalletBenefitDetailsOpen] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pinChangeOpen, setPinChangeOpen] = useState(false);
  const [pinForm, setPinForm] = useState({
    old: '',
    next: '',
    confirm: ''
  });
  const [pinSaving, setPinSaving] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [appNotice, setAppNotice] = useState(true);
  const [vibrationOn, setVibrationOn] = useState(true);
  const [savedConsent, setSavedConsent] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [sessionOpenedAt] = useState(new Date());
  useEffect(() => {
    if (tab === 'home' && !settingsOpen) {
      walletRef.current?.scrollToIndex({
        index: activeCardIndex,
        animated: false
      });
    }
  }, [activeCardIndex, cardWidth, tab, settingsOpen]);
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
          if (consentValue?.myDataAgreed === true) {
            setSavedConsent(consentValue);
          }
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
  const closePinChange = () => {
    if (pinSaving) return;
    setPinForm({
      old: '',
      next: '',
      confirm: ''
    });
    setPinChangeOpen(false);
  };
  const saveChangedPin = async () => {
    const {
      old,
      next,
      confirm
    } = pinForm;
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
      setPinForm({
        old: '',
        next: '',
        confirm: ''
      });
      Alert.alert('변경 완료', '다음 로그인부터 새 6자리 간편비밀번호를 사용해요.');
    } catch (error) {
      Alert.alert('변경 실패', error?.message || '다시 시도해주세요.');
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
    setTab(nextTab);
  };
  const visibleBenefits = useMemo(() => ALL_BENEFITS.filter(item => {
    if (filter !== '전체' && item.type !== filter) {
      return false;
    }
    const keyword = search.trim().toLowerCase();
    return !keyword || `${item.merchant} ${item.benefit}`.toLowerCase().includes(keyword);
  }), [filter, search]);
  const homeBenefits = ALL_BENEFITS.filter(item => benefitStatus(item) === '기간 내' && !item.merchant.includes('식별불가')).slice(0, 3);
  const selectTab = nextTab => setTab(nextTab);
  const openChat = () => {
    if (typeof onOpenChat === 'function') {
      onOpenChat({
        cardId: currentCard.id,
        cardName: currentCard.name
      });
      return;
    }
    setChatMessages([{
      role: 'bot',
      text: '안녕하세요! SOL AI 도우미예요.\n' + `현재 카드는 ${currentCard.name}입니다.\n` + '※ 실제 AI API는 아직 연결되지 않았습니다.'
    }]);
    setChatInput('');
    setChatVisible(true);
  };
  const askBot = (question = chatInput) => {
    const q = String(question).trim();
    if (!q) return;
    let answer = '시연용 챗봇이에요. 실제 사용 내역이나 실시간 혜택은 확인할 수 없어요.';
    if (/추천/.test(q)) {
      answer = '맞춤 카드 추천 기능은 추후 챗봇에 연동할 예정이에요. 현재는 선택한 카드 정보와 혜택 안내만 제공해요.';
    } else if (/현재 카드|카드 정보|이유|왜/.test(q)) {
      answer = `${currentCard.name}: ${currentCard.reason}`;
    } else if (/혜택|할인|적립/.test(q)) {
      answer = '혜택 탭에서 이벤트·마이샵 31개를 확인할 수 있어요. 각 항목을 누르면 결제 조건과 기간이 나와요.';
    } else if (/실적|한도/.test(q)) {
      answer = '전월 실적·남은 혜택 한도는 실제 금융 데이터가 연결되지 않아 확인할 수 없어요.';
    } else if (/규칙/.test(q)) {
      answer = '자동 결제 규칙은 현재 시연용 스위치예요. 실제 카드 추천 순위는 변경하지 않아요.';
    }
    setChatMessages(items => [...items, {
      role: 'user',
      text: q
    }, {
      role: 'bot',
      text: answer
    }]);
    setChatInput('');
  };
  const benefitTile = (item, compact = false) => <TouchableOpacity key={item.id} style={[styles.benefitTile, compact && styles.compactBenefitTile]} activeOpacity={0.8} onPress={() => setSelectedBenefit(item)}>
      <View style={styles.tileTop}>
        <Text style={styles.tileMerchant} numberOfLines={2}>
          {item.merchant}
        </Text>
        <Text style={styles.smallCategory}>{item.type}</Text>
      </View>

      <Text style={styles.tileAmount} numberOfLines={2}>
        {item.benefit}
      </Text>

      <Text style={styles.tileCondition} numberOfLines={2}>
        {item.minimum != null ? `${money(item.minimum)} 이상 결제` : item.type === '마이샵' ? '혜택 ON 설정 필요' : '상세 조건 확인'}
      </Text>

      <View style={styles.tileFooter}>
        <Text style={styles.tileStatus}>
          {benefitStatus(item)}
        </Text>
        <Ionicons name="chevron-forward" size={15} color="#3168DF" />
      </View>
    </TouchableOpacity>;
  const wallet = () => <WalletWheelControls cards={walletCards} selectedId={currentCard.id} onSelect={onSelectCard} onLayout={event => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (Number.isFinite(measured) && measured > 0) setWalletViewportWidth(previous => previous === measured ? previous : measured);
  }}><>
      <FlatList ref={walletRef} data={walletCards} extraData={activeCardId} horizontal pagingEnabled showsHorizontalScrollIndicator={false} keyExtractor={item => item.id} initialScrollIndex={activeCardIndex} getItemLayout={(_, index) => ({
        length: cardWidth,
        offset: cardWidth * index,
        index
      })} onMomentumScrollEnd={event => {
        const index = Math.round(event.nativeEvent.contentOffset.x / cardWidth);
        const nextIndex = Math.max(0, Math.min(index, walletCards.length - 1));
        if (walletCards[nextIndex]) {
          onSelectCard(walletCards[nextIndex].id);
        }
      }} renderItem={({
        item
      }) => <View style={{
        width: cardWidth
      }}>
            <WalletProductCard card={item} onPress={() => {
          onSelectCard(item.id);
          setTab('payment');
        }} />
          </View>} />

      <View style={styles.dotsRow}>
        {walletCards.map((item, index) => <View key={item.id} style={[styles.dot, activeCardIndex === index && styles.dotActive]} />)}
      </View>

      
    </></WalletWheelControls>;

  // 내 지갑에서 선택된 카드에 맞는 혜택 표시
  const walletBenefitSummary = () => {
    const details = WALLET_CARD_BENEFITS[currentCard.id];
    return <View style={styles.walletBenefitBox}>
        <View style={styles.walletBenefitHeading}>
          <View style={styles.walletBenefitHeadingLeft}>
            <Ionicons name="sparkles-outline" size={18} color="#235DE6" />
            <Text style={styles.walletBenefitHeadingText}>
              이 카드의 주요 혜택
            </Text>
          </View>

          <Text style={styles.walletBenefitDemoTag}>
            상품 안내서 기준
          </Text>
        </View>

        <Text style={styles.walletBenefitCardName} numberOfLines={2}>
          {currentCard.name}
        </Text>

        {details ? <>
            <View style={styles.walletBenefitChips}>
              {details.highlights.map((entry, index) => <View key={`${currentCard.id}-${index}`} style={styles.walletBenefitChip}>
                  <Ionicons name={entry.icon} size={16} color="#225CD6" />

                  <View style={styles.walletBenefitChipTexts}>
                    <Text style={styles.walletBenefitChipLabel}>
                      {entry.label}
                    </Text>
                    <Text style={styles.walletBenefitChipValue}>
                      {entry.value}
                    </Text>
                  </View>
                </View>)}
            </View>

            <View style={styles.walletBenefitMetaRow}>
              <Ionicons name="checkmark-circle-outline" size={15} color="#72819C" />
              <Text style={styles.walletBenefitMetaText}>
                <Text style={styles.walletBenefitMetaLabel}>
                  전월 실적{'  '}
                </Text>
                {details.condition}
              </Text>
            </View>

            <View style={styles.walletBenefitMetaRow}>
              <Ionicons name="wallet-outline" size={15} color="#72819C" />
              <Text style={styles.walletBenefitMetaText}>
                <Text style={styles.walletBenefitMetaLabel}>
                  혜택 한도{'  '}
                </Text>
                {details.limit}
              </Text>
            </View>

            <TouchableOpacity style={styles.walletBenefitDetailButton} onPress={() => setWalletBenefitDetailsOpen(true)} accessibilityRole="button" accessibilityLabel={`${currentCard.name} 혜택 상세보기`}>
              <Text style={styles.walletBenefitDetailButtonText}>
                혜택 자세히 보기
              </Text>
              <Ionicons name="chevron-forward" size={17} color="#225CD6" />
            </TouchableOpacity>
          </> : <View style={styles.walletBenefitUnknown}>
            <Ionicons name="information-circle-outline" size={19} color="#8795A9" />
            <Text style={styles.walletBenefitUnknownText}>
              이 카드는 정확한 상품 안내서가 없어 할인율과
              실적 조건을 표시하지 않아요.
            </Text>
          </View>}

        <Text style={styles.walletBenefitFootnote}>
          ※ 가상 보유 카드의 상품정보 요약입니다.
          실제 혜택 적용 여부·실적·잔여 한도는 확인되지 않았어요.
        </Text>
      </View>;
  };
  const renderHome = () => <>
      <View style={styles.sectionHeader}>
        <View style={{flex:1}}><Text style={styles.kicker}>내 지갑 · {walletCards.length}장</Text><Text style={styles.lead}>지금 사용할 <Text style={{color:"#1756D8"}}>카드</Text></Text></View>
        <TouchableOpacity onPress={() => selectTab('cards')} style={styles.moreRow}>
          <Text style={styles.moreText}>전체 카드</Text>
          <Ionicons name="chevron-forward" size={15} color="#6A7590" />
        </TouchableOpacity>
      </View>

      <View style={{backgroundColor:"#EAF1FF",borderRadius:24,paddingVertical:12}}>{wallet()}</View>
<TouchableOpacity style={styles.payShortcut} onPress={() => selectTab('payment')}>
        <Ionicons name="qr-code-outline" size={23} color="#FFFFFF" />
        <Text style={styles.payShortcutText}>
          선택한 카드로 결제
        </Text>
        <Ionicons name="arrow-forward" size={20} color="#FFFFFF" />
      </TouchableOpacity>

<TouchableOpacity style={styles.scheduleLink} onPress={() => selectTab('schedule')}>
        <Ionicons name="calendar-outline" size={22} color="#1954C8"/>
        <Text style={{flex:1,fontWeight:'700',fontSize:16}}>오늘의 일정</Text>
        <Ionicons name="chevron-forward" size={19} color="#426185"/>
      </TouchableOpacity>
      {walletBenefitSummary()}
<MyDataCardStatus card={currentCard} />
{appNotice && <View style={styles.noticeStrip}>
          <Ionicons name="notifications-outline" size={16} color="#2C60C2" />
          <Text style={styles.noticeStripText}>
            이번 달 혜택{' '}
            {ALL_BENEFITS.filter(item => benefitStatus(item) === '기간 내').length}
            건을 확인해보세요.
          </Text>
        </View>}

      
      <TouchableOpacity onPress={() => selectTab('cards')} style={{
      backgroundColor: "#EDF3FF",
      padding: 14,
      borderRadius: 14,
      marginTop: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between'
    }}>
        <View>
          <Text style={{
          color: '#204CA2',
          fontWeight: '800'
        }}>
            신한·국민 카드 22종 혜택 보기
          </Text>
          <Text style={{
          color: '#607DAC',
          fontSize: 12,
          marginTop: 4
        }}>
            카드별 혜택 조건 306건
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={19} color="#204CA2" />
      </TouchableOpacity>

      {getCatalogCardForWallet(currentCard) && <TouchableOpacity onPress={() => setSelectedCatalog(getCatalogCardForWallet(currentCard))} style={{
      padding: 12,
      marginTop: 9,
      backgroundColor: "#FFFFFF",
      borderRadius: 12
    }}>
          <Text style={{
        color: '#235CEA',
        fontWeight: '700'
      }}>
            SOL메이트 카드의 CSV 혜택 자세히 보기
          </Text>
        </TouchableOpacity>}


      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          놓치기 쉬운 혜택
        </Text>
        <TouchableOpacity onPress={() => selectTab('benefits')} style={styles.moreRow}>
          <Text style={styles.moreText}>31개 모두 보기</Text>
          <Ionicons name="chevron-forward" size={15} color="#6A7590" />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewScroll}>
        {homeBenefits.map(item => benefitTile(item, true))}
      </ScrollView>

          </>;
  const renderBenefits = () => <>
      <Text style={styles.lead}>혜택 둘러보기</Text>
      <View style={styles.report}>
        <Text style={styles.kicker}>등록된 혜택</Text>
        <Text style={styles.total}>{ALL_BENEFITS.length}건</Text>
        {['이벤트', '마이샵'].map(group => {
          const count = ALL_BENEFITS.filter(item => item.type === group).length;
          return <View key={group} style={{gap: 5}}>
            <Text style={styles.reportLabel}>{group} · {count}건</Text>
            <View style={styles.track}><View style={{height: 7, backgroundColor: '#2464ED',
              width: (100 * count / Math.max(1, ALL_BENEFITS.length)) + '%'}} /></View>
          </View>;
        })}
      </View>
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
        ※ PDF 기반 시연용 혜택입니다. 현재 이용 가능 여부,
        마이샵 개인별 활성화 여부와 카드별 적용 가능 여부는
        확인되지 않았습니다.
      </Text>
    </>;
  const renderFinance = () => <>
      <Text style={styles.pageEyebrow}>MY FINANCE</Text>
      <Text style={styles.pageTitle}>내 금융 한눈에</Text>
      <Text style={styles.pageSubtitle}>
        자산·소비 정보를 보기 쉽게 모으는 공간이에요.
      </Text>

      <View style={styles.financeHero}>
        <Ionicons name="shield-checkmark-outline" size={30} color="#1D63D1" />
        <Text style={styles.financeTitle}>
          마이데이터 연동 준비 중
        </Text>
        <Text style={styles.financeDesc}>
          현재 실제 계좌 잔액, 결제 내역 및 사용 실적은
          연결되어 있지 않아요. 시연 단계에서는 개인정보와
          실계좌 정보를 표시하지 않습니다.
        </Text>
      </View>

      <View style={styles.financeBox}>
        <View style={styles.financeIconCircle}>
          <Ionicons name="wallet-outline" size={21} color="#2363D3" />
        </View>
        <View style={styles.financeCopy}>
          <Text style={styles.financeRowTitle}>계좌·자산</Text>
          <Text style={styles.financeRowDesc}>
            실시간 계좌 데이터 없음
          </Text>
        </View>
        <Text style={styles.notConnected}>미연동</Text>
      </View>

      <View style={styles.financeBox}>
        <View style={styles.financeIconCircle}>
          <Ionicons name="stats-chart-outline" size={21} color="#2363D3" />
        </View>
        <View style={styles.financeCopy}>
          <Text style={styles.financeRowTitle}>소비 분석</Text>
          <Text style={styles.financeRowDesc}>
            API 연동 후 월별 지출 제공 예정
          </Text>
        </View>
        <Text style={styles.notConnected}>미연동</Text>
      </View>

      <TouchableOpacity style={styles.financeCTA} onPress={() => selectTab('cards')}>
        <Text style={styles.financeCTAText}>
          내 카드 확인하기
        </Text>
        <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
      </TouchableOpacity>
    </>;
  const renderCards = () => <>

      <View style={styles.walletStage}>
        <Text style={styles.walletCount}>보유 카드 {walletCards.length}장</Text>
        <Text style={styles.walletHeading}>내 지갑</Text>
        <WalletProductCard card={currentCard} onPress={() => selectTab('payment')} />
      </View>
      <Text style={styles.sectionTitle}>내 카드 목록</Text>
      {walletCards.map(card => <TouchableOpacity key={card.id} style={styles.cardListItem} onPress={() => {
      onSelectCard(card.id);
      selectTab('home');
    }}>
          <View style={[styles.miniCard, {
        backgroundColor: card.color
      }]}>
            <Ionicons name="card" size={26} color={card.textColor} />
          </View>

          <View style={styles.cardListCopy}>
            <Text style={styles.cardListName}>
              {card.name}
            </Text>
            <Text style={styles.cardListSub}>
              {card.number} · {card.issuer}
            </Text>
          </View>

          <Ionicons name="chevron-forward" size={19} color="#78859C" />
        </TouchableOpacity>)}

      <View style={styles.cardHintBox}>
        <Ionicons name="information-circle-outline" size={20} color="#456CBA" />
        <Text style={styles.cardHintText}>
          카드를 누르면 홈 지갑에서 해당 카드가 선택돼요.
          홈 화면의 카드를 누르면 QR·바코드 결제로 이동해요.
          실제 금융기관에 카드를 등록하는 것은 아니에요.
        </Text>
      </View>
      <Text style={{
      fontSize: 18,
      fontWeight: "800",
      color: '#203251',
      marginBottom: 8
    }}>
        신한·국민 카드 상품 22종
      </Text>

      <Text style={{
      color: '#6C7C94',
      fontSize: 12,
      marginBottom: 12
    }}>
        상품 정보 조회용이며 실제 보유 카드와는 별개입니다.
      </Text>

      <TextInput placeholder="카드 이름이나 혜택 검색" value={catalogQuery} onChangeText={setCatalogQuery} style={{
      backgroundColor: "#FFFFFF",
      borderWidth: 1,
      borderColor: '#E2E8F2',
      padding: 12,
      borderRadius: 12,
      marginBottom: 12
    }} />

      {CSV_CARD_CATALOG.filter(c => (c.name + ' ' + c.description + ' ' + c.tags.join(' ')).toLowerCase().includes(catalogQuery.trim().toLowerCase())).map(c => <TouchableOpacity key={c.code} onPress={() => setSelectedCatalog(c)} style={{
      backgroundColor: "#FFFFFF",
      padding: 14,
      borderRadius: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: '#E6EBF4'
    }}>
          <Text style={{
        fontSize: 14,
        fontWeight: '800',
        color: '#1D304D'
      }}>
            {c.name}
          </Text>
          <Text style={{
        fontSize: 12,
        color: '#687A96',
        marginTop: 5
      }}>
            {c.issuer} · {c.type} · 혜택 {c.benefits.length}건
          </Text>
          <Text numberOfLines={2} style={{
        fontSize: 12,
        color: '#687A96',
        marginTop: 6
      }}>
            {c.description}
          </Text>
        </TouchableOpacity>)}

    </>;
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
            Alert.alert('간편비밀번호 미설정', '계좌·자산 연동 단계에서 먼저 PIN을 등록해주세요.');
            return;
          }
          setPinChangeOpen(true);
        }} />
        </SettingsGroup>

        <SettingsGroup title="알림">
          <SettingsToggle icon="notifications-outline" title="앱 내 혜택 알림" subtitle="홈에서 진행 중인 혜택 안내 배너 표시" value={appNotice} disabled={settingsBusy} onChange={value => persistUISettings(value, vibrationOn)} />
        </SettingsGroup>

        <SettingsGroup title="편의 기능">
          <SettingsItem icon="qr-code-outline" title="결제" subtitle="기존 QR·바코드 결제 시연 화면" onPress={() => goFromSettings('payment')} />
          <SettingsItem icon="pie-chart-outline" title="마이데이터" subtitle="금융 연결 상태와 소비 분석 안내" onPress={() => goFromSettings('finance')} />
          <SettingsItem icon="card-outline" title="카드 관리" subtitle="등록된 시연용 카드 목록" onPress={() => goFromSettings('cards')} />
          <SettingsToggle icon="phone-portrait-outline" title="버튼 진동" subtitle="앱 내 테스트 진동 사용" value={vibrationOn} disabled={settingsBusy} onChange={value => persistUISettings(appNotice, value)} />
          <SettingsItem icon="pulse-outline" title="진동 테스트" subtitle="버튼 진동 설정이 켜져 있을 때만 작동" onPress={() => {
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
          <SettingsItem icon="document-text-outline" title="마이데이터 활용 동의" subtitle="현재 기기에 저장된 데모 동의 기록" value={savedConsent ? '동의' : '기록 없음'} />
        </SettingsGroup>

        <SettingsGroup title="앱 정보">
          <SettingsItem icon="time-outline" title="이번 접속" value={sessionOpenedAt.toLocaleString('ko-KR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })} />
          <SettingsItem icon="information-circle-outline" title="실행 환경" value="Expo 개발·시연용" />
          <SettingsItem icon="refresh-outline" title="화면 설정 초기화" subtitle="혜택 알림·진동만 기본값으로 복원" onPress={resetViewSettings} />
          <SettingsItem icon="log-out-outline" title="로그아웃" subtitle="간편비밀번호는 유지돼요" danger onPress={onLogout} />
        </SettingsGroup>

        <AccountWithdrawal />

        <Text style={styles.settingsFooter}>
          실제 금융기관 연결·Face ID·공동인증서·
          푸시 알림은 제공하지 않는 시연용 앱입니다.
        </Text>
      </ScrollView>
    </>;
  return <SafeAreaView style={styles.root}><RecommendationLaunchPopup enabled={tab === 'home' && !settingsOpen && !pinChangeOpen && !chatVisible && !selectedBenefit && !walletBenefitDetailsOpen && !selectedCatalog} />
      {!settingsOpen && tab !== 'payment' && <View style={styles.topBar}>
          <View>
            <Text style={styles.brand}>SOL·Pay</Text>
            
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.iconCircle} onPress={() => setSettingsOpen(true)}>
              <Ionicons name="settings-outline" size={21} color="#244E9C" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircle} onPress={openChat}>
              <Ionicons name="chatbubble-ellipses-outline" size={21} color="#244E9C" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircle} onPress={onLogout}>
              <Ionicons name="log-out-outline" size={21} color="#244E9C" />
            </TouchableOpacity>
          </View>
        </View>}

      <View style={styles.mainArea}>
        {schedulePanel && React.cloneElement(schedulePanel, {showPage: tab === 'schedule' && !settingsOpen})}
        {settingsOpen ? renderSettings() : tab === 'payment' ? <PaymentScreen card={currentCard} cards={walletCards} onSelectCard={onSelectCard} onClose={() => selectTab('home')} /> : tab === 'schedule' ? null : <ScrollView key={tab} style={styles.mainScroll} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {tab === 'home' && renderHome()}
            {tab === 'benefits' && renderBenefits()}
            {tab === 'finance' && renderFinance()}
            {tab === 'cards' && renderCards()}
          </ScrollView>}
      </View>

      {!settingsOpen && <View style={styles.bottomNav}>
          {NAV.map(item => {
        const active = item.id === tab;
        return <TouchableOpacity key={item.id} accessibilityRole="tab" accessibilityState={{selected: active}} style={[styles.navItem, active && styles.activeTab]} onPress={() => selectTab(item.id)}>
                <Ionicons name={active ? item.active : item.icon} size={23} color={active ? '#245CEA' : '#98A2B4'} />
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>;
      })}
        </View>}

      {__DEV__ && <View style={styles.devClearance} />}

      <Modal visible={pinChangeOpen} transparent animationType="slide" onRequestClose={closePinChange}>
        <KeyboardAvoidingView style={styles.pinModalDim} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.pinModalCard}>
            <Text style={styles.pinModalTitle}>
              간편비밀번호 변경
            </Text>
            <Text style={styles.pinModalDesc}>
              현재 번호와 새 번호를 각각 6자리로 입력해주세요.
            </Text>

            {[['old', '현재 간편비밀번호'], ['next', '새 간편비밀번호'], ['confirm', '새 간편비밀번호 확인']].map(([key, label]) => <View key={key} style={styles.pinInputSection}>
                <Text style={styles.pinInputLabel}>
                  {label}
                </Text>
                <TextInput style={styles.pinInput} value={pinForm[key]} onChangeText={value => setPinForm(previous => ({
              ...previous,
              [key]: value.replace(/\D/g, '').slice(0, 6)
            }))} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="숫자 6자리" editable={!pinSaving} />
              </View>)}

            <View style={styles.pinModalButtons}>
              <TouchableOpacity style={styles.pinCancel} onPress={closePinChange} disabled={pinSaving}>
                <Text style={styles.pinCancelText}>
                  취소
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pinSave} onPress={saveChangedPin} disabled={pinSaving}>
                <Text style={styles.pinSaveText}>
                  {pinSaving ? '저장 중...' : '변경하기'}
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
                {currentCard.name}
              </Text>

              {WALLET_CARD_BENEFITS[currentCard.id] ? <>
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
                    실제 고객의 전월 실적 및 남은 혜택 한도는
                    연결되지 않은 시연 화면입니다.
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
                    ※ 자료 기반 시연용 정보이며 실제 제공
                    여부·개인별 대상·중복 적용은 확인되지 않았습니다.
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
            현재 카드: {currentCard.name}
            {' · '}AI API 미연결
          </Text>

          <KeyboardAvoidingView style={{
          flex: 1
        }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView style={{
            flex: 1
          }} contentContainerStyle={styles.messages}>
              {chatMessages.map((item, index) => <View key={index} style={[styles.chatBubble, item.role === 'user' && styles.chatUserBubble]}>
                  <Text style={[styles.chatBubbleText, item.role === 'user' && styles.chatUserText]}>
                    {item.text}
                  </Text>
                </View>)}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickArea} contentContainerStyle={{
            paddingHorizontal: 14
          }}>
              {['현재 카드 정보', '혜택 알려줘', '실적은?', '규칙 설정'].map(item => <TouchableOpacity key={item} style={styles.quickButton} onPress={() => askBot(item)}>
                  <Text style={styles.quickButtonText}>
                    {item}
                  </Text>
                </TouchableOpacity>)}
            </ScrollView>

            <View style={styles.chatInputRow}>
              <TextInput style={styles.chatInput} value={chatInput} onChangeText={setChatInput} placeholder="질문을 입력하세요" returnKeyType="send" onSubmitEditing={() => askBot()} />
              <TouchableOpacity style={styles.chatSend} onPress={() => askBot()}>
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
                  <MyDataCardStatus card={selectedCatalog} expanded />

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
                        {b.rate != null ? Math.round(b.rate * 10000) / 100 + '%' : b.fixedAmount != null ? b.fixedAmount.toLocaleString('ko-KR') + (b.type === 'POINT' ? 'P' : '원') : '부가 혜택'} · {b.type}
                      </Text>

                      <Text style={{
                  color: '#6B7990',
                  fontSize: 12,
                  marginTop: 5
                }}>
                        {b.minPrevSpend == null ? '실적 조건 미기재' : b.minPrevSpend === 0 ? '전월 실적 없음' : '전월 ' + b.minPrevSpend.toLocaleString('ko-KR') + '원 이상'}
                        {b.monthlyCap != null ? ' · 월 한도 ' + b.monthlyCap.toLocaleString('ko-KR') : ''}
                      </Text>

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
                    실제 실적·잔여 한도와 혜택 적용은
                    확인되지 않은 시연용 화면입니다.
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
  scheduleLink:{flexDirection:'row',alignItems:'center',gap:12,minHeight:54,borderBottomWidth:1,borderBottomColor:'#DFE7F0'},
  kicker: {fontSize: 14, color: '#506788', fontWeight: '600', marginBottom: 4},
  lead: {fontSize: 30, lineHeight: 39, fontWeight: '800', color: '#101F39'},
  walletStage: {backgroundColor: '#101F4B', borderRadius: 26, padding: 20, gap: 6},
  walletCount: {fontSize: 14, color: '#B9CDF1'},
  walletHeading: {fontSize: 30, color: 'white', fontWeight: '800', marginBottom: 14},
  report: {backgroundColor: '#EDF4FF', borderRadius: 22, padding: 20, gap: 10},
  total: {fontSize: 38, fontWeight: '800', color: '#164ED3'},
  reportLabel: {fontSize: 14, fontWeight: '600', color: '#283C58'},
  track: {height: 7, borderRadius: 5, backgroundColor: '#D4E1F6', overflow: 'hidden'},
  activeTab: {borderTopWidth: 3, borderTopColor: '#205DE5'},

  root: {
    flex: 1,
    backgroundColor: "#FAFBFE"
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
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 40,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    padding: 22,
    gap: 18
  },
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
  walletBenefitBox: {
    marginTop: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    padding: 20
  },
  walletBenefitHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  walletBenefitHeadingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1
  },
  walletBenefitHeadingText: {
    color: '#1E2D48',
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 24
  },
  walletBenefitDemoTag: {
    color: '#647FA9',
    backgroundColor: '#EEF4FF',
    overflow: 'hidden',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700'
  },
  walletBenefitCardName: {
    marginTop: 11,
    marginBottom: 12,
    color: '#76849A',
    fontSize: 12,
    lineHeight: 18
  },
  walletBenefitChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 13
  },
  walletBenefitChip: {
    minWidth: 118,
    flexGrow: 1,
    flexBasis: '27%',
    backgroundColor: '#F2F6FF',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7
  },
  walletBenefitChipTexts: {
    flex: 1,
    gap: 4
  },
  walletBenefitChipLabel: {
    color: '#7485A2',
    fontSize: 12,
    fontWeight: '600'
  },
  walletBenefitChipValue: {
    color: '#2057D0',
    fontSize: 13,
    fontWeight: "800"
  },
  walletBenefitMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingTop: 8
  },
  walletBenefitMetaText: {
    color: '#5E6B81',
    fontSize: 12,
    lineHeight: 19,
    flex: 1
  },
  walletBenefitMetaLabel: {
    fontWeight: '800',
    color: '#3F506C'
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
  walletBenefitUnknown: {
    flexDirection: 'row',
    gap: 9,
    padding: 13,
    borderRadius: 12,
    backgroundColor: '#F5F7FA',
    alignItems: 'flex-start'
  },
  walletBenefitUnknownText: {
    flex: 1,
    color: '#758196',
    fontSize: 12,
    lineHeight: 19
  },
  walletBenefitFootnote: {
    color: "#5A6E89",
    fontSize: 12,
    marginTop: 14,
    lineHeight: 21
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
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 12
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#CCD4E1'
  },
  dotActive: {
    width: 19,
    backgroundColor: "#245DE5"
  },
  previewScroll: {
    marginHorizontal: -1
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
  compactBenefitTile: {
    width: 205,
    marginRight: 10,
    marginBottom: 0
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
  payShortcut: {
    backgroundColor: '#215CEC',
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderRadius: 17,
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  payShortcutText: {
    flex: 1,
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 15
  },
  pageEyebrow: {
    color: '#376ED2',
    letterSpacing: 1.1,
    fontSize: 12,
    fontWeight: "800"
  },
  pageTitle: {
    color: "#142D4E",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 8
  },
  pageSubtitle: {
    fontSize: 13,
    color: '#7B8799',
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 18
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
  financeHero: {
    borderRadius: 18,
    backgroundColor: "#EDF3FF",
    padding: 22,
    marginTop: 2,
    marginBottom: 15
  },
  financeTitle: {
    fontSize: 19,
    color: '#1B3E7D',
    fontWeight: "800",
    marginTop: 15
  },
  financeDesc: {
    fontSize: 13,
    color: '#56749E',
    lineHeight: 20,
    marginTop: 9
  },
  financeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: '#E4EAF4',
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    marginBottom: 10
  },
  financeIconCircle: {
    width: 43,
    height: 43,
    borderRadius: 13,
    backgroundColor: '#EBF3FF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  financeCopy: {
    flex: 1,
    paddingHorizontal: 12
  },
  financeRowTitle: {
    color: '#25334B',
    fontSize: 14,
    fontWeight: '800'
  },
  financeRowDesc: {
    color: '#8590A3',
    fontSize: 12,
    marginTop: 5
  },
  notConnected: {
    color: '#99A3B4',
    fontSize: 12,
    fontWeight: '700'
  },
  financeCTA: {
    padding: 16,
    borderRadius: 15,
    backgroundColor: '#235DE6',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12
  },
  financeCTAText: {
    color: "#FFFFFF",
    fontWeight: '800',
    fontSize: 14
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
    height: 65,
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
  settingsFooter: {
    marginTop: 20,
    marginHorizontal: 22,
    textAlign: 'center',
    color: "#5A6E89",
    fontSize: 12,
    lineHeight: 21
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
