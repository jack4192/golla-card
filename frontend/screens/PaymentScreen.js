import { orderCards } from '../components/PaymentCardOrder';
import PaymentBenefitChat from '../components/PaymentBenefitChat';
import AiNotice from '../components/AiNotice';
import BenefitDetailBox from '../components/BenefitDetailBox';
import ActualBenefitCalc from '../components/ActualBenefitCalc';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import makeQR from 'qrcode-generator';
import JsBarcode from 'jsbarcode';
import { CARD_CATALOG } from '../data/cards';
import { findCatalog40Product } from '../data/cardCatalog40';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { evaluatePdfCard } from '../data/paymentBenefits';
import { benefitText, evaluateBenefit } from '../utils/cardRecommendation';
import { createRandomHex } from '../utils/demoCrypto';
import { makeSchedulePaymentScenario } from '../utils/schedulePayment';
import { estimateCatalogBenefit, matchesCatalogPaymentBenefit } from '../utils/catalogPayment';
import { SERVER_MODE } from '../utils/api';
import { loadPlacement } from '../utils/aiPlacement';
import { useAutoPlacement } from '../utils/autoPlacement';
import { loadAiEstimates } from '../utils/aiEstimate';
import { chooseEstimateScenario, exampleScenario } from '../utils/aiEstimateCore';
import { scheduleAiPaymentExample } from '../utils/scheduleAiCore';
const SCENARIOS = [{
  id: 'coffee',
  merchant: '스타벅스',
  namedMerchant: true,
  amount: 15000,
  category: /카페|커피/,
  brand: /스타벅스/i
}, {
  id: 'cu',
  merchant: 'CU',
  namedMerchant: true,
  amount: 10000,
  category: /편의점/,
  brand: /\bCU\b|씨유/i
}, {
  id: 'gs',
  merchant: 'GS25',
  namedMerchant: true,
  amount: 12000,
  category: /편의점/,
  brand: /GS25/i
}, {
  // 2026-11-23 결정: '일반 가맹점'은 AI 가 계산할 업종이 없어 음식점으로 바꿈
  id: 'restaurant',
  merchant: '음식점',
  categoryCode: 'RESTAURANT',
  amount: 30000,
  category: /음식점|외식|식당|요식/,
  brand: /음식점/
}];
export const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
export const reward = row => Number.isFinite(row?.value) ? Number(row.value).toLocaleString('ko-KR') + (row.unit === 'KRW' ? '원' : row.unit === 'POINT' ? 'P' : ' ' + row.unit) : '혜택 조건 확인 필요';
const catalogOf = card => CSV_CARD_CATALOG.find(item => item.code === (card.catalogCode || card.code || card.id) || card.id === 'solmate' && item.code === 'SH_SOLMATE_SOL_PLAN_CHECK' || item.name === card.name);

// 실제 상품 정보와 해당 상품 이미지가 확인된 카드만 사용합니다.
export function realProductCard(card) {
  if (!card || card.isOwned === false || card.isRecommendedOnly) {
    return null;
  }
  const catalog = catalogOf(card);
  const pdf = CARD_CATALOG[card.id];
  const product = findCatalog40Product(card);
  const image = product?.image ?? (catalog ? CARD_PRODUCTS[catalog.code]?.image : pdf?.image);
  if (!image || (!catalog && !pdf && !product)) {
    return null;
  }
  return {
    ...card,
    name: product?.name || catalog?.name || pdf?.name,
    issuer: product?.issuer || catalog?.issuer || '신한카드',
    type: product?.type || catalog?.type || '체크',
    catalogCode: catalog?.code || product?.code,
    image,
    realProduct: true
  };
}
export function realWalletCards(card, cards = []) {
  const active = cards.find(item => item.id === card?.id);
  const matched = [...(active ? [active] : []), ...cards].map(realProductCard).filter(Boolean);
  return Array.from(new Map(matched.map(item => [item.id, item])).values());
}
const unknown = (reason, name = null, condition) => ({
  value: null,
  unit: 'KRW',
  reason,
  name,
  condition,
});
const unsupportedEstimate = /해외|추가 적립|추가 할인|웰컴|리워드|정기결제|자동납부|구독|리터/;

function bestBenefit(rows) {
  const known = rows.filter(row => Number.isFinite(row.value));
  known.sort((a, b) => a.unit === b.unit ? b.value - a.value : a.unit === 'KRW' ? -1 : 1);
  return known[0] || rows[0];
}

function estimateCatalogPayment(card, scenario, assume, now) {
  const product = findCatalog40Product(card);
  if (!product) return null;
  const spend = Number.isFinite(card.status?.previousSpend) ? card.status.previousSpend : null;
  const matches = product.benefits.filter(benefit => matchesCatalogPaymentBenefit(benefit, scenario));
  const rows = matches.map(benefit => estimateCatalogBenefit(benefit, scenario, { spend, assume, now }));
  return bestBenefit(rows) || unknown('이 거래에 맞는 혜택을 상품 안내에서 찾지 못했어요.');
}

