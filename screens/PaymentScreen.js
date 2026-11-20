import PaymentCardOrder from '../components/PaymentCardOrder';
import PaymentBenefitChat from '../components/PaymentBenefitChat';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import makeQR from 'qrcode-generator';
import JsBarcode from 'jsbarcode';
import { CARD_CATALOG } from '../data/cards';
import { findCatalog40Product } from '../data/cardCatalog40';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { evaluatePdfCard } from '../data/paymentBenefits';
import { benefitText, evaluateBenefit } from '../utils/cardRecommendation';
import { createPinSalt } from '../utils/pinCrypto';
import { makeSchedulePaymentScenario } from '../utils/schedulePayment';
import { estimateCatalogBenefit, matchesCatalogPaymentBenefit } from '../utils/catalogPayment';
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
  id: 'general',
  merchant: '일반 가맹점',
  amount: 30000,
  category: /기본.*국내|국내.*기본|심플 할인.*국내|국내 가맹점|일상 생활비/,
  brand: /국내|기본/
}];
const won = value => Number(value || 0).toLocaleString('ko-KR') + '원';
const reward = row => Number.isFinite(row?.value) ? Number(row.value).toLocaleString('ko-KR') + (row.unit === 'KRW' ? '원' : row.unit === 'POINT' ? 'P' : ' ' + row.unit) : '혜택 조건 확인 필요';
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
// 마지막 글자 받침에 따라 '을'/'를' (영문·숫자로 끝나면 '를')
const objectParticle = word => {
  const code = String(word || '').trim().slice(-1).charCodeAt(0);
  return code >= 0xAC00 && code <= 0xD7A3 && (code - 0xAC00) % 28 ? '을' : '를';
};
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
    const salt = await createPinSalt();
    for (const char of salt) {
      const digit = parseInt(char, 16);
      if (digit < 10) value += digit;
      if (value.length === 18) break;
    }
  }
  return value;
}
function Codes({
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
async function protectScreen() {
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
export default function PaymentScreen({
  card,
  cards = [],
  schedule,
  onSelectCard,
  onClose,
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
  const mounted = useRef(true);
  const sequence = useRef(0);
  const current = useRef(null);
  const notified = useRef(null);
  const selected = options.find(item => item.id === selectedId) || options[0];
  const baseline = options.find(item => item.id === baselineId) || options[0];
  const scheduleScenario = useMemo(() => makeSchedulePaymentScenario(schedule), [schedule]);
  const scenario = scheduleScenario || SCENARIOS.find(item => item.id === scenarioId) || SCENARIOS[0];
  const contextKey = scenario.id + ':' + assume;
  const estimates = useMemo(() => {
    const transactionDate = new Date();
    return options.map(card => ({ card, benefit: estimatePayment(card, scenario, assume, transactionDate) }));
  }, [options, scenario, assume]);
  const selectedBenefit = estimates.find(row => row.card.id === selected?.id)?.benefit;
  const baseBenefit = estimates.find(row => row.card.id === baseline?.id)?.benefit;
  const difference = selected?.id === baseline?.id ? null : comparePayment(selectedBenefit, baseBenefit);
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
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let cleanup;
    protectScreen().then(callback => {
      if (stopped) callback();else cleanup = callback;
    }).catch(() => {});
    return () => {
      stopped = true;
      if (cleanup) cleanup();
    };
  }, [active]);
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
    issue();
  }, [selected?.id, contextKey]);
  const choose = item => {
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
    return <View style={s.empty}>
        <Text style={s.title}>
          {cards.length ? '결제에 사용할 수 있는 카드가 없습니다' : '등록된 카드가 없습니다'}
        </Text>

        <Text style={s.hint}>
          카드 탭에서 보유 카드를 등록해주세요.
        </Text>

        <TouchableOpacity onPress={close}>
          <Text style={s.link}>
            카드 등록하러 돌아가기
          </Text>
        </TouchableOpacity>
      </View>;
  }
  return <>
    <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" onPress={close}>
            <Text style={s.link}>← 돌아가기</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.title}>
          {receipt ? '예시 승인 결과' : '결제'}
        </Text>

        {scheduleScenario && <View style={s.scheduleContext}>
          <Text style={s.eyebrow}>오늘 일정</Text>
          <Text style={s.scheduleTitle}>{[schedule.time, schedule.title].filter(Boolean).join(' ')}</Text>
        </View>}

        {/* 맨 위: QR 및 바코드 */}
        {!receipt && <View style={s.box}>
            <View style={s.header}>
              <Text style={s.heading}>
                QR · 바코드 결제
              </Text>

              <Text style={[s.timer, expired && s.red]}>
                {generating ? '발급 중' : expired ? '만료됨' : seconds + '초'}
              </Text>
            </View>

            {/* 이 QR로 결제할 카드 + 카드 변경 */}
            <TouchableOpacity accessibilityRole="button" disabled={options.length < 2}
              accessibilityLabel={'결제 카드 ' + selected.name + (options.length > 1 ? ', 눌러서 카드 변경' : '')}
              onPress={() => setPickerOpen(true)} style={s.payCard}>
              <Image source={typeof selected.image === 'string' ? { uri: selected.image } : selected.image} resizeMode="contain" style={s.payCardImage} />
              <View style={s.payCardInfo}>
                <Text style={s.payCardEyebrow}>결제 카드</Text>
                <Text style={s.payCardName} numberOfLines={1}>{selected.name}</Text>
              </View>
              {options.length > 1 && <View style={s.changeCard}>
                  <Text style={s.changeCardText}>카드 변경</Text>
                </View>}
            </TouchableOpacity>

            {generating ? <ActivityIndicator size="large" color="#245DE5" style={{
          padding: 35
        }} /> : payment && active ? <Codes value={payment.value} inactive={expired} /> : <Text style={s.hint}>
                {active ? '코드를 발급해주세요.' : '앱이 비활성 상태라 코드를 숨겼습니다.'}
              </Text>}

            <Text style={s.hint}>
              QR·바코드는 예시이며 실제 결제에 사용할 수 없어요.
            </Text>

            <TouchableOpacity accessibilityRole="button" disabled={generating || !active} onPress={issue} style={[s.secondary, generating && s.dim]}>
              <Text style={s.link}>
                새 결제 코드 발급
              </Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button" disabled={expired || generating || !active} onPress={approve} style={[s.primary, (expired || generating || !active) && s.dim]}>
              <Text style={s.white}>
                승인 결과 보기
              </Text>
            </TouchableOpacity>
          </View>}

        {/* QR 아래: 실제 상품 카드 이미지 */}
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

          <View style={s.benefitBox}>
            <Text style={s.label}>
              이 거래의 예상 혜택
            </Text>

            <Text style={s.hint}>
              {scenario.merchant}
              {' · '}{won(scenario.amount)}
              {' · '}결제 예시
            </Text>

            {!!selectedBenefit.name && <Text style={s.benefitName}>{selectedBenefit.name}</Text>}

            <Text style={s.benefit}>
              {reward(selectedBenefit)}
            </Text>

            {!Number.isFinite(selectedBenefit.value) && !!selectedBenefit.reason && <Text style={s.hint}>
              {selectedBenefit.reason}
            </Text>}

            <Text style={s.comparison}>
              {selected.id === baseline.id ? '아래에서 다른 비교 카드를 선택할 수 있어요.' : difference === null ? '두 카드의 원화 혜택이 확인되면 차이를 보여드려요.' : difference > 0 ? '가정대로라면 비교 카드보다 ' + won(difference) + ' 더 아낄 수 있어요!' : difference === 0 ? '이 조건에서는 두 카드의 원화 혜택이 같아요.' : '이 조건에서는 비교 카드가 ' + won(-difference) + ' 더 유리해요.'}
            </Text>

            <Text style={s.hint}>
              비교 카드: {baseline.name}
              {' · '}{reward(baseBenefit)}
            </Text>

            {baseline.id !== selected.id && !Number.isFinite(baseBenefit.value) && !!baseBenefit.reason && <Text style={s.hint}>
              {baseBenefit.reason}
            </Text>}

            <Text style={s.hint}>
              {scheduleScenario
                ? '일정 업종에 맞춘 결제 예시입니다. 실제 혜택은 가맹점·실적·잔여 한도에 따라 달라요.'
                : '기록된 전월 실적을 사용하고, 기록이 없으면 40만 원으로 계산해요.'}
            </Text>
          </View>
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

        <Text style={s.scrollHint}>
          아래에서 카드 선택 이유와 상세 혜택을 확인하세요 ↓
        </Text>

        <PaymentCardOrder cards={options} selectedId={selected.id} onSelect={choose} />

        <View style={s.box}>
          <Text style={s.heading}>카드 선정 이유</Text>

          <Text style={s.text}>
            {scheduleScenario
              ? selected.id === schedule.cardId
                ? '오늘 일정의 업종과 관련된 혜택이 있는 보유 카드예요.'
                : '결제 카드를 바꿨어요. 바꾸기 전과 같은 일정·금액으로 혜택을 확인할 수 있어요.'
              : '지갑에서 선택한 ' + selected.name + objectParticle(selected.name) + ' 결제 카드로 유지하고 있어요.'}
          </Text>

          {!!selectedBenefit?.name && <Text style={s.text}>{selectedBenefit.name}</Text>}

          {!!selectedBenefit?.reason && <Text style={s.hint}>
            {selectedBenefit.reason}
          </Text>}

          {!!selectedBenefit?.condition && <Text style={s.hint}>
              {selectedBenefit.condition}
            </Text>}
        </View>

        <View style={s.box}>
          <Text style={s.heading}>
            혜택 비교 조건
          </Text>

          <Text style={s.text}>
            {scenario.merchant}
            {' · '}{won(scenario.amount)}
          </Text>

          {!scheduleScenario && <View style={s.chips}>
            {SCENARIOS.map(item => <TouchableOpacity key={item.id} onPress={() => setScenarioId(item.id)} style={[s.chip, item.id === scenario.id && s.chipOn]}>
                <Text style={item.id === scenario.id ? s.whiteSmall : s.chipText}>
                  {item.merchant}
                </Text>
              </TouchableOpacity>)}
          </View>}

          <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{
          checked: assume
        }} onPress={() => setAssume(!assume)} style={s.secondary}>
            <Text style={s.link}>
              {assume ? '☑' : '☐'} 비교 조건 적용
            </Text>
          </TouchableOpacity>

          <Text style={s.hint}>
            {scheduleScenario
              ? '등록된 전월 실적을 사용합니다. 업종 외에 확인이 필요한 조건이 있으면 위에 표시돼요. 예상치는 월 한도 미사용을 가정하며, 포인트는 원화와 비교하지 않아요.'
              : '전월 실적 기록이 없으면 40만 원으로 계산해요. 월 한도를 사용하지 않았고 거래 조건을 충족했다고 가정해요. 포인트는 별도로 표시해요.'}
          </Text>

          {selected.status && <Text style={s.hint}>
              선택 카드 실적 자료:
              {' '}{selected.status.month}
              {' · '}전월{' '}
              {won(selected.status.previousSpend)}
            </Text>}

        </View>

        <View style={s.box}>
          <Text accessibilityRole="header" style={s.heading}>같은 거래로 내 카드 비교</Text>
          <Text style={s.text}>{scenario.merchant} · {won(scenario.amount)} · 결제 예시</Text>
          <Text style={s.hint}>카드를 누르면 위 예상 혜택의 비교 카드가 바뀌어요.</Text>
          {estimateGroups.filter(group => group.rows.length).map(group => <View key={group.label} style={s.estimateGroup}>
            <Text style={s.label}>{group.label}</Text>
            {group.rows.map(({ card, benefit }) => {
              const isBaseline = baseline.id === card.id;
              return <TouchableOpacity
                key={card.id}
                accessibilityRole="radio"
                accessibilityLabel={card.name + ' 비교 대상 · ' + reward(benefit)}
                accessibilityState={{ checked: isBaseline }}
                onPress={() => setBaselineId(card.id)}
                style={[s.estimateRow, isBaseline && s.estimateRowSelected]}
              >
                <View style={s.estimateContent}>
                  <Text style={s.label}>{card.name}</Text>
                  {!!benefit.name && <Text style={s.hint}>{benefit.name}</Text>}
                  {!Number.isFinite(benefit.value) && !!benefit.reason && <Text style={s.hint}>{benefit.reason}</Text>}
                  {selected.id === card.id && <Text style={s.estimateBadge}>결제 카드</Text>}
                </View>
                <View style={s.estimateValue}>
                  <Text style={s.estimateBadge}>{reward(benefit)}</Text>
                  {isBaseline && <Text style={s.hint}>비교 중</Text>}
                </View>
              </TouchableOpacity>;
            })}
          </View>)}
        </View>

        <View style={s.box}>
          <Text style={s.heading}>카드 상세 혜택</Text>

          {catalogOf(selected)?.benefits?.slice(0, 6).map((benefit, index) => <View key={index} style={s.detail}>
                <Text style={s.label}>
                  {benefit.name}
                  {' · '}{benefitText(benefit)}
                </Text>

                <Text style={s.hint}>
                  전월 실적{' '}
                  {benefit.minPrevSpend == null ? '확인 필요' : won(benefit.minPrevSpend) + ' 이상'}
                </Text>

                {!!benefit.note && <Text style={s.hint}>
                    {benefit.note}
                  </Text>}
              </View>)}

          {!catalogOf(selected) && findCatalog40Product(selected)?.benefits.slice(0, 6).map(benefit => <View key={benefit.benefitId} style={s.detail}>
            <Text style={s.label}>{benefit.name}</Text>
            {!!benefit.note && <Text style={s.hint}>{benefit.note}</Text>}
          </View>)}
          {!catalogOf(selected) && !findCatalog40Product(selected) && <Text style={s.hint}>
              {selectedBenefit?.condition || selected.reason || '정확한 혜택 조건은 카드사 상품 안내에서 확인해주세요.'}
            </Text>}
        </View>

      </View>
    </ScrollView>
    <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
      <TouchableOpacity activeOpacity={1} accessibilityLabel="카드 선택 닫기" style={s.sheetBackdrop} onPress={() => setPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={s.sheet}>
          <Text style={s.heading}>결제할 카드 선택</Text>
          <ScrollView style={s.sheetList}>
            {options.map(item => {
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
    />
  </>;
}
const s = StyleSheet.create({
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
  benefitBox: {
    width: '100%',
    backgroundColor: "#EDF3FF",
    padding: 16,
    borderRadius: 15,
    alignItems: 'center',
    gap: 8
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
  scrollHint: {
    color: '#8A9AB1',
    fontSize: 12,
    textAlign: 'center'
  },
  detail: {
    borderTopWidth: 1,
    borderColor: "#E3EAF4",
    paddingTop: 12,
    gap: 5
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    lineHeight: 22
  },
  empty: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 20
  }
});
