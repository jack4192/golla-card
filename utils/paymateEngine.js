// utils/paymateEngine.js
// 쏠쏠하조 PayMate 요구사항 명세서(멘토링 반영) 100% 구현 엔진
import { Platform } from 'react-native';
import * as DemoStore from './demoStore';

export const STORAGE_KEYS = {
  USERS: 'paymate_users_v2',
  JWT: 'paymate_jwt_token_v2',
  CONSENT: 'paymate_consent_v2',
  CONSENT_HISTORY: 'paymate_consent_history_v2',
  SCHEDULES: 'paymate_daily_schedules_v2',
  COOLDOWN: 'paymate_card_cooldown_v2',
  RULES: 'paymate_user_rules_v2',
  FILL_MODE: 'paymate_fill_mode_v2',
  THRESHOLD: 'paymate_switch_threshold_v2',
  OWNED_CARDS: 'paymate_owned_cards_v2',
  TRANSACTIONS: 'paymate_transactions_v2',
  ADOPTION_LOG: 'paymate_adoption_log_v2',
  ALARM_TIME: 'paymate_morning_alarm_v2',
};

// =========================================================
// 1. 6개 카드사 40종 구조화 카탈로그 (신한 14, KB 6, 하나 6, BC 5, NH 5, 롯데 4)
// 카드사 가점 없이 동일 기준으로 배치 계산
// =========================================================
const build40Catalog = () => {
  const shinhan14 = [
    { code: 'SH_01', issuer: '신한카드', name: '신한카드 Mr.Life', type: '신용', annualFee: 15000, minSpend: 300000, limit: 30000, benefits: { 카페: 0.10, 편의점: 0.10, 병원: 0.10, 주유: 0.05, 온라인쇼핑: 0.10 } },
    { code: 'SH_02', issuer: '신한카드 Deep Dream', type: '신용', annualFee: 8000, minSpend: 0, limit: 50000, benefits: { 카페: 0.035, 음식점: 0.035, 편의점: 0.035, 대중교통: 0.035, 마트: 0.035 } },
    { code: 'SH_03', issuer: '신한카드 B.Big(삑)', type: '신용', annualFee: 10000, minSpend: 300000, limit: 20000, benefits: { 대중교통: 0.20, 카페: 0.10, 편의점: 0.05 } },
    { code: 'SH_04', issuer: '신한카드 Deep Oil', type: '신용', annualFee: 10000, minSpend: 300000, limit: 30000, benefits: { 주유: 0.10, 카페: 0.05, 편의점: 0.05 } },
    { code: 'SH_05', issuer: '신한카드 처음(신용)', type: '신용', annualFee: 15000, minSpend: 300000, limit: 35000, benefits: { 음식점: 0.05, 카페: 0.05, 편의점: 0.05, 온라인쇼핑: 0.05, 배달: 0.10 } },
    { code: 'SH_06', issuer: '신한카드 Point Plan', type: '신용', annualFee: 20000, minSpend: 400000, limit: 50000, benefits: { 음식점: 0.07, 주유: 0.05, 골프: 0.05, 동물병원: 0.10 } },
    { code: 'SH_07', issuer: '신한카드 Discount Plan+', type: '신용', annualFee: 15000, minSpend: 400000, limit: 40000, benefits: { 카페: 0.10, 배달: 0.10, 마트: 0.10, 동물병원: 0.15, 골프: 0.10 } },
    { code: 'SH_08', issuer: '신한카드 에브리웨어', type: '신용', annualFee: 15000, minSpend: 400000, limit: 40000, benefits: { 주유: 0.12, 카페: 0.10, 음식점: 0.05 } },
    { code: 'SH_09', issuer: 'FOCUS 신한카드 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 카페: 0.10, 편의점: 0.05, 온라인쇼핑: 0.05 } },
    { code: 'SH_10', issuer: 'GS ALL 신한카드 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 15000, benefits: { 편의점: 0.10, 주유: 0.07, 마트: 0.05 } },
    { code: 'SH_11', issuer: 'SOL메이트 신한 SOL Plan 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 15000, benefits: { 카페: 0.10, 음식점: 0.05, 대중교통: 0.05 } },
    { code: 'SH_12', issuer: '스타벅스 신한카드 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 카페: 0.20, 편의점: 0.05 } },
    { code: 'SH_13', issuer: '요기패스 신한카드 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 12000, benefits: { 배달: 0.15, 카페: 0.05, 음식점: 0.05 } },
    { code: 'SH_14', issuer: '카카오페이 신한 춘식이 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 카페: 0.07, 온라인쇼핑: 0.07, 편의점: 0.05 } },
  ];

  const kb6 = [
    { code: 'KB_01', issuer: 'KB국민카드', name: 'KB국민 My WE:SH 카드', type: '신용', annualFee: 15000, minSpend: 400000, limit: 30000, benefits: { 음식점: 0.10, 편의점: 0.10, 배달: 0.10, 카페: 0.05 } },
    { code: 'KB_02', issuer: 'KB국민카드', name: 'KB국민 K-패스 체크카드', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 대중교통: 0.10, 편의점: 0.03, 카페: 0.03 } },
    { code: 'KB_03', issuer: 'KB국민카드', name: 'KB Youth Club 체크카드', type: '체크', annualFee: 0, minSpend: 200000, limit: 12000, benefits: { 배달: 0.10, 카페: 0.08, 편의점: 0.05 } },
    { code: 'KB_04', issuer: 'KB국민카드', name: 'KB ALL 카드', type: '신용', annualFee: 12000, minSpend: 0, limit: 30000, benefits: { 온라인쇼핑: 0.05, 카페: 0.02, 음식점: 0.02 } },
    { code: 'KB_05', issuer: 'KB국민카드', name: 'KB YOU Prime 카드', type: '신용', annualFee: 15000, minSpend: 300000, limit: 25000, benefits: { 마트: 0.10, 주유: 0.08, 배달: 0.10 } },
    { code: 'KB_06', issuer: 'KB국민카드', name: 'KB국민 굿데이카드', type: '신용', annualFee: 10000, minSpend: 300000, limit: 25000, benefits: { 음식점: 0.10, 커피: 0.10, 카페: 0.10, 대중교통: 0.10, 주유: 0.06 } },
  ];

  const hana6 = [
    { code: 'HN_01', issuer: '하나카드', name: '하나 트래블로그 체크카드', type: '체크', annualFee: 0, minSpend: 200000, limit: 15000, benefits: { 대중교통: 0.05, 카페: 0.05, 편의점: 0.05 } },
    { code: 'HN_02', issuer: '하나카드', name: '하나 원더카드 FREE', type: '신용', annualFee: 12000, minSpend: 0, limit: 30000, benefits: { 음식점: 0.04, 온라인쇼핑: 0.04, 배달: 0.05 } },
    { code: 'HN_03', issuer: '하나카드', name: '하나 MULTI Any 카드', type: '신용', annualFee: 12000, minSpend: 300000, limit: 25000, benefits: { 마트: 0.08, 온라인쇼핑: 0.06, 카페: 0.05 } },
    { code: 'HN_04', issuer: '하나카드', name: '하나 클럽 SK 카드', type: '신용', annualFee: 15000, minSpend: 400000, limit: 30000, benefits: { 주유: 0.10, 대중교통: 0.07, 마트: 0.05 } },
    { code: 'HN_05', issuer: '하나카드', name: '하나 1Q Daily+ 카드', type: '신용', annualFee: 10000, minSpend: 300000, limit: 20000, benefits: { 편의점: 0.07, 카페: 0.07, 병원: 0.05 } },
    { code: 'HN_06', issuer: '하나카드', name: '하나 주거래 체크카드', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 마트: 0.05, 음식점: 0.05 } },
  ];

  const bc5 = [
    { code: 'BC_01', issuer: 'BC카드', name: 'BC 바로 클리어 플러스', type: '신용', annualFee: 5000, minSpend: 150000, limit: 20000, benefits: { 음식점: 0.07, 배달: 0.07, 대중교통: 0.07, 편의점: 0.10 } },
    { code: 'BC_02', issuer: 'BC카드', name: 'BC 바로 시발(始發) 카드', type: '신용', annualFee: 5000, minSpend: 300000, limit: 25000, benefits: { 카페: 0.10, 배달: 0.10, 온라인쇼핑: 0.07 } },
    { code: 'BC_03', issuer: 'BC카드', name: 'BC 바로 마카오 카드', type: '신용', annualFee: 10000, minSpend: 300000, limit: 25000, benefits: { 마트: 0.10, 주유: 0.08 } },
    { code: 'BC_04', issuer: 'BC카드', name: 'BC 바로 K-패스 카드', type: '신용', annualFee: 7000, minSpend: 250000, limit: 18000, benefits: { 대중교통: 0.15, 카페: 0.05 } },
    { code: 'BC_05', issuer: 'BC카드', name: 'BC 케이뱅크 SIMPLE 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 편의점: 0.05, 카페: 0.05 } },
  ];

  const nh5 = [
    { code: 'NH_01', issuer: 'NH농협카드', name: 'NH농협 올바른 FLEX 카드', type: '신용', annualFee: 10000, minSpend: 300000, limit: 25000, benefits: { 카페: 0.20, 배달: 0.10, 대중교통: 0.07, 편의점: 0.05 } },
    { code: 'NH_02', issuer: 'NH농협카드', name: 'NH농협 zgm.the pay', type: '신용', annualFee: 12000, minSpend: 0, limit: 30000, benefits: { 온라인쇼핑: 0.017, 음식점: 0.017, 카페: 0.017 } },
    { code: 'NH_03', issuer: 'NH농협카드', name: 'NH농협 올바른 POINT 체크', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 마트: 0.05, 병원: 0.05, 주유: 0.04 } },
    { code: 'NH_04', issuer: 'NH농협카드', name: 'NH농협 별다줄 카드', type: '신용', annualFee: 12000, minSpend: 300000, limit: 20000, benefits: { 온라인쇼핑: 0.07, 배달: 0.07 } },
    { code: 'NH_05', issuer: 'NH농협카드', name: 'NH농협 K-패스 체크카드', type: '체크', annualFee: 0, minSpend: 200000, limit: 10000, benefits: { 대중교통: 0.10, 카페: 0.05 } },
  ];

  const lotte4 = [
    { code: 'LT_01', issuer: '롯데카드', name: 'LOCA LIKIT 1.2', type: '신용', annualFee: 10000, minSpend: 0, limit: 30000, benefits: { 온라인쇼핑: 0.015, 카페: 0.012, 음식점: 0.012 } },
    { code: 'LT_02', issuer: '롯데카드', name: 'LOCA 365 카드', type: '신용', annualFee: 20000, minSpend: 500000, limit: 35000, benefits: { 대중교통: 0.10, 배달: 0.10, 병원: 0.10 } },
    { code: 'LT_03', issuer: '롯데카드', name: 'LOCA LIKIT Eat', type: '신용', annualFee: 10000, minSpend: 400000, limit: 30000, benefits: { 음식점: 0.15, 배달: 0.15, 카페: 0.15 } },
    { code: 'LT_04', issuer: '롯데카드', name: '롯데 디지로카 Auto', type: '신용', annualFee: 15000, minSpend: 300000, limit: 30000, benefits: { 주유: 0.10, 마트: 0.05 } },
  ];

  return [...shinhan14, ...kb6, ...hana6, ...bc5, ...nh5, ...lotte4];
};

export const CATALOG_40_CARDS = build40Catalog();

// =========================================================
// 2. 페르소나별(직장인·대학생·자취생) 가상 마이데이터 보유 카드 & 6개월 결제내역
// =========================================================
export const PERSONA_DATA = {
  대학생: {
    label: '🎓 대학생 페르소나',
    desc: '커피·편의점·대중교통·배달 비중이 높은 캠퍼스 소비 패턴',
    ownedCards: [
      { code: 'SH_11', last4: '2003', currentSpend: 170000, usedBenefit: 4200, color: '#265AD4', isPrimary: true },
      { code: 'KB_02', last4: '5678', currentSpend: 145000, usedBenefit: 3500, color: '#FFCA4B', isPrimary: false },
      { code: 'BC_01', last4: '8821', currentSpend: 110000, usedBenefit: 2800, color: '#087B69', isPrimary: false },
    ],
    topCategories: [
      { category: '카페', ratio: 38, amount: 185000 },
      { category: '음식점', ratio: 27, amount: 132000 },
      { category: '대중교통', ratio: 20, amount: 98000 },
      { category: '편의점', ratio: 15, amount: 73000 },
    ],
    timeSlotSummary: [
      { slot: '오전 (08~11시)', ratio: 28, desc: '등교 대중교통 · 모닝커피' },
      { slot: '점심 (12~14시)', ratio: 42, desc: '학생식당 · 카페 (최다 결제 시간대)' },
      { slot: '저녁/야간 (18~23시)', ratio: 30, desc: '편의점 · 배달음식' },
    ],
    dayOfWeekSummary: '평일(월~금) 74% · 주말(토~일) 26%',
    peakTimeSlot: '12:00 ~ 14:00 (점심·카페 집중)',
  },
  직장인: {
    label: '💼 직장인 페르소나',
    desc: '출퇴근 주유·점심 외식·카페·병원/골프 비중이 높은 오피스 소비 패턴',
    ownedCards: [
      { code: 'SH_01', last4: '1042', currentSpend: 270000, usedBenefit: 8500, color: '#1459F5', isPrimary: true },
      { code: 'HN_04', last4: '4419', currentSpend: 320000, usedBenefit: 9200, color: '#008485', isPrimary: false },
      { code: 'NH_01', last4: '7731', currentSpend: 210000, usedBenefit: 5100, color: '#1A4D8F', isPrimary: false },
    ],
    topCategories: [
      { category: '음식점', ratio: 35, amount: 420000 },
      { category: '주유', ratio: 25, amount: 300000 },
      { category: '카페', ratio: 22, amount: 264000 },
      { category: '온라인쇼핑', ratio: 18, amount: 216000 },
    ],
    timeSlotSummary: [
      { slot: '출근 (07~09시)', ratio: 25, desc: '주유 · 테이크아웃 커피' },
      { slot: '점심 (11~13시)', ratio: 45, desc: '오피스 주변 음식점 (최다 결제 시간대)' },
      { slot: '퇴근 후 (18~22시)', ratio: 30, desc: '회식 · 마트 · 온라인쇼핑' },
    ],
    dayOfWeekSummary: '평일(월~금) 68% · 주말(토~일) 32%',
    peakTimeSlot: '11:30 ~ 13:30 (점심 외식·카페 집중)',
  },
  자취생: {
    label: '🏠 자취생 페르소나',
    desc: '편의점·배달·온라인 장보기 비중이 높은 1인 가구 소비 패턴',
    ownedCards: [
      { code: 'SH_05', last4: '3312', currentSpend: 260000, usedBenefit: 7400, color: '#103E93', isPrimary: true },
      { code: 'KB_01', last4: '9081', currentSpend: 350000, usedBenefit: 11000, color: '#6A4C93', isPrimary: false },
      { code: 'LT_01', last4: '5510', currentSpend: 180000, usedBenefit: 2100, color: '#D62828', isPrimary: false },
    ],
    topCategories: [
      { category: '배달', ratio: 34, amount: 280000 },
      { category: '편의점', ratio: 28, amount: 230000 },
      { category: '온라인쇼핑', ratio: 23, amount: 190000 },
      { category: '마트', ratio: 15, amount: 120000 },
    ],
    timeSlotSummary: [
      { slot: '오전/낮 (09~17시)', ratio: 22, desc: '대중교통 · 점심 식사' },
      { slot: '저녁 (18~21시)', ratio: 48, desc: '배달 · 편의점 장보기 (최다 결제 시간대)' },
      { slot: '심야 (21~01시)', ratio: 30, desc: '온라인쇼핑 · 야식 배달' },
    ],
    dayOfWeekSummary: '평일(월~금) 58% · 주말(토~일) 42%',
    peakTimeSlot: '18:30 ~ 21:00 (저녁 배달·편의점 집중)',
  },
};

// =========================================================
// 3. 가맹점 데이터베이스 (일정 연계 가맹점 추천 & 가맹점 입력 결제 추천용)
// =========================================================
export const MERCHANTS_DB = [
  { id: 'M01', name: '컴포즈커피 경상대점', category: '카페', solPayPromo: 500, promoText: 'SOL페이 현장결제 500원 즉시할인' },
  { id: 'M02', name: '스타벅스 진주칠암점', category: '카페', solPayPromo: 1000, promoText: 'SOL페이 프로모션 1,000원 캐시백' },
  { id: 'M03', name: 'GS25 가좌캠퍼스점', category: '편의점', solPayPromo: 300, promoText: 'SOL페이 QR결제 300원 추가할인' },
  { id: 'M04', name: '맘스터치 경상대점', category: '음식점', solPayPromo: 500, promoText: 'SOL페이 가맹점 500원 즉시할인' },
  { id: 'M05', name: 'GS칼텍스 희망주유소', category: '주유', solPayPromo: 2000, promoText: 'SOL페이 주유 2,000원 청구할인' },
  { id: 'M06', name: '24시 든든동물메디컬센터', category: '동물병원', solPayPromo: 3000, promoText: 'SOL페이 펫케어 3,000원 프로모션 할인' },
  { id: 'M07', name: '진주 컨트리클럽(골프존)', category: '골프', solPayPromo: 5000, promoText: 'SOL페이 골프 5,000원 특별할인' },
  { id: 'M08', name: '요기요/배달의민족', category: '배달', solPayPromo: 1000, promoText: 'SOL페이 온라인결제 1,000원 할인' },
];

// =========================================================
// 4. 카드 혜택 및 추천 점수 계산 엔진 (150원 교체 기준 & 실적 방식 반영)
// =========================================================
export function getCatalogCard(code) {
  return CATALOG_40_CARDS.find(c => c.code === code) || null;
}

export function enrichOwnedCard(ownedItem) {
  const meta = getCatalogCard(ownedItem.code);
  if (!meta) return null;
  const remainingSpend = Math.max(0, meta.minSpend - (ownedItem.currentSpend || 0));
  const remainingLimit = Math.max(0, meta.limit - (ownedItem.usedBenefit || 0));
  const progressRatio = meta.minSpend > 0
    ? Math.min(100, Math.round(((ownedItem.currentSpend || 0) / meta.minSpend) * 100))
    : 100;
  return {
    ...meta,
    ...ownedItem,
    id: ownedItem.code,
    number: `•••• ${ownedItem.last4 || '1234'}`,
    remainingSpend,
    remainingLimit,
    progressRatio,
    isOwned: true,
  };
}

/**
 * 단일 결제에 대한 카드별 점수 계산 (엔진 계산값)
 * @param {object} card enrichedOwnedCard
 * @param {string} category 결제 업종 (카페, 음식점, 주유, 동물병원 등)
 * @param {number} amount 예상 결제 금액
 * @param {object} merchant 가맹점 객체 (프로모션 포함 여부)
 * @param {string} fillMode 'FIRST_TIER' | 'PRIMARY_FIRST' | 'MAX_VALUE'
 * @param {Array} rules 사용자 개인 규칙 배열
 */
export function evaluateCardForPayment(card, category, amount = 10000, merchant = null, fillMode = 'FIRST_TIER', rules = []) {
  const rate = card.benefits?.[category] || 0;
  const rawDiscount = Math.floor(amount * rate);
  const immediateBenefit = Math.min(rawDiscount, card.remainingLimit);
  const promoBenefit = merchant?.solPayPromo || 0;

  // 실적 기여 가치 계산 (실적 채우기 방식에 따라 차등)
  let spendContributionValue = 0;
  if (card.remainingSpend > 0) {
    if (fillMode === 'FIRST_TIER') {
      // 첫 구간 우선: 실적 미달 카드에 실적 기여 가치 부여
      spendContributionValue = Math.min(300, Math.floor(amount * 0.025));
    } else if (fillMode === 'PRIMARY_FIRST' && card.isPrimary) {
      // 주력 카드 우선: 기본 주력 카드에 높은 실적 가치 부여
      spendContributionValue = Math.min(450, Math.floor(amount * 0.035));
    } else if (fillMode === 'MAX_VALUE') {
      // 가치 최대(실적 안 채움): 즉시 혜택만 극대화
      spendContributionValue = 0;
    }
  }

  // 개인 규칙 보정 점수 (강제·제외·성향·순서)
  let ruleBonus = 0;
  let excluded = false;
  const isWeekend = [0, 6].includes(new Date().getDay());

  for (const r of rules) {
    if (!r.confirmed) continue;
    if (r.type === 'EXCLUDE' && r.cardCode === card.code) {
      excluded = true;
    } else if (r.type === 'FORCE' && r.cardCode === card.code) {
      if (!r.condition || (r.condition === 'WEEKEND' && isWeekend) || r.condition === category) {
        ruleBonus += 50000;
      }
    } else if (r.type === 'ORDER' && r.cardCode === card.code) {
      if (!r.condition || (r.condition === 'WEEKEND' && isWeekend)) {
        ruleBonus += 2000;
      }
    }
  }

  const totalScore = excluded ? -999999 : immediateBenefit + promoBenefit + spendContributionValue + ruleBonus;
  const ratePercent = Math.round(rate * 1000) / 10;
  const spendText = card.remainingSpend > 0
    ? `실적 ${(card.remainingSpend / 10000).toFixed(1)}만 원 남음`
    : '이번 달 실적 달성 완료';

  const reasonText = ratePercent > 0
    ? `${category} ${ratePercent}% 할인(${(immediateBenefit + promoBenefit).toLocaleString()}원) · ${spendText}`
    : `${spendText} · 기본 실적 적립`;

  return {
    cardCode: card.code,
    cardName: card.name,
    issuer: card.issuer,
    immediateBenefit,
    promoBenefit,
    totalBenefit: immediateBenefit + promoBenefit,
    spendContributionValue,
    ruleBonus,
    totalScore,
    ratePercent,
    remainingSpend: card.remainingSpend,
    remainingLimit: card.remainingLimit,
    reasonText,
    excluded,
  };
}

/**
 * 1순위 카드 자동 선택 & 기본 카드 교체 기준 (150원 기준 + 0.8초 타임아웃 Fallback)
 */
export async function rankOwnedCardsWithTimeout({
  ownedCards,
  schedules = [],
  persona = '대학생',
  fillMode = 'FIRST_TIER',
  rules = [],
  switchThreshold = 150, // 2026-11-15 멘토링 반영: 300원 -> 150원
  simulateServerDelayMs = 120,
  merchant = null,
  overrideCategory = null,
  overrideAmount = null,
}) {
  const enriched = ownedCards.map(enrichOwnedCard).filter(Boolean);
  if (enriched.length === 0) return { ranked: [], recommendationId: 'REC_EMPTY', fallbackUsed: false };

  // 기본 카드 순서 (이번 달 실적을 채울 기본 카드 1순위)
  const defaultOrdered = [...enriched].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return b.remainingSpend - a.remainingSpend;
  });

  // 현재 시간대 일정 또는 평소 소비 패턴 TOP 1으로 결제 업종 예상 (GPS 미사용)
  const nowHour = new Date().getHours();
  const activeSchedule = schedules.find(s => {
    const startH = parseInt(String(s.startTime || '09:00').split(':')[0], 10);
    const endH = parseInt(String(s.endTime || '23:00').split(':')[0], 10);
    return nowHour >= startH && nowHour <= endH;
  }) || schedules[0];

  const predictedCategory = overrideCategory
    || activeSchedule?.category
    || PERSONA_DATA[persona]?.topCategories?.[0]?.category
    || '카페';
  const predictedAmount = overrideAmount
    || Number(activeSchedule?.expectedAmount || 12000);

  // 0.8초(800ms) 타임아웃 레이스
  const computePromise = new Promise(resolve => {
    setTimeout(() => {
      const evaluations = defaultOrdered.map(c => ({
        card: c,
        evalResult: evaluateCardForPayment(c, predictedCategory, predictedAmount, merchant, fillMode, rules),
      })).filter(item => !item.evalResult.excluded);

      const basePrimary = evaluations[0];
      const sortedByScore = [...evaluations].sort((a, b) => b.evalResult.totalScore - a.evalResult.totalScore);
      const bestCandidate = sortedByScore[0];

      let finalOrder = sortedByScore;
      let switchApplied = false;

      // 기본 카드 교체 기준: 다른 카드 점수가 기본 카드보다 150원(switchThreshold) 이상 높을 때만 1순위 교체
      if (basePrimary && bestCandidate && bestCandidate.card.code !== basePrimary.card.code) {
        const diff = bestCandidate.evalResult.totalScore - basePrimary.evalResult.totalScore;
        if (diff >= switchThreshold) {
          switchApplied = true;
          finalOrder = sortedByScore;
        } else {
          // 150원 미만 차이면 기본 카드를 1순위로 유지
          finalOrder = [
            basePrimary,
            ...sortedByScore.filter(x => x.card.code !== basePrimary.card.code),
          ];
          basePrimary.evalResult.reasonText = `기본 실적 카드 유지 (타 카드와 혜택 차이 ${Math.max(0, diff)}원 < 기준 ${switchThreshold}원)`;
        }
      }

      resolve({
        ranked: finalOrder.map((item, idx) => ({
          ...item.card,
          rank: idx + 1,
          evalResult: item.evalResult,
          reason: item.evalResult.reasonText,
        })),
        predictedCategory,
        predictedAmount,
        switchApplied,
        switchThreshold,
        recommendationId: `REC_${Date.now()}`,
        fallbackUsed: false,
      });
    }, simulateServerDelayMs);
  });

  const timeoutPromise = new Promise(resolve => {
    setTimeout(() => {
      resolve({
        ranked: defaultOrdered.map((c, idx) => ({
          ...c,
          rank: idx + 1,
          reason: 'AI 서버 응답 지연(0.8초 초과) · 기본 카드 순서로 자동 대체됨',
          evalResult: evaluateCardForPayment(c, predictedCategory, predictedAmount, merchant, fillMode, rules),
        })),
        predictedCategory,
        predictedAmount,
        switchApplied: false,
        switchThreshold,
        recommendationId: `REC_FALLBACK_${Date.now()}`,
        fallbackUsed: true,
      });
    }, 800);
  });

  return Promise.race([computePromise, timeoutPromise]);
}

/**
 * 일정 연계 신규 신한카드 추천 (연회비 차감 3,000원 이상 이득 시, 하루 1회, 동일 카드 30일 쿨다운)
 */
export function recommendScheduleShinhanCard({ ownedCards, schedules = [], cooldownMap = {} }) {
  const ownedCodes = new Set(ownedCards.map(c => c.code));
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  // 미보유 신한카드만 후보로 추출
  const candidates = CATALOG_40_CARDS.filter(c =>
    c.issuer === '신한카드' &&
    !ownedCodes.has(c.code) &&
    (!cooldownMap[c.code] || (now - cooldownMap[c.code]) > THIRTY_DAYS_MS)
  );

  let bestRec = null;

  for (const cand of candidates) {
    for (const sched of schedules) {
      const cat = sched.category;
      const amt = Number(sched.expectedAmount || 50000);
      const candBenefit = Math.min(cand.limit, Math.floor(amt * (cand.benefits?.[cat] || 0)));

      // 현재 보유 카드 중 해당 일정 최대 혜택
      const currentBest = ownedCards.reduce((maxB, oc) => {
        const meta = getCatalogCard(oc.code);
        const b = meta ? Math.min(meta.limit, Math.floor(amt * (meta.benefits?.[cat] || 0))) : 0;
        return Math.max(maxB, b);
      }, 0);

      const monthlyAnnualFee = Math.floor((cand.annualFee || 0) / 12);
      const netGain = candBenefit - currentBest - monthlyAnnualFee;

      // 그 결제 한 번에 또는 월평균 연회비를 빼고 3,000원 이상 더 받을 때만 추천
      if (netGain >= 3000 && (!bestRec || netGain > bestRec.netGain)) {
        bestRec = {
          card: cand,
          schedule: sched,
          candBenefit,
          currentBest,
          monthlyAnnualFee,
          netGain,
          reason: `'${cat}' 일정(${amt.toLocaleString()}원) 결제 시 보유 카드 대비 연회비 차감 후 +${netGain.toLocaleString()}원 추가 혜택`,
        };
      }
    }
  }

  return bestRec;
}

/**
 * 일정 연계 맞춤형 가맹점 추천 (보유 카드 할인 + SOL페이 프로모션 적용 가맹점 및 엔진 계산 혜택가)
 */
export function recommendScheduleMerchants({ ownedCards, schedules = [] }) {
  const enriched = ownedCards.map(enrichOwnedCard).filter(Boolean);
  const targetCategories = schedules.length > 0
    ? [...new Set(schedules.map(s => s.category))]
    : ['카페', '음식점', '편의점'];

  const results = [];
  for (const m of MERCHANTS_DB) {
    if (!targetCategories.includes(m.category)) continue;
    const sched = schedules.find(s => s.category === m.category);
    const amount = Number(sched?.expectedAmount || 10000);

    let bestCard = null;
    let bestEval = null;
    for (const c of enriched) {
      const ev = evaluateCardForPayment(c, m.category, amount, m);
      if (!bestEval || ev.totalBenefit > bestEval.totalBenefit) {
        bestCard = c;
        bestEval = ev;
      }
    }

    if (bestCard && bestEval) {
      results.push({
        merchant: m,
        expectedAmount: amount,
        bestCardName: bestCard.name,
        cardDiscount: bestEval.immediateBenefit,
        solPayPromo: bestEval.promoBenefit,
        totalExpectedBenefit: bestEval.totalBenefit,
      });
    }
  }
  return results;
}

/**
 * 연말정산 놓친 혜택 TOP 3 (지난 1년 결제 기준 미보유 신한카드 발급 시 더 받았을 순혜택 상위 3장)
 */
export function calculateYearEndMissedBenefits({ ownedCards, persona = '대학생' }) {
  const ownedCodes = new Set(ownedCards.map(c => c.code));
  const pData = PERSONA_DATA[persona] || PERSONA_DATA.대학생;

  const shinhanCandidates = CATALOG_40_CARDS.filter(
    c => c.issuer === '신한카드' && !ownedCodes.has(c.code)
  );

  const scored = shinhanCandidates.map(cand => {
    let monthlyBenefit = 0;
    for (const item of pData.topCategories) {
      const rate = cand.benefits?.[item.category] || 0;
      monthlyBenefit += Math.floor(item.amount * rate);
    }
    monthlyBenefit = Math.min(cand.limit, monthlyBenefit);
    const yearlyNetBenefit = Math.max(0, (monthlyBenefit * 12) - (cand.annualFee || 0));

    return {
      ...cand,
      monthlyBenefit,
      yearlyNetBenefit,
      pitch: `그때 이 카드를 발급받으셨다면 1년 동안 ${yearlyNetBenefit.toLocaleString()}원을 더 받으셨어요 (연회비 ${cand.annualFee.toLocaleString()}원 차감 기준)`,
    };
  });

  return scored.sort((a, b) => b.yearlyNetBenefit - a.yearlyNetBenefit).slice(0, 3);
}