function estimateSchedulePayment(card, scenario, assume) {
  const catalog = catalogOf(card);
  const { schedule, matches, amount } = scenario;
  const now = new Date(schedule.date + 'T' + (schedule.time || '12:00') + ':00');
  const benefits = catalog?.benefits.filter(benefit => matches(benefit.name)) || [];
  if (!benefits.length) {
    if (schedule.pdfScenario && card.id === schedule.cardId) {
      if (!assume) return unknown('실적·한도·대상 거래 조건을 확인하기 전에는 금액을 계산하지 않습니다.');
      const spend = Number.isFinite(card.status?.previousSpend) ? card.status.previousSpend : null;
      const row = evaluatePdfCard(card, schedule.pdfScenario, amount, spend);
      return {
        value: row.status === 'eligible' ? row.value : null,
        unit: row.unit === '원' ? 'KRW' : row.unit,
        name: row.label,
        reason: row.detail,
        condition: row.rule,
      };
    }
    return estimateCatalogPayment(card, scenario, assume, now)
      || unknown('선택한 일정의 업종과 연결되는 카드 혜택을 확인하지 못했어요.');
  }

  const spend = Number.isFinite(card.status?.previousSpend) ? card.status.previousSpend : null;
  const rows = benefits.map(benefit => {
    const blocked = label => ({ benefit, value: null, unit: 'KRW', label });
    if (benefit.brandScope !== 'CATEGORY' && !(scenario.namedMerchant && scenario.brand?.test(benefit.name))) return blocked('혜택이 적용되는 대상 가맹점을 확인해주세요.');
    if (unsupportedEstimate.test(benefit.name)) return blocked('이 혜택은 거래 방식이나 추가 조건을 확인해주세요.');
    if (!schedule.time && (benefit.timeStart || benefit.timeEnd)) return blocked('결제 예정 시간을 확인해주세요.');
    return evaluateBenefit(catalog, benefit, { spend, amount, assume, now });
  });
  const row = bestBenefit(rows);
  const benefit = row.benefit;
  const threshold = benefit.minPrevSpend > 0 ? '전월 실적 ' + won(benefit.minPrevSpend) + ' 이상' : '';
  return {
    value: row.value,
    unit: row.unit,
    name: benefit.name + ' · ' + benefitText(benefit),
    reason: row.label.replace('현재 날짜·시간', '일정 날짜·시간'),
    condition: [threshold, benefit.note].filter(Boolean).join('\n'),
  };
}

export function estimatePayment(card, scenario, assume, now = new Date()) {
  if (scenario.schedule) return estimateSchedulePayment(card, scenario, assume);
  if (!assume) {
    return unknown('실적·한도·대상 거래 조건을 확인하기 전에는 금액을 계산하지 않습니다.');
  }
  const spend = Number.isFinite(card.status?.previousSpend) ? card.status.previousSpend : 400000;
  const catalog = catalogOf(card);
  if (!catalog) {
    const estimate = estimateCatalogPayment(card, scenario, assume, now);
    if (estimate) return estimate;
    const row = evaluatePdfCard(card, scenario.id, scenario.amount, spend);
    return {
      value: row.status === 'eligible' ? row.value : null,
      unit: row.unit === '원' ? 'KRW' : row.unit,
      name: row.label,
      reason: row.detail,
      condition: row.rule
    };
  }
  const benefits = catalog.benefits.filter(benefit => scenario.category.test(benefit.name) && (benefit.brandScope !== 'BRAND_ONLY' || scenario.brand.test(benefit.name)) && !unsupportedEstimate.test(benefit.name));
  if (!benefits.length) {
    return unknown('');
  }
  const evaluated = benefits.map(benefit => evaluateBenefit(catalog, benefit, {
    spend,
    amount: scenario.amount,
    remaining: {},
    assume: true,
    now
  }));
  const row = bestBenefit(evaluated);
  return {
    value: row.value,
    unit: row.unit,
    name: row.benefit.name,
    reason: row.label + ' · ' + benefitText(row.benefit),
    condition: row.benefit.note || ''
  };
}
export function comparePayment(selected, baseline) {
  return selected?.unit === 'KRW' && baseline?.unit === 'KRW' && Number.isFinite(selected.value) && Number.isFinite(baseline.value) ? selected.value - baseline.value : null;
}
export async function makeDemoCode() {
  let value = '';
  while (value.length < 18) {
    const salt = await createRandomHex();
    for (const char of salt) {
      const digit = parseInt(char, 16);
      if (digit < 10) value += digit;
      if (value.length === 18) break;
    }
  }
  return value;
}
// 혜택 한 줄: 핵심(업종 + 혜택)만 보여주고, 대상 가맹점·실적 조건·유의사항은 '상세 내역 보기'로 펼친다.
const shortName = name => String(name || '').split('(')[0].trim() || String(name || '');
const targetsOf = name => (String(name || '').match(/\(([^)]*)\)/) || [])[1] || '';
const manwon = value => value >= 10000 && value % 10000 === 0 ? (value / 10000).toLocaleString('ko-KR') + '만 원' : won(value);
function BenefitLine({ name, value, details = [] }) {
  const [open, setOpen] = useState(false);
  const rows = [targetsOf(name) && '대상: ' + targetsOf(name), ...details].filter(Boolean);
  return <View style={s.detail}>
    <View style={s.benefitHead}>
      <Text style={s.benefitName} numberOfLines={1}>{shortName(name)}</Text>
      {!!value && <Text style={s.benefitValue}>{value}</Text>}
    </View>
    {rows.length > 0 && <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={shortName(name) + (open ? ' 상세 내역 접기' : ' 상세 내역 보기')}
        onPress={() => setOpen(value => !value)} style={s.detailToggle}>
        <Text style={s.detailToggleText}>{open ? '상세 내역 접기 ▴' : '상세 내역 보기 ▾'}</Text>
      </TouchableOpacity>}
    {open && <View style={s.detailBody}>
        {rows.map((row, index) => <Text key={index} style={s.detailRow}>· {row}</Text>)}
      </View>}
  </View>;
}

