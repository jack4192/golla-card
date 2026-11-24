import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, PanResponder, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { findCatalog40Product } from '../data/cardCatalog40';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { evaluatePdfCard, PAYMENT_SCENARIOS } from '../data/paymentBenefits';
import { benefitText } from '../utils/cardRecommendation';
import { DAYS, routineLabel } from '../utils/routineDetails';
import { isScheduleBenefitAt, makeSchedulePaymentScenario, matchesScheduleBenefit } from '../utils/schedulePayment';
import { SERVER_MODE } from '../utils/api';
import { loadAiEstimates } from '../utils/aiEstimate';
import { bestCardOf, exampleScenario } from '../utils/aiEstimateCore';
import { loadPlacementPreview } from '../utils/aiPlacement';
import { loadDayPlacement } from '../utils/dayTimeline';
import { loadTodayPayments } from '../utils/payments';
import { MAX_MINUTE, STEP_MINUTES, cardChangeDots, minuteOfDay, minuteToRatio, paymentAt, paymentDots, paymentLine, ratioToMinute, scrubbedCard, timeLabel } from '../utils/dayTimelineCore';
import { aiWindowKey, inAiWindow, scheduleAiExample, scheduleAiMatch } from '../utils/scheduleAiCore';
import { SCHEDULE_SAMPLES } from '../data/samplePayment';
import { resolveWalletProduct } from './WalletProductCard';
import SpecialScheduleModal from './SpecialScheduleModal';
import { CATEGORIES, categoryLabel, dailyBasicSchedule, dateKey, deleteEvent, effectiveDetailedRoutine, eventBenefitCategories, eventEndDate, eventTimeCaption, eventTitle, isTodayConfirmed, makeSignals, readEvents, readProfile, shiftDate } from '../utils/routineData';

const categoryIcons = {
  cafe: 'cafe-outline',
  restaurant: 'restaurant-outline',
  pcroom: 'game-controller-outline',
  travel: 'airplane-outline',
  train: 'train-outline',
  intercity: 'bus-outline',
  transport: 'subway-outline',
  taxi: 'car-outline',
  convenience: 'storefront-outline',
  delivery: 'bicycle-outline',
  fuel: 'speedometer-outline',
  shopping: 'cart-outline',
  medical: 'medkit-outline',
  other: 'create-outline',
};

const hourLabel = hour => `${String(hour).padStart(2, '0')}:00`;
const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
// 홈 시간 표시줄은 하루 전체(0~24시)다. 파란 동그라미를 끌거나 눌러 그 시각의 AI 카드를 미리 본다 (2026-11-23 설계서 home-day-timeline)
const dayTicks = [0, 6, 12, 18, 24];
const chartPercent = ratio => `${ratio * 100}%`;
const scheduleLabel = label => label.replace(/^\p{Extended_Pictographic}\uFE0F?\s+/u, '');
const bubbleWidth = 92;
const dotTapPx = 12;      // 결제 점을 누른 것으로 보는 거리

// 표시줄 세로 배치 (2026-11-24 '24시간 바에 일정' 디자인): 말풍선 → 시각 글자 → 두꺼운 바(일정 블록) → 다른 카드 구간 선
const BAR_TOP = 51;
const BAR_H = 8;
const BAR_H_TWO = 8;
// 6시간 구간 색 (파랑 계열): 새벽·저녁은 진하게, 오전·오후는 밝게
const daySections = ['#2B4FC7', '#5A93F2', '#8CC8F8', '#4369DC'];
const BAR_PAD = 3;
const LANE_GAP = 2;

// 겹치는 일정은 위아래 두 줄로 나눈다 (시작 순으로 비어 있는 첫 줄, 세 번째부터는 아래 줄에 겹쳐 그린다)
function scheduleLanes(rows) {
  const ends = [];
  const lane = {};
  [...rows].sort((a, b) => a.startDate - b.startDate).forEach(row => {
    let index = ends.findIndex(end => end <= row.startDate);
    if (index < 0) { index = Math.min(ends.length, 1); if (index === ends.length) ends.push(0); }
    ends[index] = Math.max(ends[index], row.endDate);
    lane[row.key] = index;
  });
  return { lane, count: Math.max(1, ends.length) };
}

