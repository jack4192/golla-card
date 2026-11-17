import PaymentCardOrder from '../components/PaymentCardOrder';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import makeQR from 'qrcode-generator';
import JsBarcode from 'jsbarcode';
import { CARD_CATALOG, DEMO_WALLET_CARDS } from '../data/cards';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { evaluatePdfCard } from '../data/paymentBenefits';
import { benefitText, evaluateBenefit } from '../utils/cardRecommendation';
import { createPinSalt } from '../utils/pinCrypto';
const SCENARIOS = [{
  id: 'coffee',
  merchant: '스타벅스',
  amount: 15000,
  category: /카페|커피/,
  brand: /스타벅스/i
}, {
  id: 'cu',
  merchant: 'CU',
  amount: 10000,
  category: /편의점/,
  brand: /\bCU\b|씨유/i
}, {
  id: 'gs',
  merchant: 'GS25',
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
  const image = catalog ? CARD_PRODUCTS[catalog.code]?.image : pdf?.image;
  if (!image || !catalog && !pdf) {
    return null;
  }
  return {
    ...card,
    name: catalog?.name || pdf.name,
    issuer: catalog?.issuer || '신한카드',
    type: catalog?.type || '체크',
    catalogCode: catalog?.code,
    image,
    realProduct: true
  };
}
export function realWalletCards(card, cards = []) {
  const matched = [...(card ? [card] : []), ...cards].map(realProductCard).filter(Boolean);
  return Array.from(new Map(matched.map(item => [item.id, item])).values());
}
export function estimatePayment(card, scenario, assume) {
  const unknown = reason => ({
    value: null,
    unit: 'KRW',
    reason,
    name: '확인 필요'
  });
  if (!assume) {
    return unknown('실적·한도·대상 거래 조건을 확인하기 전에는 금액을 계산하지 않습니다.');
  }
  const spend = Number.isFinite(card.status?.previousSpend) ? card.status.previousSpend : 400000;
  const catalog = catalogOf(card);
  if (!catalog) {
    const row = evaluatePdfCard(card, scenario.id, scenario.amount, spend);
    return {
      value: row.status === 'eligible' ? row.value : null,
      unit: row.unit === '원' ? 'KRW' : row.unit,
      name: row.label,
      reason: row.detail,
      condition: row.rule
    };
  }
  const benefits = catalog.benefits.filter(benefit => scenario.category.test(benefit.name) && (benefit.brandScope !== 'BRAND_ONLY' || scenario.brand.test(benefit.name)) && !/해외|추가 적립|추가 할인|웰컴|리워드|정기결제|자동납부|구독|리터/.test(benefit.name));
  if (!benefits.length) {
    return unknown('선택한 거래와 정확히 연결되는 혜택을 확인하지 못했습니다.');
  }
  const evaluated = benefits.map(benefit => evaluateBenefit(catalog, benefit, {
    spend,
    amount: scenario.amount,
    remaining: {},
    assume: true,
    now: new Date()
  }));
  const known = evaluated.filter(row => Number.isFinite(row.value));
  known.sort((a, b) => a.unit === b.unit ? b.value - a.value : a.unit === 'KRW' ? -1 : 1);
  const row = known[0] || evaluated[0];
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
  return <View accessibilityLabel={inactive ? '사용할 수 없는 가상 결제 코드' : '가상 결제 QR 및 바코드'} style={[s.codes, inactive && s.dim]}>
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
  cards = DEMO_WALLET_CARDS,
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
  const mounted = useRef(true);
  const sequence = useRef(0);
  const current = useRef(null);
  const notified = useRef(null);
  const selected = options.find(item => item.id === selectedId) || options[0];
  const baseline = options.find(item => item.id === baselineId) || options[0];
  const scenario = SCENARIOS.find(item => item.id === scenarioId) || SCENARIOS[0];
  const selectedBenefit = useMemo(() => selected ? estimatePayment(selected, scenario, assume) : null, [selected, scenario, assume]);
  const baseBenefit = useMemo(() => baseline ? estimatePayment(baseline, scenario, assume) : null, [baseline, scenario, assume]);
  const difference = comparePayment(selectedBenefit, baseBenefit);
  const source = selected?.image;
  const seconds = payment ? Math.max(0, Math.ceil((payment.expiresAt - now) / 1000)) : 0;
  const expired = !payment || seconds === 0 || payment.status !== 'pending' || payment.cardId !== selected?.id || payment.contextKey !== scenario.id + ':' + assume;
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
      setError('보유한 카드만 결제 시연에 사용할 수 있습니다.');
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
        contextKey: scenario.id + ':' + assume,
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
  }, [selected?.id, scenarioId, assume]);
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
    if (!active || !token || token.status !== 'pending' || token.expiresAt <= Date.now() || token.cardId !== selected.id || token.contextKey !== scenario.id + ':' + assume) {
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
          등록된 실제 상품 카드가 없습니다.
        </Text>

        <Text style={s.hint}>
          기존 임의 상품은 제외했습니다.
          카드 관리에서 실제 보유 상품을 등록해주세요.
        </Text>

        <TouchableOpacity onPress={close}>
          <Text style={s.link}>
            카드 등록하러 돌아가기
          </Text>
        </TouchableOpacity>
      </View>;
  }
  return <ScrollView style={s.screen} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" onPress={close}>
            <Text style={s.link}>← 돌아가기</Text>
          </TouchableOpacity>

          <Text style={s.demo}>
            DEMO · 실제 출금 없음
          </Text>
        </View>

        <Text style={s.title}>
          {receipt ? '가상 결제 완료' : '현장 결제'}
        </Text>

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

            {generating ? <ActivityIndicator size="large" color="#245DE5" style={{
          padding: 35
        }} /> : payment && active ? <Codes value={payment.value} inactive={expired} /> : <Text style={s.hint}>
                {active ? '코드를 발급해주세요.' : '앱이 비활성 상태라 코드를 숨겼습니다.'}
              </Text>}

            <Text style={s.hint}>
              60초간 유효한 프론트 데모 코드입니다.
              실제 매장에서 결제할 수 없습니다.
              재발급하면 이전 코드는 폐기됩니다.
            </Text>

            <TouchableOpacity accessibilityRole="button" disabled={generating || !active} onPress={issue} style={[s.secondary, generating && s.dim]}>
              <Text style={s.link}>
                새 결제 코드 발급
              </Text>
            </TouchableOpacity>

            <TouchableOpacity accessibilityRole="button" disabled={expired || generating || !active} onPress={approve} style={[s.primary, (expired || generating || !active) && s.dim]}>
              <Text style={s.white}>
                가상 POS 승인 체험
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
              이번 가상 거래의 예상 혜택
            </Text>

            <Text style={s.hint}>
              {scenario.merchant}
              {' · '}{won(scenario.amount)}
              {' · '}가상 거래 예시
            </Text>

            <Text style={s.benefit}>
              {reward(selectedBenefit)}
            </Text>

            <Text style={s.comparison}>
              {difference === null ? '기존 카드와 비교할 수 있는 원화 혜택 정보가 부족해요.' : difference > 0 ? '가정대로라면 기존 카드보다 ' + won(difference) + ' 더 아낄 수 있어요!' : difference === 0 ? '이 조건에서는 기존 카드와 원화 혜택이 같아요.' : '이 조건에서는 기존 카드가 ' + won(-difference) + ' 더 유리해요.'}
            </Text>

            <Text style={s.hint}>
              비교 카드: {baseline.name}
              {' · '}{reward(baseBenefit)}
            </Text>

            <Text style={s.hint}>
              실적은 DB 값 또는 40만 원,
              월 한도 미사용·상세 조건 충족 가정입니다.
            </Text>
          </View>
        </View>

        {receipt && <View style={s.box}>
            <Text style={s.heading}>가상 승인 결과</Text>

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
              {receipt.difference > 0 ? '가정한 가상 거래에서 기존 카드보다 ' + won(receipt.difference) + ' 더 아꼈어요.' : '예상 혜택 ' + reward(receipt.benefit)}
            </Text>

            <Text style={s.hint}>
              실제 승인·출금·금융사 실적 반영은
              발생하지 않습니다.
            </Text>

            <TouchableOpacity style={s.primary} onPress={close}>
              <Text style={s.white}>메인으로</Text>
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
            지갑에서 선택한 {selected.name}를
            결제 카드로 유지하고 있어요.
            선택하지 않은 카드로 자동 변경하지 않습니다.
          </Text>

          <Text style={s.text}>
            {selectedBenefit?.name}
          </Text>

          <Text style={s.hint}>
            {selectedBenefit?.reason}
          </Text>

          {!!selectedBenefit?.condition && <Text style={s.hint}>
              {selectedBenefit.condition}
            </Text>}
        </View>

        <View style={s.box}>
          <Text style={s.heading}>
            혜택 비교에 사용한 가상 조건
          </Text>

          <Text style={s.text}>
            {scenario.merchant}
            {' · '}{won(scenario.amount)}
          </Text>

          <View style={s.chips}>
            {SCENARIOS.map(item => <TouchableOpacity key={item.id} onPress={() => setScenarioId(item.id)} style={[s.chip, item.id === scenario.id && s.chipOn]}>
                <Text style={item.id === scenario.id ? s.whiteSmall : s.chipText}>
                  {item.merchant}
                </Text>
              </TouchableOpacity>)}
          </View>

          <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{
          checked: assume
        }} onPress={() => setAssume(!assume)} style={s.secondary}>
            <Text style={s.link}>
              {assume ? '☑' : '☐'} 가상 조건 충족 가정
            </Text>
          </TouchableOpacity>

          <Text style={s.hint}>
            DB 전월 실적이 있으면 그 값을 사용하고,
            없으면 전월 40만 원을 가정합니다.
            월 한도 미사용·대상 거래·결제 방식·횟수
            조건 충족을 가정한 예시입니다.
            실제 절약액이 아닙니다.
            포인트는 원화와 비교하지 않습니다.
          </Text>

          {selected.status && <Text style={s.hint}>
              선택 카드 실적 자료:
              {' '}{selected.status.month}
              {' · '}전월{' '}
              {won(selected.status.previousSpend)}
            </Text>}

          <Text style={s.label}>
            비교할 기존 카드
          </Text>

          <View style={s.chips}>
            {options.map(item => <TouchableOpacity key={item.id} onPress={() => setBaselineId(item.id)} style={[s.chip, item.id === baseline.id && s.chipOn]}>
                <Text style={item.id === baseline.id ? s.whiteSmall : s.chipText}>
                  {item.name}
                </Text>
              </TouchableOpacity>)}
          </View>
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

          {!catalogOf(selected) && <Text style={s.hint}>
              {selectedBenefit?.condition || selected.reason || '정확한 혜택 조건은 카드사 상품 안내에서 확인해주세요.'}
            </Text>}
        </View>

        <Text style={s.hint}>
          QR·Code128 바코드는 같은 18자리 가상 코드를
          담습니다. 웹에서는 화면 밝기 변경과
          캡처 차단을 지원하지 않습니다.
        </Text>
      </View>
    </ScrollView>;
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F7FC'
  },
  content: {
    padding: 20,
    paddingBottom: 100
  },
  container: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: 16
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
  },
  demo: {
    color: '#8090A9',
    fontSize: 10
  },
  title: {
    fontSize: 27,
    fontWeight: '900',
    color: '#183252',
    textAlign: 'center'
  },
  hero: {
    backgroundColor: '#FFF',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E7EDF7'
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
    fontWeight: '900',
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
    backgroundColor: '#EDF4FF',
    padding: 16,
    borderRadius: 15,
    alignItems: 'center',
    gap: 8
  },
  benefit: {
    fontSize: 25,
    fontWeight: '900',
    color: '#245DE5',
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
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 18,
    gap: 13,
    borderWidth: 1,
    borderColor: '#E7EDF7'
  },
  heading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#233E63'
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
    color: '#8391A7',
    fontSize: 12,
    lineHeight: 21
  },
  codes: {
    backgroundColor: '#FFF',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 15
  },
  codeNumber: {
    color: '#20334F',
    fontSize: 15,
    letterSpacing: 2
  },
  timer: {
    color: '#245DE5',
    fontSize: 18,
    fontWeight: '900'
  },
  red: {
    color: '#C14756'
  },
  primary: {
    padding: 15,
    minHeight: 50,
    backgroundColor: '#245DE5',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondary: {
    padding: 13,
    backgroundColor: '#EDF3FF',
    borderRadius: 12,
    alignItems: 'center'
  },
  white: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '800'
  },
  link: {
    color: '#245DE5',
    fontSize: 13,
    fontWeight: '700'
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
    backgroundColor: '#EEF2FA'
  },
  chipOn: {
    backgroundColor: '#245DE5'
  },
  chipText: {
    color: '#506B91',
    fontSize: 12
  },
  whiteSmall: {
    color: '#FFF',
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
    borderColor: '#EDF1F7',
    paddingTop: 12,
    gap: 5
  },
  error: {
    color: '#B83850',
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