// QR 결제 바텀시트(components/QuickPaySheet.js)에서도 같은 QR·바코드를 씁니다.
export function Codes({
  value,
  inactive
}) {
  const drawing = useMemo(() => {
    if (!/^\d{18}$/.test(value || '')) return null;
    const qr = makeQR(0, 'M');
    qr.addData(value, 'Numeric');
    qr.make();
    const size = qr.getModuleCount();
    let path = '';
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.isDark(y, x)) {
          path += 'M' + (x + 4) + ',' + (y + 4) + 'h1v1h-1z';
        }
      }
    }
    const target = {};
    JsBarcode(target, value, {
      format: 'CODE128C',
      displayValue: false
    });
    const data = target.encodings.map(item => item.data).join('');
    let bars = '';
    for (let x = 0; x < data.length; x++) {
      if (data[x] === '1') {
        bars += 'M' + (x + 12) + ',0h1v64h-1z';
      }
    }
    return {
      path,
      size: size + 8,
      bars,
      width: data.length + 24
    };
  }, [value]);
  if (!drawing) return null;
  return <View accessibilityLabel={inactive ? '만료된 결제 예시 코드' : '결제 예시 QR 및 바코드'} style={[s.codes, inactive && s.dim]}>
      <Svg width={184} height={184} viewBox={'0 0 ' + drawing.size + ' ' + drawing.size}>
        <Rect width="100%" height="100%" fill="white" />
        <Path d={drawing.path} fill="#101820" />
      </Svg>

      <Svg width="100%" height={64} viewBox={'0 0 ' + drawing.width + ' 64'} preserveAspectRatio="none">
        <Rect width="100%" height="100%" fill="white" />
        <Path d={drawing.bars} fill="#101820" />
      </Svg>

      <Text selectable style={s.codeNumber}>
        {value.replace(/(.{6})/g, '$1 ').trim()}
      </Text>
    </View>;
}
export async function protectScreen() {
  if (Platform.OS === 'web') return () => {};
  const Capture = require('expo-screen-capture');
  const Brightness = require('expo-brightness');
  const key = 'payment-' + Date.now();
  let blocked = false;
  let old = null;
  let bright = false;
  let system = false;
  try {
    await Capture.preventScreenCaptureAsync(key);
    blocked = true;
  } catch {}
  try {
    old = await Brightness.getBrightnessAsync();
    if (Platform.OS === 'android') {
      system = await Brightness.isUsingSystemBrightnessAsync();
    }
    await Brightness.setBrightnessAsync(1);
    bright = true;
  } catch {}
  return async () => {
    const tasks = [];
    if (blocked) {
      tasks.push(Capture.allowScreenCaptureAsync(key));
    }
    if (bright && Number.isFinite(old)) {
      tasks.push(system ? Brightness.restoreSystemBrightnessAsync() : Brightness.setBrightnessAsync(old));
    }
    await Promise.allSettled(tasks);
  };
}
// '이 거래의 예상 혜택' 계산 (결제 화면 + 홈 카드 뒷면이 같이 쓴다, 2026-11-24 결제 화면에서 떼어 냄).
//   options: 지갑 카드, selected: 혜택을 볼 카드, baseline: 비교 카드, placement: AI 배치 { status, result }
export function useBenefitEstimate({ options, selected, baseline, schedule = null, placement, scenarioId = 'coffee', assume = true }) {
  const scheduleScenario = useMemo(() => makeSchedulePaymentScenario(schedule), [schedule]);
  const fixedScenario = SCENARIOS.find(item => item.id === scenarioId) || SCENARIOS[0];
  // 서버 모드: 예상 혜택 거래를 AI 배치 문구 속 거래(rank.example)로 바꾼다 (2026-11-23).
  // 그 거래의 AI 계산이 온 뒤에 바꾸고, 계산이 실패하면 고정 예시를 그대로 둔다.
  // 일정 결제도 홈이 AI 카드로 보낸 일정이고 AI 가 그 일정을 보고 정했으면 그 거래 (2026-11-23 홈 일정 카드 설계서), 아니면 일정 거래.
  const aiExample = placement.status !== 'ready' ? null
    : scheduleScenario ? scheduleAiPaymentExample(placement.result, schedule)
    : placement.result?.example;
  const scheduleAi = Boolean(scheduleScenario && aiExample);
  const exampleScen = useMemo(() => exampleScenario(aiExample), [aiExample]);
  const [exampleRows, setExampleRows] = useState({ key: null, rows: null });
  useEffect(() => {
    if (!SERVER_MODE || !exampleScen) return undefined;
    let stopped = false;
    loadAiEstimates(exampleScen).then(rows => { if (!stopped) setExampleRows({ key: exampleScen.id, rows }); });
    return () => { stopped = true; };
  }, [exampleScen]);
  const readyExampleRows = exampleScen && exampleRows.key === exampleScen.id ? exampleRows.rows : null;
  const scenario = chooseEstimateScenario({ scheduleScenario, example: exampleScen, exampleRows: readyExampleRows, fixed: fixedScenario });
  const contextKey = scenario.id + ':' + assume;
  // 서버 모드: AI 엔진 계산(실적·한도·행사 반영). 데모 모드이거나 AI 가 답하지 못하면 앱 계산을 쓴다.
  const [aiEstimates, setAiEstimates] = useState({ key: null, rows: null });
  const scenarioKey = scenario.id + ':' + (scenario.schedule?.id || '') + ':' + scenario.amount;
  useEffect(() => {
    if (!SERVER_MODE || scenario.aiExample) return undefined;   // AI 예시 거래는 위에서 이미 계산했다
    let stopped = false;
    loadAiEstimates(scenario).then(rows => { if (!stopped) setAiEstimates({ key: scenarioKey, rows }); });
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioKey]);
  const aiRows = scenario.aiExample ? readyExampleRows : (aiEstimates.key === scenarioKey ? aiEstimates.rows : null);
  const estimates = useMemo(() => {
    const transactionDate = new Date();
    return options.map(card => ({ card, benefit: aiRows?.[card.id] || estimatePayment(card, scenario, assume, transactionDate) }));
  }, [options, scenario, assume, aiRows]);
  const selectedBenefit = estimates.find(row => row.card.id === selected?.id)?.benefit;
  const baseBenefit = estimates.find(row => row.card.id === baseline?.id)?.benefit;
  const difference = selected?.id === baseline?.id ? null : comparePayment(selectedBenefit, baseBenefit);
  return { scheduleScenario, scheduleAi, scenario, contextKey, aiRows, estimates, selectedBenefit, baseBenefit, difference };
}