function HomeScheduleRibbon({ start, clockTime, nowMinute, viewMinute, onScrub, onNow, dots = [], changeDots = [], cardSpans = [], rows, selected, onSelect, emptyMessage }) {
  const [axisWidth, setAxisWidth] = useState(0);
  const position = time => Math.min(1, Math.max(0, (time - start) / dayMs));
  const scrubbing = viewMinute != null;
  const cursorMinute = scrubbing ? viewMinute : nowMinute;
  const cursor = minuteToRatio(cursorMinute);
  const minuteOfRow = time => (time - start) / 60000;
  // 일정 상태: 끝남(회색) · 진행 중(진한 파랑) · 예정(연한 파랑)
  const stateOf = row => row.inProgress ? 'now' : minuteOfRow(row.endDate) <= nowMinute ? 'past' : 'next';
  const bubbleText = scrubbing ? `${timeLabel(viewMinute)} 미리보기` : `지금 ${clockTime}`;
  // 말풍선이 표시줄 밖으로 나가지 않게 (옮겼을 때는 오른쪽 위 '지금' 버튼 자리도 비운다)
  const bubbleLeft = axisWidth > 0
    ? Math.min(Math.max(cursor * axisWidth - bubbleWidth / 2, -22), axisWidth - bubbleWidth + (scrubbing ? -46 : 22))
    : null;

  // 일정 블록 자리: 가로는 시각, 세로는 겹침 줄
  const { lane, count } = scheduleLanes(rows);
  const barH = count > 1 ? BAR_H_TWO : BAR_H;
  const laneHeight = (barH - BAR_PAD * 2 - LANE_GAP * (count - 1)) / count;
  const blocks = rows.map(row => {
    const left = position(row.startDate);
    const width = Math.max(0.008, position(row.endDate) - left);
    const top = BAR_TOP + BAR_PAD + lane[row.key] * (laneHeight + LANE_GAP);
    return { row, left, width, top, state: stateOf(row) };
  });

  // 끌기·누르기: 표시줄 위 투명한 판 하나가 받는다. 위치는 페이지 x·y 에서 표시줄의 페이지 x·y 를 빼서 구한다
  // (웹에서는 locationX 가 판 기준으로 오지 않을 때가 있어 쓰지 않는다)
  const axisRef = useRef(null);
  const axisOrigin = useRef({ x: 0, y: 0 });
  const measureAxis = () => axisRef.current?.measure?.((x, y, width, height, pageX, pageY) => {
    if (Number.isFinite(pageX)) axisOrigin.current = { x: pageX, y: pageY };
  });
  const latest = useRef({});
  // 누르면: 가까운 카드가 바뀌는 시각, 아니면 그 시각으로
  latest.current = { axisWidth, dots: [...dots, ...changeDots], onScrub, blocks, laneHeight, barH, onSelect };
  const grant = useRef({ x: 0, y: 0 });
  const moved = useRef(false);
  const scrubTo = x => {
    const { axisWidth: width, onScrub: scrub } = latest.current;
    if (width > 0) scrub(ratioToMinute(x / width));
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: event => {
      grant.current = { x: event.nativeEvent.pageX - axisOrigin.current.x, y: event.nativeEvent.pageY - axisOrigin.current.y };
      moved.current = false;
      measureAxis();
    },
    onPanResponderMove: (_, gesture) => {
      if (Math.abs(gesture.dx) > 3) moved.current = true;
      if (moved.current) scrubTo(grant.current.x + gesture.dx);
    },
    onPanResponderRelease: (_, gesture) => {
      if (moved.current) {
        scrubTo(grant.current.x + gesture.dx);
        return;
      }
      const { axisWidth: width, dots: marks, onScrub: scrub } = latest.current;
      const { x } = grant.current;
      const hit = width > 0 ? marks.map(dot => ({ dot, gap: Math.abs(dot.ratio * width - x) }))
        .filter(item => item.gap <= dotTapPx).sort((a, b) => a.gap - b.gap)[0] : null;
      if (hit) scrub(hit.dot.minute);
      else scrubTo(x);
    },
  })).current;
  const step = direction => onScrub(Math.min(MAX_MINUTE, Math.max(0, cursorMinute + direction * STEP_MINUTES)));
  const scheduleSummary = rows.map(row => `${scheduleLabel(row.label)} ${row.timeCaption}`).join(', ');

  return <View style={styles.homeRibbon}>
    {scrubbing && <TouchableOpacity accessibilityRole="button" accessibilityLabel="현재 시각으로 돌아가기"
      style={styles.homeNowButton} onPress={onNow} hitSlop={8}>
      <Ionicons name="refresh-outline" size={14} color="#1D55D9" />
      <Text style={styles.homeNowButtonText}>지금</Text>
    </TouchableOpacity>}
    <View ref={axisRef} style={[styles.homeAxis, { height: BAR_TOP + barH + 12 }]} onLayout={event => {
      setAxisWidth(event.nativeEvent.layout.width);
      measureAxis();
    }}>
      {dayTicks.map(tick => <View key={tick} style={[styles.homeTick, { left: chartPercent(tick / 24) }]}>
        <Text style={styles.homeTickLabel}>{hourLabel(tick)}</Text>
      </View>)}
      {/* 가는 24시간 바: 6시간마다 색이 다른 4구간 (새벽·오전·오후·저녁) */}
      {daySections.map((color, index) => <View key={'section-' + index} pointerEvents="none" style={[styles.homeSection,
        index === 0 && styles.homeSectionFirst, index === daySections.length - 1 && styles.homeSectionLast,
        { left: chartPercent(index / daySections.length), width: chartPercent(1 / daySections.length), backgroundColor: color }]} />)}
      {/* 카드가 바뀌는 시각: 흰 점, 테두리는 그 시각 구간의 바 색 */}
      {changeDots.map(dot => <View key={dot.key} pointerEvents="none" style={[styles.homeChangeDot, {
        left: chartPercent(dot.ratio),
        borderColor: daySections[Math.min(daySections.length - 1, Math.floor(dot.minute / (24 * 60 / daySections.length)))],
      }]} />)}
      <View pointerEvents="none" style={[styles.homeNowArrow, scrubbing && styles.homeNowArrowPreview, { left: chartPercent(cursor) }]} />
      <View style={[styles.homeNow, scrubbing && styles.homeNowPreview,
        bubbleLeft == null ? { left: chartPercent(cursor), marginLeft: -bubbleWidth / 2 } : { left: bubbleLeft, marginLeft: 0 }]}>
        <Text style={styles.homeNowText}>{bubbleText}</Text>
      </View>
      <View {...pan.panHandlers} style={styles.homeAxisTouch} accessible accessibilityRole="adjustable"
        accessibilityLabel={`시각 옮기기, ${bubbleText}`}
        accessibilityHint={[scheduleSummary && `오늘 일정: ${scheduleSummary}`,
          changeDots.length && `카드가 바뀌는 시각: ${changeDots.map(dot => timeLabel(dot.minute)).join(', ')}`].filter(Boolean).join('. ') || undefined}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)} />
    </View>
    {!rows.length && <Text style={styles.homeEmptyCaption}>{emptyMessage}</Text>}
  </View>;
}

const toScheduleProduct = card => ({
  card,
  catalog: findCatalog40Product(card),
  legacy: CSV_CARD_CATALOG.find(product => product.code === card.catalogCode),
});

function findScheduleCard(categories, products, now) {
  for (const { card, catalog, legacy } of products) {
    const categoryFor = benefit => isScheduleBenefitAt(benefit, now) && categories.find(category => matchesScheduleBenefit(benefit.name, category));
    const benefit = catalog?.benefits.find(categoryFor);
    if (benefit) return { card, label: benefit.name, benefitName: benefit.name, category: categoryFor(benefit) };

    const fallback = legacy?.benefits.find(categoryFor);
    if (fallback) return {
      card,
      label: fallback.name + ' · ' + benefitText(fallback),
      benefitName: fallback.name,
      category: categoryFor(fallback),
    };
  }
  for (const category of categories) {
    const scenarios = category === 'convenience' ? ['cu', 'gs'] : category === 'cafe' ? ['coffee'] : [];
    for (const id of scenarios) {
      const scenario = PAYMENT_SCENARIOS.find(item => item.id === id);
      for (const { card, catalog, legacy } of products) {
        if (catalog || legacy) continue;
        const offer = evaluatePdfCard(card, id, scenario.amount, null);
        if (offer.status !== 'eligible' && offer.status !== 'needSpend') continue;
        const label = offer.status === 'eligible' ? offer.label : offer.detail;
        return { card, label, benefitName: label, category, pdfScenario: id };
      }
    }
  }
  return null;
}

// 탭을 옮겼다 돌아오면 이 화면이 새로 만들어진다. 지난 AI 계산을 기억해 두고 처음부터 보여 줘야
// '앱 계산 카드 → AI 카드'로 그림이 잠깐 바뀌는 깜빡임이 없다 (새 계산이 오면 그때 바꾼다)
const aiMemory = { byCategory: {}, preview: { key: '', result: null, estimates: null }, daySegments: null };

export default function TodaySchedulePanel({
  onEditRoutine,
  onViewBenefits,
  onPay,
  onOpenCards,
  cardList = null,
  paymentsList = null,   // 홈 '최근 이용내역' (서버 모드, MainScreen 이 넣는다)
  headerRight = null,    // 홈 '내 지갑' 제목 오른쪽 (자동 배치 스위치, 2026-11-24 수정사항)
  onOpenSchedule,
  sampleActive,
  onStartSample,
  onEndSample,
  cards = [],
  selectedCard,
  home = false,
  disabled = false,
  aiRefresh = 0
}) {
  const [day, setDay] = useState(dateKey);
  const [clock, setClock] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [profile, setProfile] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(null);
  const [managing, setManaging] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const deleteLock = useRef(false);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // 서버 모드: 일정 업종별로 AI 가 계산한 '가장 많이 주는 내 카드' { [앱 업종]: { walletId, value } | null }
  const [aiByCategory, setAiByCategory] = useState(() => aiMemory.byCategory);
  // 서버 모드: 일정 창(시작 30분 전 ~ 끝 30분 후) 안이면 AI 배치 미리보기(기록 없음)와 그 예시 거래의 계산
  //   { key: 창 열쇠, result: applyRank 결과, estimates: { [지갑 카드 id]: 예상 혜택 } } (2026-11-23 홈 일정 카드 설계서)
  const [aiPreview, setAiPreview] = useState(() => aiMemory.preview);
  useEffect(() => { aiMemory.byCategory = aiByCategory; }, [aiByCategory]);
  useEffect(() => { aiMemory.preview = aiPreview; }, [aiPreview]);
  // 홈 시간 표시줄 (2026-11-23 설계서 home-day-timeline): 옮긴 시각(분, null 이면 지금),
  //   하루 배치 구간(null 이면 읽는 중, [] 이면 실패·없음), 오늘 결제(결제 점)
  const [viewMinute, setViewMinute] = useState(null);
  const [daySegments, setDaySegments] = useState(() => aiMemory.daySegments);
  useEffect(() => { aiMemory.daySegments = daySegments; }, [daySegments]);
  const [todayPayments, setTodayPayments] = useState([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      const now = new Date();
      setClock(now);
      if (reading) return;
      reading = true;
      const today = dateKey(now);
      try {
        const [saved, routine, checked] = await Promise.all([readEvents(), readProfile(), isTodayConfirmed(today)]);
        if (!active) return;
        setDay(today);
        setEvents(saved);
        setProfile(routine);
        setConfirmed(checked);
        setError('');
      } catch {
        if (active) {
          setError('일과·일정을 불러오지 못했습니다. 다시 확인해주세요.');
        }
      } finally {
        reading = false;
        if (active) {
          setLoading(false);
        }
      }
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    if (Platform.OS === 'web') {
      window.addEventListener('focus', refresh);
    }
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
      if (Platform.OS === 'web') {
        window.removeEventListener('focus', refresh);
      }
    };
  }, [disabled, revision]);
  const today = new Date(day + 'T12:00:00');
  const weekday = today.getDay();
  const currentHour = clock.getHours();
  const isCurrentDay = dateKey(clock) === day;
  const dateCaption = (today.getMonth() + 1) + '월 ' + today.getDate() + '일 ' + DAYS[weekday] + '요일';
  const routines = effectiveDetailedRoutine(profile).filter(row => row.days?.includes(weekday));
  const previousDay = shiftDate(day, -1);
  const todayEvents = events.filter(event => event.date === day || (
    event.date === previousDay && event.start && event.end < event.start &&
    isCurrentDay && clock < eventEndDate(event)
  ));
  const signals = makeSignals(profile, events, day).map(signal => categoryLabel(signal.id));
  const refresh = () => setRevision(value => value + 1);
  const remove = async event => {
    if (disabled || deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteEvent(event.id);
      setEvents(previous => previous.filter(item => item.id !== event.id));
      setConfirmDelete(null);
      refresh();
    } catch {
      setDeleteError('일정을 삭제하지 못했어요. 다시 시도해주세요.');
    } finally {
      deleteLock.current = false;
      setDeleting(false);
    }
  };
  const products = cards.map(toScheduleProduct);
  const selectedProduct = resolveWalletProduct(selectedCard);
  const canPayWithSelected = cards.some(card => card.id === selectedCard?.id);
  const sample = SCHEDULE_SAMPLES.find(item => item.id === sampleActive);
  const sampleMatch = sample && findScheduleCard([sample.category], sample.cards.map(toScheduleProduct),
    new Date(`${day}T${sample.start}:00`));
  const sampleCard = sample && (sampleMatch?.card || sample.cards[0]);
  // 일정 업종의 카드: 서버 모드에서 AI 계산이 있으면 그것을, 아직 없거나 데모 모드면 앱 계산을 쓴다.
  const matchFor = (categories, when) => {
    if (SERVER_MODE && categories.length && categories.every(category => aiByCategory[category] !== undefined)) {
      const best = categories.map(category => aiByCategory[category] && { ...aiByCategory[category], category })
        .filter(Boolean).sort((a, b) => b.value - a.value)[0];
      const card = best && cards.find(item => item.id === best.walletId);
      if (!card) return null;
      const label = `${best.value.toLocaleString('ko-KR')}원 예상 혜택`;
      return { card, label, benefitName: label, category: best.category };
    }
    return findScheduleCard(categories, products, when);
  };
  const baseTimeline = [
    ...dailyBasicSchedule(profile, day).map(({ label, category, start, end }) => {
      const time = hourLabel(start);
      const endTime = hourLabel(end);
      const startDate = new Date(`${day}T${time}:00`);
      const endDate = eventEndDate({ date: day, start: time, end: endTime });
      const inProgress = isCurrentDay && currentHour >= start && currentHour < end;
      const matchTime = inProgress ? clock : startDate;
      return {
        key: `basic:${label}:${start}`,
        icon: categoryIcons[category] || 'restaurant-outline',
        label,
        time,
        startDate,
        endDate,
        timeCaption: `${time}~${endTime}`,
        description: '평소 일과 · ' + (category ? CATEGORIES[category].label : '저장한 점심 시간'),
        inProgress,
        basic: true,
        cats: category ? [category] : [],
        match: category ? matchFor([category], matchTime) : null,
      };
    }),
    ...routines.map(row => {
      const startDate = new Date(`${day}T${row.start}:00`);
      const endDate = eventEndDate({ ...row, date: day });
      const inProgress = isCurrentDay && clock >= startDate && clock < endDate;
      return {
        key: 'routine:' + row.id, icon: categoryIcons[row.category] || 'time-outline',
        label: routineLabel(row), time: row.start, timeCaption: eventTimeCaption(row),
        startDate, endDate,
        description: '평소 일과', inProgress,
        cats: [row.category],
        match: matchFor([row.category], inProgress ? clock : startDate),
      };
    }),
    ...todayEvents.map(event => {
      const categories = eventBenefitCategories(event);
      const timed = Boolean(event.start && event.end);
      const startDate = timed ? new Date(`${event.date}T${event.start}:00`) : null;
      const endDate = timed ? eventEndDate(event) : null;
      const inProgress = timed && isCurrentDay && clock >= startDate && clock < endDate;
      return {
        key:'special:'+event.id, icon:categoryIcons[categories[0]] || 'calendar-outline',
        label:eventTitle(event),
        event,
        date:event.date,
        time:event.start,
        startDate, endDate,
        timeCaption:eventTimeCaption(event),
        description:event.memo || (timed ? '특별 일정' : '특별 일정 · 시간 미지정'),
        inProgress,
        cats: categories,
        match: matchFor(categories, inProgress ? clock : startDate),
      };
    }),
  ].sort((a, b) => (a.time || '24:00').localeCompare(b.time || '24:00'));
  const walletKey = cards.map(card => card.id).join(',');
  // AI 가 지금 일정을 보고 순서를 정하는 창 안이면 그 판단을 쓴다 (사용자 결정 '일정 중엔 늘 AI').
  // 창 열쇠가 바뀔 때만 묻고(1분마다 묻지 않는다), 홈 호출은 추천 기록을 남기지 않는다(미리보기).
  // aiRefresh: 홈이 열린 채로 AI 쪽 상태가 바뀌면(홈 추천 팝업이 일정 행사를 계산함, 챗봇 규칙 확정) 다시 묻는다.
  //   열쇠는 그대로라 새 답이 올 때까지 지난 미리보기를 계속 보인다 (2026-11-23 리뷰).
  const windowKey = SERVER_MODE && !disabled ? aiWindowKey(baseTimeline, clock, cards.map(card => card.id)) : '';
  useEffect(() => {
    if (!SERVER_MODE || !windowKey) return undefined;
    let stopped = false;
    const windowCats = [...new Set(baseTimeline.filter(row => inAiWindow(row, clock)).flatMap(row => row.cats || []))];
    const keep = (result, estimates) => { if (!stopped) setAiPreview({ key: windowKey, result, estimates }); };
    loadPlacementPreview(cards).then(async result => {
      const example = scheduleAiExample(result, windowCats);
      keep(result, example ? await loadAiEstimates(exampleScenario(example)) : null);
    }).catch(() => keep(null, null));
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, aiRefresh]);
  const preview = aiPreview.key === windowKey ? aiPreview : null;
  const timeline = baseTimeline.map(row => {
    const ai = scheduleAiMatch({ row, clock, preview, cards });
    return ai ? { ...row, match: ai } : row;
  });
  // 타임라인에 나온 업종마다 AI 에 한 번씩 묻는다 (일정 예시 금액으로)
  const categoryKey = [...new Set(timeline.flatMap(row => row.cats || []))].sort().join(',');
  useEffect(() => {
    if (!SERVER_MODE || !categoryKey) return undefined;
    let stopped = false;
    for (const category of categoryKey.split(',')) {
      const scenario = makeSchedulePaymentScenario({ category });
      if (!scenario) continue;   // AI 업종이 없는 것(직접 입력 업종 등)은 앱 계산을 쓴다
      loadAiEstimates(scenario).then(rows => {
        if (stopped) return;
        // AI 가 답하지 못하면(rows=null) 그 업종은 앱 계산을 쓰도록 비워 둔다
        setAiByCategory(value => {
          const next = { ...value };
          if (rows) next[category] = bestCardOf(rows); else delete next[category];
          return next;
        });
      });
    }
    return () => { stopped = true; };
  }, [categoryKey, walletKey]);
  const currentMatch = timeline.find(row => row.date && row.inProgress && row.match)
    || timeline.find(row => row.inProgress && row.match);
  const current = currentMatch || timeline.find(row => row.inProgress);
  const clockTime = clock.toTimeString().slice(0, 5);
  // 홈 시간 표시줄: 날짜가 바뀌면 미리보기를 지금으로 돌린다
  useEffect(() => { setViewMinute(null); }, [day]);
  // 하루 배치: 날짜·지갑 카드·그날 일정이 바뀌거나 AI 쪽 상태가 바뀌면(aiRefresh) 다시 묻는다 (기록 없음)
  const dayScheduleKey = timeline.filter(row => row.startDate).map(row => `${row.key}@${row.time}`).join('|');
  useEffect(() => {
    if (!home || !SERVER_MODE || disabled || !cards.length) return undefined;
    let stopped = false;
    // 다시 물을 때 지난 배치를 지우지 않는다: 지우면 카드가 바뀌는 점이 잠깐 사라졌다가 늦게 뜬다
    loadDayPlacement(cards).then(segments => { if (!stopped) setDaySegments(segments || []); })
      .catch(() => { if (!stopped) setDaySegments([]); });
    return () => { stopped = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home, disabled, day, walletKey, dayScheduleKey, aiRefresh]);
  // 오늘 결제(결제 점): 1분 시계가 돌 때마다 다시 읽어 지나간 결제가 새로 보이게 한다. 실패하면 점을 숨긴다
  useEffect(() => {
    if (!home || !SERVER_MODE || disabled) return undefined;
    let stopped = false;
    loadTodayPayments(day).then(rows => { if (!stopped) setTodayPayments(rows); })
      .catch(() => { if (!stopped) setTodayPayments([]); });
    return () => { stopped = true; };
  }, [home, disabled, day, clockTime]);
  const payFor = row => onPay?.({
    cardId: row.match.card.id,
    category: row.match.category,
    benefitName: row.match.benefitName,
    pdfScenario: row.match.pdfScenario,
    ai: Boolean(row.match.ai),   // AI 판단으로 붙은 카드면 결제 화면도 AI 를 따른다 (scheduleAiPaymentExample)
    title: row.label,
    date: row.inProgress ? day : row.date || day,
    time: row.inProgress ? clockTime : row.time,
  });
  if (home) {
    const ready = !disabled && !loading && !error;
    // 표시줄은 그날 0~24시: 그날의 시간 있는 일정을 모두 그린다 (진행 중 먼저, 그다음 시작 순)
    const dayStart = new Date(day + 'T00:00:00');
    const dayEnd = dayStart.getTime() + dayMs;
    const dayRows = ready ? timeline.filter(row => row.startDate && row.startDate < dayEnd && row.endDate > dayStart)
      .sort((a, b) => a.startDate - b.startDate) : [];
    const defaultSchedule = dayRows.find(row => row.key === current?.key);
    // 홈에서는 하루 일정을 모두 24시간 바 위 블록으로 보인다 (2026-11-24: 일정 카드 목록 대신)
    const chosenSchedule = selection?.scope === day ? dayRows.find(row => row.key === selection.key) : null;
    const selectedSchedule = chosenSchedule ?? defaultSchedule;
    const recommended = selectedSchedule?.match ? selectedSchedule : null;
    // 동그라미를 옮겼으면 큰 카드만 그 시각의 AI 1순위 카드로 바뀐다 ('내 카드' 목록은 그대로, 결제는 지금에서만)
    const nowMinute = minuteOfDay(clock);
    const scrubbing = viewMinute != null;
    const dots = paymentDots(todayPayments, nowMinute);
    // 그 시각의 큰 카드: 그 시각을 덮는 일정이 있으면 '오늘의 일정'에 보이는 그 일정 카드(서버 모드는 업종별 AI 계산),
    // 일정이 없는 시각은 서버 모드면 AI 하루 배치 구간 카드, 데모 모드면 결제 카드.
    // 미리보기와 노란 점(카드가 바뀌는 시각)이 같은 계산을 쓴다 → 일정 목록 카드와 노란 점이 어긋나지 않는다
    const cardAtMinute = minute => {
      const at = new Date(dayStart.getTime() + minute * 60 * 1000);
      const row = timeline.find(item => item.match && item.startDate && item.startDate <= at && at < item.endDate);
      if (row) return { card: row.match.card, note: row.match.label };
      if (SERVER_MODE) return scrubbedCard({ segments: daySegments || [], minute, walletCards: cards, fallbackCard: selectedCard });
      return { card: selectedCard, note: '' };
    };
    let scrubbed = null;
    if (scrubbing) {
      scrubbed = SERVER_MODE && daySegments == null
        ? { card: selectedCard, note: '이 시각 AI 카드를 불러오는 중이에요' }
        : cardAtMinute(viewMinute);
    }
    const minuteOf = date => Math.round((date - dayStart) / 60000);
    const changeBoundaries = [
      ...timeline.filter(row => row.match && row.startDate && row.endDate).flatMap(row => [minuteOf(row.startDate), minuteOf(row.endDate)]),
      ...(SERVER_MODE ? (daySegments || []).flatMap(segment => [segment.startMin, segment.endMin]) : []),
    ];
    const changeDots = disabled || (SERVER_MODE && daySegments == null) ? []
      : cardChangeDots(changeBoundaries, minute => cardAtMinute(minute).card?.id ?? null);
    // 하루를 카드가 바뀌는 시각으로 나눠, 가장 오래 쓰는 카드(평소 카드)와 다른 카드를 쓰는 구간만 캡슐로 보인다
    const cardSpans = (() => {
      if (!changeDots.length) return [];
      const edges = [0, ...changeDots.map(dot => dot.minute), MAX_MINUTE + STEP_MINUTES];
      const parts = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], id: cardAtMinute(from).card?.id ?? null }));
      const total = {};
      parts.forEach(part => { total[part.id] = (total[part.id] || 0) + part.to - part.from; });
      const usual = Object.keys(total).sort((a, b) => total[b] - total[a])[0];
      return parts.filter(part => String(part.id) !== usual).map(part => ({
        key: 'span-' + part.from, minute: part.from, ratio: minuteToRatio(part.from),
        startRatio: minuteToRatio(part.from), endRatio: minuteToRatio(Math.min(part.to, MAX_MINUTE + STEP_MINUTES)),
      }));
    })();
    const nowAi = SERVER_MODE && daySegments ? scrubbedCard({ segments: daySegments, minute: nowMinute, walletCards: cards, fallbackCard: null }) : null;
    const cardReason = nowAi?.card && nowAi.card.id === (recommended?.match.card || selectedCard)?.id && nowAi.note
      ? nowAi.note.replace(/!$/, '')
      : '이 일정에 맞는 혜택 카드가 없어 결제 카드를 보여드려요';
    const scrubPayment = scrubbing ? paymentAt(dots.map(dot => dot.payment), viewMinute) : null;
    const card = scrubbing ? scrubbed.card : recommended?.match.card || selectedCard;
    const reasonText = (shown, note) => {
      if (!shown) return '카드를 등록하면 이 일정에 맞는 혜택을 확인할 수 있어요';
      const why = (note || '').replace(/!$/, '');
      if (!why) return shown.name;
      return why.includes(shown.name) ? why : `${shown.name} · ${why}`;
    };
    let reasonLine = null;
    if (scrubbing) {
      const covering = dayRows.filter(row => minuteOf(row.startDate) <= viewMinute && viewMinute < minuteOf(row.endDate));
      const ended = covering.length ? [] : dayRows.filter(row => minuteOf(row.endDate) === viewMinute);
      const first = covering[0];
      reasonLine = {
        icon: first ? first.icon : ended.length ? 'flag-outline' : 'time-outline',
        head: first ? `${scheduleLabel(first.label)} ${first.timeCaption}${covering.length > 1 ? ` 외 ${covering.length - 1}개` : ''}`
          : ended.length ? `${ended.map(row => scheduleLabel(row.label)).join(', ')} 끝 ${timeLabel(viewMinute)}`
            : `${timeLabel(viewMinute)} 일정 없음`,
        text: reasonText(scrubbed.card, scrubbed.note),
      };
    } else if (selectedSchedule) {
      reasonLine = {
        icon: selectedSchedule.icon,
        head: `${scheduleLabel(selectedSchedule.label)} ${selectedSchedule.timeCaption}`,
        text: recommended ? reasonText(recommended.match.card, recommended.match.label) : card ? cardReason : reasonText(null),
      };
    }
    // 미리보기 카드 그림: 결제 카드와 같은 방식(resolveWalletProduct), 글자 주소면 { uri } 로
    const scrubImage = scrubbing ? resolveWalletProduct(scrubbed.card)?.image || scrubbed.card?.image : null;
    const artwork = scrubbing ? (typeof scrubImage === 'string' ? { uri: scrubImage } : scrubImage)
      : recommended?.match.card.image || selectedProduct?.image;
    const canPay = !scrubbing && Boolean(recommended || canPayWithSelected);
    const next = ready && (current || timeline.find(row => row.time >= clockTime) || timeline.find(row => !row.time));
    const cardAction = card ? '다른 카드로 변경' : '카드 등록';
    return <View style={styles.home}>
      <View style={styles.homeHeadRow}>
        <Text accessibilityRole="header" style={styles.headline}>내 지갑</Text>
        {headerRight}
      </View>
      <View style={[styles.homeCard, styles.homeCardScheduled]}>
        <HomeScheduleRibbon start={dayStart} clockTime={clockTime} nowMinute={nowMinute} viewMinute={viewMinute}
          onScrub={setViewMinute} onNow={() => setViewMinute(null)} dots={dots} changeDots={changeDots} cardSpans={cardSpans}
          rows={dayRows} selected={selectedSchedule}
          onSelect={row => { setViewMinute(null); setSelection({ scope: day, key: row.key }); }}
          emptyMessage={error || (loading && !disabled ? '일정을 불러오는 중이에요' : '오늘 등록된 일정이 없어요')} />
        {/* 일정 한 줄: 일정 이름·시간 · 카드와 그 카드를 쓰는 까닭 (지금·미리보기 모두 같은 모양) */}
        {reasonLine && <View accessibilityLiveRegion="polite" style={[styles.homeReason, scrubbing && styles.homeReasonPreview]}>
          <Ionicons name={reasonLine.icon} size={16} color={scrubbing ? '#5B3FC4' : '#1D55D9'} />
          <Text numberOfLines={2} style={styles.homeReasonText}>
            <Text style={styles.homeReasonSchedule}>{reasonLine.head}</Text>
            {' · '}{reasonLine.text}
          </Text>
        </View>}
        {artwork && <View style={styles.homeCardStage}>
          <View pointerEvents="none" style={styles.homeCardHalo} />
          <Image source={artwork} resizeMode="contain" fadeDuration={0}
            style={[styles.homeArtwork, styles.homeScheduledArtwork]}
            accessibilityLabel={card.name + ' 상품 이미지'} />
        </View>}
        <Text style={[styles.homeCardName, card && styles.homeCardCaption]}>{card?.name || '등록된 카드가 없습니다'}</Text>
        {scrubPayment && <Text style={styles.homeScrubPayment} numberOfLines={1}>{paymentLine(scrubPayment)}</Text>}
      </View>
      {card && <TouchableOpacity accessibilityRole="button" accessibilityLabel="이 카드로 결제"
        accessibilityState={{ disabled: !canPay }}
        disabled={!canPay} style={[styles.primary, !canPay && styles.homePayDisabled]}
        onPress={() => recommended?.inProgress ? payFor(recommended) : onPay?.({ cardId: card.id })}>
        <Ionicons name="qr-code-outline" size={19} color="#FFFFFF" />
        <Text style={styles.white}>이 카드로 결제</Text>
      </TouchableOpacity>}
      {card && scrubbing && <Text style={styles.homePayHint}>미리보기 중에는 결제할 수 없어요</Text>}
      {/* 카드가 있으면 '다른 카드로 변경' 대신 내 카드 목록(누르면 결제 카드 변경, ☰로 순서 변경) */}
      {card && cardList ? cardList : <TouchableOpacity accessibilityRole="button" accessibilityLabel={cardAction}
        style={card ? styles.homeChangeCard : styles.primary} onPress={onOpenCards}>
        {card && <Ionicons name="swap-horizontal-outline" size={19} color="#245DE5" accessible={false} />}
        <Text style={card ? styles.blue : styles.white}>{cardAction}</Text>
      </TouchableOpacity>}
      {paymentsList}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="오늘의 일정 열기" style={styles.homeSchedule} onPress={onOpenSchedule}>
        <Ionicons name="calendar-outline" size={21} color="#1854D8" />
        <Text style={styles.title}>오늘의 일정</Text>
        <Text style={styles.homeScheduleText} numberOfLines={1}>
          {next ? [next.time, next.label].filter(Boolean).join(' ') : ready && !timeline.length ? '등록된 일정 없음' : '일정 보기'}
        </Text>
        <Ionicons name="chevron-forward" size={17} color="#62738D" />
      </TouchableOpacity>
    </View>;
  }
  // 들어왔을 때는 모든 일정을 접어 둔다. 일정을 눌러야 카드 추천이 펼쳐진다 (2026-11-24 사용자 요청)
  const activeKey = selection?.scope === day ? selection.key : null;
  return <View style={styles.panel}>
    <View style={styles.hero}>
      <View style={{flex:1}}>
        <Text accessibilityRole="header" style={styles.headline}>
          오늘의 일정
        </Text>
        <View style={styles.dateChip}>
          <Ionicons name="calendar-outline" size={17} color="#2152AF"/>
          <Text style={styles.blue}>{dateCaption}</Text>
        </View>
      </View>
      <View style={styles.heroIcon}><Ionicons name="calendar-outline" size={35} color="#1854D8"/></View>
    </View>
    {disabled ? <Text style={styles.hint}>개발자 미리보기</Text>
      : loading ? <Text style={styles.hint}>일정을 불러오는 중이에요.</Text>
        : !!error ? <Text style={styles.hint}>{error}</Text>
          : sample ? <View style={styles.empty}>
            <Text style={styles.blue}>예시 일정 · 저장되지 않아요</Text>
            <View style={styles.sampleChoices}>
              {SCHEDULE_SAMPLES.map(item => <TouchableOpacity key={item.id} accessibilityRole="button"
                accessibilityState={{ selected: item.id === sample.id }}
                style={[styles.sampleChoice, item.id === sample.id && styles.sampleSelected]}
                onPress={() => onStartSample?.(item.id)}>
                <Text style={styles.blue}>{item.caption}</Text>
              </TouchableOpacity>)}
            </View>
            <View style={styles.timelineButton}>
              <View style={styles.entryIcon}><Ionicons name={categoryIcons[sample.category]} size={21} color="#2059C7" /></View>
              <Text style={styles.title}>{sample.start}~{sample.end} {sample.title}</Text>
            </View>
            <View style={styles.recommendation}>
              <Text style={styles.blue}>추천 카드</Text>
              <View style={styles.cardPreview}>
                <Image source={sampleCard.image} resizeMode="contain" fadeDuration={0} style={styles.productImage} accessibilityLabel={sampleCard.name + ' 상품 이미지'} />
                <View style={styles.entryText}>
                  <Text style={styles.title}>{sampleCard.name}</Text>
                  {!!sampleMatch && <Text style={styles.offer}>{sampleMatch.label}</Text>}
                </View>
              </View>
            </View>
            <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={onEndSample}>
              <Text style={styles.blue}>예시 닫기</Text>
            </TouchableOpacity>
          </View> : timeline.length === 0 ? <View style={styles.empty}>
            <Text style={styles.title}>등록된 일정이 없어요</Text>
            {onStartSample && <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => onStartSample(SCHEDULE_SAMPLES[0].id)}>
              <Text style={styles.white}>예시 일정 확인</Text>
            </TouchableOpacity>}
          </View> : <View style={styles.timeline}>
            {timeline.map(row => {
              const expanded = activeKey === row.key;
              const match = row.match;
              const rowContent = <>
                <View style={styles.entryIcon}><Ionicons name={row.icon} size={21} color="#2059C7"/></View>
                <View style={styles.entryText}>
                  <Text style={styles.title}>{row.time ? (row.timeCaption || row.time) + '  ' : ''}{row.label}</Text>
                  <Text numberOfLines={expanded ? undefined : 2} style={styles.hint}>{expanded || managing ? row.description : match?.label || row.description}</Text>
                </View>
              </>;
              return <View key={row.key} style={styles.timelineRow}>
                <View style={[styles.marker, expanded && styles.markerActive]}/>
                {managing ? <>
                  <View style={styles.timelineButton}>
                    {rowContent}
                    {!!row.event && <View style={styles.rowActions}>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={row.label + ' 수정'} disabled={deleting}
                        style={styles.rowEdit} onPress={() => {
                          setConfirmDelete(null);
                          setDeleteError('');
                          setEditingEvent(row.event);
                          setOpen('edit');
                        }}>
                        <Text style={styles.blue}>수정</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={row.label + ' 삭제'} disabled={deleting}
                        style={styles.rowDelete} onPress={() => { setDeleteError(''); setConfirmDelete(row.event.id); }}>
                        <Text style={styles.deleteText}>삭제</Text>
                      </TouchableOpacity>
                    </View>}
                  </View>
                  {row.event && confirmDelete === row.event.id && <View style={styles.deleteConfirm}>
                    <Text style={styles.hint}>이 일정을 삭제할까요?</Text>
                    {!!deleteError && <Text accessibilityRole="alert" style={styles.deleteText}>{deleteError}</Text>}
                    <View style={styles.rowActions}>
                      <TouchableOpacity accessibilityRole="button" disabled={deleting} style={styles.rowEdit} onPress={() => setConfirmDelete(null)}>
                        <Text style={styles.blue}>취소</Text>
                      </TouchableOpacity>
                      <TouchableOpacity accessibilityRole="button" disabled={deleting} style={styles.rowDelete} onPress={() => remove(row.event)}>
                        <Text style={styles.deleteText}>{deleting ? '삭제 중…' : '일정 삭제'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>}
                </> : <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={styles.timelineButton}
                  onPress={() => setSelection({ scope: day, key: expanded ? null : row.key })}
                >
                  {rowContent}
                  {/* 접혀 있을 때 카드 그림: 업종 추천 카드가 없으면 펼쳤을 때 보이는 '지금 갖고 있는 카드'와 같은 그림 */}
                  {!expanded && (match ? match.card.image : selectedCard && selectedProduct?.image) &&
                    <Image source={match ? match.card.image : selectedProduct.image} resizeMode="contain" style={styles.thumbnail} accessibilityIgnoresInvertColors accessible={false}/>}
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={expanded ? '#1858E8' : '#62738D'}/>
                </TouchableOpacity>}
                {expanded && (match ? <View style={styles.recommendation}>
                  <Text style={styles.blue}>보유 카드 추천</Text>
                  <View style={styles.cardPreview}>
                    <Image source={match.card.image} resizeMode="contain" style={styles.productImage} accessibilityIgnoresInvertColors accessibilityLabel={match.card.name + ' 실제 카드 이미지'}/>
                    <View style={styles.entryText}>
                      <Text style={styles.title}>{match.card.name}</Text>
                      <Text style={styles.offer}>{match.label}</Text>
                    </View>
                  </View>
                  {onPay && <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={() => payFor(row)}>
                    <Text style={styles.white}>이 카드로 결제</Text>
                    <Ionicons name="chevron-forward" size={17} color="#FFFFFF"/>
                  </TouchableOpacity>}
                </View> : selectedCard && <View style={styles.recommendation}>
                  <Text style={styles.blue}>지금 갖고 있는 카드가 적합합니다.</Text>
                  <View style={styles.cardPreview}>
                    {!!selectedProduct?.image && <Image source={selectedProduct.image} resizeMode="contain" fadeDuration={0} style={styles.productImage} />}
                    <Text style={[styles.title, styles.entryText]}>{selectedCard.name}</Text>
                  </View>
                  {onPay && canPayWithSelected && <TouchableOpacity accessibilityRole="button" style={styles.primary}
                    onPress={() => onPay({ cardId: selectedCard.id })}>
                    <Text style={styles.white}>이 카드로 결제</Text>
                  </TouchableOpacity>}
                </View>)}
              </View>;
            })}
          </View>}
    {confirmed && <Text style={styles.hint}>오늘 일정 확인 완료</Text>}
    <View style={styles.row}>
      <TouchableOpacity accessibilityRole="button" disabled={disabled || deleting} style={[styles.secondary, styles.equalAction]} onPress={() => {
        setManaging(value => !value);
        setConfirmDelete(null);
        setDeleteError('');
      }}>
        <Text numberOfLines={1} style={styles.blue}>{managing ? '수정 끝내기' : '일정 관리'}</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="일정 추가" disabled={disabled}
        style={[styles.primary, styles.equalAction]} onPress={() => setOpen('add')}>
        <Ionicons name="add" size={18} color="#FFFFFF"/>
        <Text numberOfLines={1} style={styles.white}>일정 추가</Text>
      </TouchableOpacity>
    </View>

    <TouchableOpacity accessibilityRole="button" disabled={disabled || loading || Boolean(error)} style={styles.benefits} onPress={onViewBenefits}>
      <Ionicons name="search-outline" size={22} color="#136975"/>
      <View style={{flex:1}}>
        <Text style={styles.title}>내 일정에 맞는 혜택 찾기</Text>
        {!!signals.length && <Text style={styles.hint}>{signals.slice(0,4).join(' · ')}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color="#365D77"/>
    </TouchableOpacity>
    {!!error && <TouchableOpacity disabled={disabled} onPress={refresh}><Text style={styles.blue}>다시 불러오기</Text></TouchableOpacity>}
    <SpecialScheduleModal key={day} visible={!!open && !disabled} mode={open || 'add'}
      editingEvent={open === 'edit' ? editingEvent : null} onClose={() => setOpen(null)}
      onChanged={refresh} onEditTimed={onEditRoutine} />
    </View>;
}
const styles = StyleSheet.create({
  home:{gap:14},
  homeCard:{alignItems:'center',gap:8,padding:20,borderRadius:22,backgroundColor:'#F1F6FE'},
  homeCardScheduled:{padding:12,gap:10,borderRadius:28,borderWidth:1,borderColor:'#DDE9FF',backgroundColor:'#F5F8FF'},
  homeRibbon:{
    width:'100%',paddingTop:10,paddingBottom:8,borderRadius:19,borderWidth:1,
    borderColor:'#E8EFFF',backgroundColor:'#FFFFFF'
  },
  homeAxis:{position:'relative',height:92,marginHorizontal:20},
  // 두꺼운 24시간 바와 일정 블록 (2026-11-24 '24시간 바에 일정' 디자인)
  homeSection:{position:'absolute',top:51,height:8,borderRightWidth:2,borderRightColor:'#FFFFFF'},
  homeChangeDot:{
    position:'absolute',top:49,width:12,height:12,marginLeft:-6,borderRadius:6,borderWidth:3,backgroundColor:'#FFFFFF',zIndex:1
  },
  homeSectionFirst:{borderTopLeftRadius:4,borderBottomLeftRadius:4},
  homeSectionLast:{borderTopRightRadius:4,borderBottomRightRadius:4,borderRightWidth:0},
  // 지금 표시: 바 바로 위 ▼ (2026-11-24, 긴 세로선 대신)
  homeNowArrow:{
    position:'absolute',top:41,width:0,height:0,marginLeft:-7,zIndex:2,
    borderLeftWidth:7,borderRightWidth:7,borderTopWidth:9,
    borderLeftColor:'transparent',borderRightColor:'transparent',borderTopColor:'#1D55D9'
  },
  homeNowArrowPreview:{borderTopColor:'#5B3FC4'},
  homeReason:{
    flexDirection:'row',alignItems:'center',gap:8,alignSelf:'stretch',paddingHorizontal:12,paddingVertical:10,
    borderRadius:14,backgroundColor:'#EEF4FF'
  },
  homeReasonPreview:{backgroundColor:'#F1EDFF'},
  homeReasonText:{flex:1,fontSize:13,lineHeight:19,fontWeight:'600',color:'#3A4B66'},
  homeReasonSchedule:{fontWeight:'800',color:'#13254A'},
  homeEmptyCaption:{marginTop:5,paddingHorizontal:10,fontSize:12,lineHeight:17,textAlign:'center',color:'#526783'},
  homeTick:{position:'absolute',top:26,width:46,marginLeft:-23,alignItems:'center',gap:4},
  homeTickLabel:{fontSize:11,lineHeight:15,color:'#4B6284',fontWeight:'700',fontVariant:['tabular-nums']},
  homeNow:{
    position:'absolute',top:0,width:92,marginLeft:0,minHeight:24,justifyContent:'center',alignItems:'center',
    borderRadius:12,backgroundColor:'#1D55D9'
  },
  homeNowText:{fontSize:11,fontWeight:'800',color:'#FFFFFF',fontVariant:['tabular-nums']},
  homeNowPreview:{backgroundColor:'#5B3FC4'},
  homeNowButton:{
    position:'absolute',top:6,right:8,zIndex:10,flexDirection:'row',alignItems:'center',gap:3,height:26,
    paddingHorizontal:9,borderRadius:13,borderWidth:1,borderColor:'#BFD3FA',backgroundColor:'#FFFFFF'
  },
  homeNowButtonText:{fontSize:12,fontWeight:'800',color:'#1D55D9'},
  homeAxisTouch:{position:'absolute',left:-12,right:-12,top:0,bottom:-6,zIndex:3,cursor:'pointer'},
  homePayDot:{
    position:'absolute',top:83,width:8,height:8,marginLeft:-4,borderRadius:4,borderWidth:1.5,
    borderColor:'#FFFFFF',backgroundColor:'#FF8A3D'
  },
  homeScrubPayment:{color:'#B4560F',fontSize:12,lineHeight:17,textAlign:'center',paddingHorizontal:8,fontWeight:'700'},
  homePayHint:{color:'#526783',fontSize:12,lineHeight:17,textAlign:'center',marginTop:-6},
  homeCardStage:{
    width:'100%',alignItems:'center',justifyContent:'center',overflow:'hidden',padding:14,
    borderRadius:20,backgroundColor:'#EBF2FF'
  },
  homeCardHalo:{
    position:'absolute',width:'76%',maxWidth:400,height:'125%',borderRadius:999,backgroundColor:'#DEEAFF',
    borderWidth:8,borderColor:'#E5EFFF'
  },
  homeArtwork:{width:'100%',maxWidth:360,aspectRatio:1.52,maxHeight:224},
  homeScheduledArtwork:{maxHeight:178},
  homePayDisabled:{opacity:0.55},
  homeCardName:{fontSize:18,fontWeight:'800',color:'#142D4E',textAlign:'center'},
  homeCardCaption:{fontSize:16,lineHeight:22,marginTop:2,marginBottom:2,paddingHorizontal:6},
  homeChangeCard:{
    minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,
    borderRadius:16,borderWidth:1,borderColor:'#DCE7FB',backgroundColor:'#F2F6FF'
  },
  homeSchedule:{flexDirection:'row',alignItems:'center',gap:8,minHeight:56,padding:10},
  homeScheduleText:{flex:1,minWidth:0,color:'#526783',fontSize:13,textAlign:'right'},
  sampleChoices:{flexDirection:'row',flexWrap:'wrap',justifyContent:'center',gap:6},
  sampleChoice:{minHeight:44,justifyContent:'center',paddingHorizontal:10,borderRadius:14},
  sampleSelected:{backgroundColor:'#E2EDFF'},
  hero:{flexDirection:'row',alignItems:'center',gap:14,marginBottom:9},
  headline:{fontSize:33,lineHeight:41,letterSpacing:-1.2,fontWeight:'800',color:'#13213E'},
  homeHeadRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  dateChip:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#EDF4FF',borderRadius:13,paddingVertical:8,paddingHorizontal:10,marginTop:10},
  heroIcon:{width:66,height:66,borderRadius:23,alignItems:'center',justifyContent:'center',backgroundColor:'#E5F5FA'},
  empty:{padding:18,borderRadius:18,backgroundColor:'#F1F6FE',gap:5},
  timeline:{marginLeft:7,borderLeftWidth:2,borderLeftColor:'#D6E3F7',gap:10},
  timelineRow:{position:'relative',paddingLeft:16,gap:9},
  timelineButton:{minHeight:60,flexDirection:'row',alignItems:'center',gap:10},
  rowActions:{flexDirection:'row',gap:5,flexShrink:0},
  rowEdit:{minHeight:44,paddingHorizontal:9,justifyContent:'center',borderRadius:10,backgroundColor:'#EDF3FF'},
  rowDelete:{minHeight:44,paddingHorizontal:9,justifyContent:'center',borderRadius:10,backgroundColor:'#FFF0F2'},
  deleteText:{color:'#A83148',fontSize:13,fontWeight:'700'},
  deleteConfirm:{gap:6,padding:10,borderRadius:12,backgroundColor:'#FFF7F8'},
  entryText:{flex:1,minWidth:0,gap:3},
  marker:{position:'absolute',left:-7,top:24,width:12,height:12,borderRadius:6,borderWidth:2,borderColor:'#AFC3E5',backgroundColor:'#FFFFFF'},
  markerActive:{borderColor:'#1858E8'},
  entryIcon:{width:41,height:41,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:'#EDF4FF'},
  thumbnail:{width:42,height:30},
  recommendation:{borderRadius:18,backgroundColor:'#EDF4FF',padding:13,gap:9},
  cardPreview:{flexDirection:'row',alignItems:'center',gap:12},
  productImage:{width:92,height:60},
  offer:{fontSize:13,lineHeight:19,fontWeight:'700',color:'#174BC5'},
  benefits:{minHeight:62,borderRadius:17,backgroundColor:'#E6F4F5',padding:13,flexDirection:'row',alignItems:'center',gap:11},
  panel: {
    padding: 14,
    backgroundColor: "#FFFFFF",
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E3EAF4",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 0,
    paddingVertical: 6
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 24
  },
  summary: {
    fontSize: 13,
    color: "#5A6E89",
    lineHeight: 22
  },
  hint: {
    fontSize: 13,
    color: "#5A6E89",
    lineHeight: 22
  },
  row: {
    flexDirection: 'row',
    gap: 8
  },
  equalAction: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 46,
    paddingVertical: 0,
  },
  secondary: {
    flexGrow: 1,
    backgroundColor: "#EDF3FF",
    padding: 12,
    borderRadius: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  primary: {
    flexGrow: 1,
    flexDirection: 'row',
    gap:5,
    backgroundColor: "#245DE5",
    padding: 12,
    borderRadius: 16,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  blue: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  }
});