export default function PaymentScreen({
  card,
  cards = [],
  schedule,
  onSelectCard,
  onClose,
  onOpenCards,
  navigation
}) {
  const options = useMemo(() => realWalletCards(card, cards), [card, cards]);
  const initialId = options.find(item => item.id === card?.id)?.id || options[0]?.id;
  const [selectedId, setSelectedId] = useState(initialId);
  const [baselineId, setBaselineId] = useState(options.find(item => item.id !== initialId)?.id || initialId);
  const [scenarioId, setScenarioId] = useState('coffee');
  const [assume, setAssume] = useState(true);
  const [payment, setPayment] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(!AppState.currentState || AppState.currentState === 'active');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [imageRetry, setImageRetry] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);   // '실제 혜택 계산하기' 창 (2026-11-24)
  const [cardDragActive, setCardDragActive] = useState(false);
  // AI 카드 배치 (서버 모드). status: off(데모 모드) / loading / ready / failed
  const [placement, setPlacement] = useState({ status: SERVER_MODE ? 'loading' : 'off', result: null });
  const userPicked = useRef(false);   // 사용자가 직접 카드를 고르면 AI 가 다시 바꾸지 않는다
  // 카드 자동 배치 ON/OFF (홈 '내 지갑' 스위치와 같은 값). OFF 면 목록·결제 카드를 AI 로 바꾸지 않는다
  const auto = useAutoPlacement();
  const autoOnRef = useRef(auto.on);
  autoOnRef.current = auto.on;
  const mounted = useRef(true);
  const sequence = useRef(0);
  const current = useRef(null);
  const notified = useRef(null);
  const selected = options.find(item => item.id === selectedId) || options[0];
  const baseline = options.find(item => item.id === baselineId) || options[0];
  // 예상 혜택 계산은 홈 카드 뒷면과 같이 쓴다 (useBenefitEstimate, 2026-11-24)
  const { scheduleScenario, scheduleAi, scenario, contextKey, aiRows, estimates, selectedBenefit, baseBenefit, difference }
    = useBenefitEstimate({ options, selected, baseline, schedule, placement, scenarioId, assume });
  const estimateGroups = [
    {
      label: '할인·캐시백',
      rows: estimates.filter(({ benefit }) => benefit.unit === 'KRW' && Number.isFinite(benefit.value))
        .sort((a, b) => b.benefit.value - a.benefit.value),
    },
    {
      label: '포인트 적립',
      rows: estimates.filter(({ benefit }) => benefit.unit === 'POINT' && Number.isFinite(benefit.value)),
    },
    {
      label: '조건 확인 필요',
      rows: estimates.filter(({ benefit }) => !Number.isFinite(benefit.value)),
    },
  ];
  const ai = placement.result;
  const aiTop = ai?.topId && !ai.fallback ? options.find(item => item.id === ai.topId) : null;
  const orderedOptions = ai && !ai.fallback ? orderCards(options, ai.order) : options;
  const source = selected?.image;
  const seconds = payment ? Math.max(0, Math.ceil((payment.expiresAt - now) / 1000)) : 0;
  const expired = !payment || seconds === 0 || payment.status !== 'pending' || payment.cardId !== selected?.id || payment.contextKey !== contextKey;
  useEffect(() => {
    if (options.some(item => item.id === card?.id)) {
      setSelectedId(card.id);
    }
  }, [card?.id, options]);
  useEffect(() => {
    if (selected && selected.id !== card?.id && notified.current !== selected.id) {
      notified.current = selected.id;
      try {
        onSelectCard?.(selected.id);
      } catch (problem) {
        setError(problem.message);
      }
    }
  }, [selected?.id, card?.id, onSelectCard]);
  useEffect(() => {
    setImageError(false);
    setImageRetry(0);
  }, [selected?.id]);
  useEffect(() => {
    if (!SERVER_MODE || !options.length) return undefined;
    let stopped = false;
    loadPlacement(options).then(result => {
      if (stopped) return;
      setPlacement({ status: result ? 'ready' : 'off', result });
      // 일정에서 들어온 결제는 홈이 AI 카드로 보낸 일정이고 AI 가 그 일정을 보고 정했을 때만 AI 1순위로 바꾸고, 아니면 일정에 맞춘 카드를 유지한다
      // AI 가 답하지 못해 기본 순서가 온 경우(fallback)에는 지갑에서 고른 카드를 그대로 둔다
      const follow = !scheduleScenario || scheduleAiPaymentExample(result, schedule);
      // 자동 배치를 껐으면 AI 1순위를 고르지 않고 내 결제 카드를 그대로 둔다 (2026-11-24 수정사항, AI 추천 상자는 그대로)
      if (autoOnRef.current && result?.topId && !result.fallback && follow && !userPicked.current) setSelectedId(result.topId);
    }).catch(() => {
      if (!stopped) setPlacement({ status: 'failed', result: null });
    });
    return () => {
      stopped = true;
    };
    // 화면을 열 때 한 번만 묻는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(() => setNow(Date.now()), 250);
    const subscription = AppState.addEventListener('change', state => {
      setNow(Date.now());
      setActive(state === 'active');
    });
    return () => {
      mounted.current = false;
      sequence.current += 1;
      clearInterval(timer);
      subscription.remove();
      if (current.current?.status === 'pending') {
        current.current.status = 'void';
      }
    };
  }, []);
  // '혜택 자세히 보기' 화면이라 QR·바코드를 보여주지 않는다. 화면 캡처 차단·밝기 조절과 코드 발급은
  // QR 결제 바텀시트(components/QuickPaySheet.js)에서만 한다.
  const issue = async () => {
    if (!selected) return;
    const ticket = ++sequence.current;
    if (current.current?.status === 'pending') {
      current.current.status = 'void';
    }
    current.current = null;
    setPayment(null);
    setGenerating(true);
    setError('');
    if (selected.isOwned === false || selected.isRecommendedOnly) {
      setGenerating(false);
      setError('등록된 카드를 선택해주세요.');
      return;
    }
    try {
      const value = await makeDemoCode();
      if (!mounted.current || ticket !== sequence.current) {
        return;
      }
      const next = {
        value,
        cardId: selected.id,
        contextKey,
        status: 'pending',
        expiresAt: Date.now() + 60000
      };
      current.current = next;
      setPayment(next);
      setNow(Date.now());
    } catch (problem) {
      if (mounted.current && ticket === sequence.current) {
        setError(problem.message || '코드를 만들지 못했습니다.');
      }
    } finally {
      if (mounted.current && ticket === sequence.current) {
        setGenerating(false);
      }
    }
  };
  useEffect(() => {
    setReceipt(null);
  }, [selected?.id, contextKey]);
  const choose = item => {
    userPicked.current = true;
    if (selected?.id === item.id) return;
    setSelectedId(item.id);
    try {
      onSelectCard?.(item.id);
    } catch (problem) {
      setError(problem.message);
    }
  };
  const close = () => {
    if (typeof onClose === 'function') {
      onClose();
    } else if (navigation?.navigate) {
      navigation.navigate('MainScreen');
    } else {
      setError('메인 화면 이동은 App.js 연결이 필요합니다.');
    }
  };
  const approve = () => {
    const token = current.current;
    if (!active || !token || token.status !== 'pending' || token.expiresAt <= Date.now() || token.cardId !== selected.id || token.contextKey !== contextKey) {
      setError('만료되었거나 변경된 코드입니다. 새로 발급해주세요.');
      return;
    }
    token.status = 'approved';
    setPayment({
      ...token
    });
    setReceipt({
      merchant: scenario.merchant,
      amount: scenario.amount,
      cardName: selected.name,
      benefit: selectedBenefit,
      difference,
      date: new Date().toLocaleString('ko-KR')
    });
  };
  if (!selected) {
    const hasCards = cards.length > 0;
    return <View style={s.empty}>
        {/* 점선 카드 + 도우미 캐릭터 */}
        <View style={s.emptyArt}>
          <View style={s.emptyCard}>
            <Text style={s.emptyPlus}>+</Text>
          </View>
          <Text style={s.emptySparkleA}>✦</Text>
          <Text style={s.emptySparkleB}>✦</Text>
          <View style={s.emptyBadge}>
            <Ionicons name="card" size={26} color="#FFFFFF" />
          </View>
          <View style={s.emptyBadgeSmall}>
            <Ionicons name="heart" size={14} color="#FFFFFF" />
          </View>
        </View>

        <Text style={s.emptyTitle}>
          {hasCards ? '결제할 수 있는 카드가 없어요' : '아직 카드가 없어요'}
        </Text>

        <Text style={s.emptyHint}>
          {hasCards ? '다른 카드를 등록하면 QR로 바로 결제할 수 있어요' : '카드를 등록하면 QR로 바로 결제할 수 있어요'}
        </Text>

        {/* 카드 탭(내 카드)으로 이동. 연결이 없으면 이전 화면으로 */}
        <TouchableOpacity accessibilityRole="button" onPress={() => (typeof onOpenCards === 'function' ? onOpenCards() : close())} style={s.emptyButton}>
          <Text style={s.emptyButtonText}>+ 카드 등록하러 가기</Text>
        </TouchableOpacity>
      </View>;
  }
  return <>
    <ScrollView style={[s.screen, Platform.OS === 'web' && cardDragActive && s.scrollLocked]}
      scrollEnabled={!cardDragActive} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" onPress={close}>
            <Text style={s.link}>← 돌아가기</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.title}>
          {receipt ? '예시 승인 결과' : '혜택 자세히 보기'}
        </Text>

        {scheduleScenario && <View style={s.scheduleContext}>
          <Text style={s.eyebrow}>오늘 일정</Text>
          <Text style={s.scheduleTitle}>{[schedule.time, schedule.title].filter(Boolean).join(' ')}</Text>
        </View>}

        {/* 카드 이미지 */}
        <View style={s.hero}>
          <Text style={s.eyebrow}>
            실제 상품 카드 · 카드사 원본 이미지
          </Text>

          {source && !imageError ? <Image key={selected.id + ':' + imageRetry} source={typeof source === 'string' ? {
          uri: source
        } : source} style={s.cardImage} resizeMode="contain" accessibilityLabel={selected.name + ' 실제 카드 이미지'} onError={() => setImageError(true)} /> : <View style={s.imagePlaceholder}>
              <Text style={s.text}>
                카드사 이미지를 불러오지 못했어요.
              </Text>

              <TouchableOpacity onPress={() => {
            setImageRetry(value => value + 1);
            setImageError(false);
          }}>
                <Text style={s.link}>
                  이미지 다시 보기
                </Text>
              </TouchableOpacity>
            </View>}

          <Text style={s.cardName}>
            {selected.name}
          </Text>

          <Text style={s.hint}>
            {selected.issuer}
            {' · '}{selected.type}
            {' · '}실제 상품 이미지
          </Text>

          {/* 'AI 추천' 상자는 뺐다 (2026-11-24, 홈 카드 뒷면에서 보여 준다) */}

        </View>

        {receipt && <View style={s.box}>
            <Text style={s.heading}>예시 승인 결과</Text>

            <Text style={s.text}>
              {receipt.merchant}
              {' · '}{won(receipt.amount)}
            </Text>

            <Text style={s.text}>
              {receipt.cardName}
            </Text>

            <Text style={s.hint}>
              {receipt.date}
            </Text>

            <Text style={s.comparison}>
              {receipt.difference > 0 ? '비교 카드보다 예상 혜택이 ' + won(receipt.difference) + ' 더 커요.' : '예상 혜택 ' + reward(receipt.benefit)}
            </Text>

            <Text style={s.hint}>
              실제 승인·출금·금융사 실적 반영은
              발생하지 않습니다.
            </Text>

            <TouchableOpacity style={s.primary} onPress={close}>
              <Text style={s.white}>{scheduleScenario ? '일정으로 돌아가기' : '메인으로'}</Text>
            </TouchableOpacity>
          </View>}

        {!!error && <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>}

        {/* 예상 혜택 + 카드 선정 이유를 한 상자로 (2026-11-24). 가맹점·금액·비교는 상자 본문에 있으니 상세 내역에는 겹치지 않는 것만 */}
        <BenefitDetailBox scenario={scenario} selected={selected} baseline={baseline} selectedBenefit={selectedBenefit}
          baseBenefit={baseBenefit} difference={difference} aiRows={aiRows} scheduleScenario={scheduleScenario}
          why={scheduleScenario && !scheduleAi
            ? selected.id === schedule.cardId
              ? '오늘 일정의 업종과 관련된 혜택이 있는 보유 카드예요.'
              : '결제 카드를 바꿨어요. 바꾸기 전과 같은 일정·금액으로 혜택을 확인할 수 있어요.'
            : aiTop && selected.id === aiTop.id
              ? (ai.message ? ai.message + ' ' : '') + 'AI가 지금 결제에 가장 잘 맞는 카드로 골랐어요.'
              : '지갑에서 직접 고른 카드예요.'}
          details={[
            selectedBenefit && scenario && Number.isFinite(selectedBenefit.value) && selectedBenefit.unit === 'KRW' && selectedBenefit.value > 0
              && '계산: ' + won(scenario.amount) + ' 결제 → ' + won(selectedBenefit.value) + ' 혜택 → 실제로 내는 돈 약 ' + won(Math.max(0, scenario.amount - selectedBenefit.value)),
            selectedBenefit?.reason && '계산 기준: ' + String(selectedBenefit.reason).replace(/^AI 엔진 계산\s*·?\s*/, ''),
            selectedBenefit?.condition && selectedBenefit.condition !== selectedBenefit.reason && selectedBenefit.condition,
          ]} />
        {/* 예상 혜택 아래 '실제 혜택 계산하기': 업종·금액을 직접 넣어 지금 고른 카드 혜택 계산 (2026-11-24) */}
        <Text style={s.calcPrompt}>예상 혜택과 실제 혜택은 얼마나 다를까요?{'\n'}결제할 곳과 금액을 넣고 직접 확인해 보세요!</Text>
        {calcOpen
          ? <ActualBenefitCalc key={selected.id} card={selected} cards={options} onClose={() => setCalcOpen(false)} />
          : <TouchableOpacity accessibilityRole="button" onPress={() => setCalcOpen(true)} style={s.calcOpen}>
              <Ionicons name="calculator-outline" size={17} color="#1D55D9" />
              <Text style={s.calcOpenText}>실제 혜택 계산하기</Text>
            </TouchableOpacity>}

        {/* '내 카드 · N장' 순서 목록은 결제 상세에서 뺐다 (2026-11-24). 카드는 위 카드 선택에서 바꾼다 */}

        <View style={s.box}>
          <Text style={s.heading}>카드 상세 혜택</Text>

          {catalogOf(selected)?.benefits?.slice(0, 6).map((benefit, index) => <BenefitLine key={index}
              name={benefit.name} value={benefitText(benefit)}
              details={[
                '전월 실적 ' + (benefit.minPrevSpend == null ? '확인 필요' : Number(benefit.minPrevSpend) === 0 ? '조건 없음' : manwon(Number(benefit.minPrevSpend)) + ' 이상'),
                benefit.note,
              ]} />)}

          {!catalogOf(selected) && findCatalog40Product(selected)?.benefits.slice(0, 6).map(benefit => <BenefitLine key={benefit.benefitId}
              name={benefit.name} details={[benefit.note]} />)}
          {!catalogOf(selected) && !findCatalog40Product(selected) && <Text style={s.hint}>
              {selectedBenefit?.condition || selected.reason || '정확한 혜택 조건은 카드사 상품 안내에서 확인해주세요.'}
            </Text>}
        </View>

      </View>
      <AiNotice style={s.aiNotice} />
    </ScrollView>
    <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
      <TouchableOpacity activeOpacity={1} accessibilityLabel="카드 선택 닫기" style={s.sheetBackdrop} onPress={() => setPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={s.sheet}>
          <Text style={s.heading}>결제할 카드 선택</Text>
          <ScrollView style={s.sheetList}>
            {orderedOptions.map(item => {
              const active = item.id === selected.id;
              return <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityState={{ selected: active }}
                onPress={() => { choose(item); setPickerOpen(false); }} style={[s.sheetRow, active && s.sheetRowActive]}>
                <Image source={typeof item.image === 'string' ? { uri: item.image } : item.image} resizeMode="contain" style={s.sheetImage} />
                <View style={s.sheetInfo}>
                  <Text style={s.sheetName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.sheetIssuer}>{item.issuer} · {item.type}</Text>
                </View>
                {active && <Text style={s.link}>사용 중</Text>}
              </TouchableOpacity>;
            })}
          </ScrollView>
          <TouchableOpacity accessibilityRole="button" onPress={() => setPickerOpen(false)} style={s.sheetClose}>
            <Text style={s.link}>닫기</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
    <PaymentBenefitChat
      key={JSON.stringify([contextKey, selected.id, baseline.id])}
      transaction={scenario.merchant + ' · ' + won(scenario.amount) + ' 결제 예시'}
      selected={{ id: selected.id, name: selected.name, benefit: selectedBenefit, reward: reward(selectedBenefit) }}
      baseline={{ id: baseline.id, name: baseline.name, benefit: baseBenefit, reward: reward(baseBenefit) }}
      difference={difference}
      recommendationId={ai?.recommendationId ?? null}
      onSelectCard={id => { const item = options.find(option => option.id === id); if (item) choose(item); }}
    />
  </>;
}
const s = StyleSheet.create({
  calcOpen: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'stretch', minHeight: 48,
    borderRadius: 14, borderWidth: 1.5, borderColor: '#B9CCF2', backgroundColor: '#FFFFFF',
  },
  calcPrompt: { marginTop: 6, marginBottom: -4, fontSize: 13, lineHeight: 20, fontWeight: '700', color: '#4A5A75', textAlign: 'center' },
  calcOpenText: { fontSize: 15, fontWeight: '800', color: '#1D55D9' },
  aiNotice: { marginTop: 16 },
  scrollLocked: { overflowY: 'hidden' },
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  content: {
    padding: 20,
    paddingBottom: 90
  },
  container: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: 18
  },
  payCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    padding: 10,
    borderRadius: 16,
    backgroundColor: '#F1F6FF',
    borderWidth: 1,
    borderColor: '#C9D9FF'
  },
  payCardImage: {
    width: 64,
    height: 42
  },
  payCardInfo: {
    flex: 1,
    gap: 2
  },
  payCardEyebrow: {
    fontSize: 12,
    color: '#5A6E89',
    fontWeight: '600'
  },
  payCardName: {
    fontSize: 15,
    color: '#14213D',
    fontWeight: '800'
  },
  changeCard: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#245DE5'
  },
  changeCardText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800'
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(12, 22, 44, 0.45)'
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    maxHeight: '75%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
    gap: 12
  },
  sheetList: {
    flexGrow: 0
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 6
  },
  sheetRowActive: {
    backgroundColor: '#F1F6FF',
    borderColor: '#245DE5'
  },
  sheetImage: {
    width: 64,
    height: 42
  },
  sheetInfo: {
    flex: 1,
    gap: 2
  },
  sheetName: {
    color: '#14213D',
    fontSize: 15,
    fontWeight: '700'
  },
  sheetIssuer: {
    color: '#687B97',
    fontSize: 12
  },
  sheetClose: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F1F4F9'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#142D4E",
    textAlign: 'center',
    lineHeight: 39
  },
  scheduleContext: {
    alignItems: 'center',
    backgroundColor: '#EAF1FF',
    borderRadius: 14,
    padding: 12,
    gap: 3,
  },
  scheduleTitle: {
    color: '#142D4E',
    fontWeight: '800',
    fontSize: 15,
    textAlign: 'center',
  },
  benefitName: {
    color: '#345179',
    fontWeight: '700',
    lineHeight: 22,
    textAlign: 'center',
  },
  estimateGroup: { gap: 7 },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E3EAF4',
    backgroundColor: '#FFF',
  },
  estimateRowSelected: { borderColor: '#245DE5', backgroundColor: '#EDF3FF' },
  estimateContent: { flex: 1, gap: 3 },
  estimateValue: { alignItems: 'flex-end', flexShrink: 1, maxWidth: '36%', gap: 4 },
  estimateBadge: { color: '#17439C', fontSize: 13, fontWeight: '700' },
  hero: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  eyebrow: {
    color: '#5B7AB4',
    fontSize: 12,
    fontWeight: '700'
  },
  cardImage: {
    width: '100%',
    height: 220
  },
  aiBox: {
    alignSelf: 'stretch',
    backgroundColor: '#EEF4FF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9D9FF',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 6
  },
  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  aiBadge: {
    backgroundColor: '#245DE5',
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 9
  },
  aiBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800'
  },
  aiText: {
    color: '#213F69',
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600'
  },
  aiButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4
  },
  cardName: {
    color: '#213F69',
    fontSize: 20,
    lineHeight: 29,
    fontWeight: "800",
    textAlign: 'center'
  },
  imagePlaceholder: {
    minHeight: 145,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12
  },
  benefit: {
    fontSize: 25,
    fontWeight: "800",
    color: "#245DE5",
    textAlign: 'center'
  },
  comparison: {
    fontSize: 14,
    fontWeight: '800',
    color: '#285FB1',
    lineHeight: 23,
    textAlign: 'center'
  },
  box: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    gap: 13,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  heading: {
    fontSize: 18,
    fontWeight: '800',
    color: "#142D4E",
    lineHeight: 27
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#345179',
    lineHeight: 22
  },
  text: {
    color: '#435E80',
    fontSize: 14,
    lineHeight: 24
  },
  hint: {
    color: "#5A6E89",
    fontSize: 13,
    lineHeight: 22
  },
  codes: {
    backgroundColor: "#FFFFFF",
    alignItems: 'center',
    paddingVertical: 10,
    gap: 15
  },
  codeNumber: {
    color: '#20334F',
    fontSize: 15,
    letterSpacing: 1.5
  },
  timer: {
    color: "#245DE5",
    fontSize: 18,
    fontWeight: "800"
  },
  red: {
    color: '#C14756'
  },
  primary: {
    padding: 16,
    minHeight: 54,
    backgroundColor: "#245DE5",
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  secondary: {
    padding: 14,
    backgroundColor: "#EDF3FF",
    borderRadius: 14,
    alignItems: "center",
    minHeight: 46,
    justifyContent: "center"
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  dim: {
    opacity: 0.25
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  chip: {
    padding: 11,
    borderRadius: 10,
    backgroundColor: '#EEF2FA',
    minHeight: 44
  },
  chipOn: {
    backgroundColor: "#245DE5"
  },
  chipText: {
    color: '#506B91',
    fontSize: 12
  },
  whiteSmall: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: '700'
  },
  detail: {
    borderTopWidth: 1,
    borderColor: "#E3EAF4",
    paddingTop: 12,
    gap: 6
  },
  benefitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  benefitName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1D304D' },
  benefitValue: { fontSize: 15, fontWeight: '800', color: '#245DE5' },
  detailToggle: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#F1F5FD' },
  detailToggleText: { fontSize: 12, fontWeight: '700', color: '#245DE5' },
  detailBody: { gap: 4, backgroundColor: '#F7F9FD', borderRadius: 10, padding: 10 },
  detailRow: { fontSize: 12, lineHeight: 18, color: '#4A5D7A' },
  error: {
    color: "#C53D56",
    fontSize: 13,
    lineHeight: 22
  },
  empty: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#F4F7FF'
  },
  emptyArt: {
    width: 220,
    height: 150,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyCard: {
    width: 190,
    height: 118,
    borderRadius: 20,
    borderWidth: 2.5,
    borderStyle: 'dashed',
    borderColor: '#9DB8F5',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-6deg' }]
  },
  emptyPlus: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '300',
    color: '#9DB8F5'
  },
  emptyBadge: {
    position: 'absolute',
    right: 4,
    bottom: -4,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#245DE5',
    borderWidth: 4,
    borderColor: '#F4F7FF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyBadgeSmall: {
    position: 'absolute',
    left: 14,
    bottom: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FF8FA3',
    borderWidth: 3,
    borderColor: '#F4F7FF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptySparkleA: {
    position: 'absolute',
    left: 4,
    top: 6,
    fontSize: 20,
    color: '#F5BF47'
  },
  emptySparkleB: {
    position: 'absolute',
    right: 18,
    top: 0,
    fontSize: 13,
    color: '#92B8FF'
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#14213D',
    textAlign: 'center'
  },
  emptyHint: {
    fontSize: 14,
    lineHeight: 22,
    color: '#5A6E89',
    textAlign: 'center'
  },
  emptyButton: {
    marginTop: 10,
    backgroundColor: '#245DE5',
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 999,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center'
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800'
  }
});
