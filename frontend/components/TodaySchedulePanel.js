import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
const hourTicks = [0, 1, 2, 3];
const chartPercent = ratio => `${ratio * 100}%`;
const scheduleLabel = label => label.replace(/^\p{Extended_Pictographic}\uFE0F?\s+/u, '');
const homeScheduleLimit = 3;

function HomeScheduleRibbon({ clock, clockTime, start, rows, selected, onSelect, onOpenSchedule, emptyMessage }) {
  const duration = 3 * hourMs;
  const position = time => Math.min(1, Math.max(0, (time - start) / duration));
  const cursor = position(clock);
  const hiddenCount = Math.max(0, rows.length - homeScheduleLimit);

  return <View style={styles.homeRibbon}>
    <View style={styles.homeAxis} accessible accessibilityLabel={`지금 ${clockTime}`}>
      <View style={styles.homeAxisLine} />
      {hourTicks.map(tick => {
        const hour = new Date(start.getTime() + tick * hourMs).getHours();
        return <View key={tick} style={[styles.homeTick, { left: chartPercent(tick / 3) }]}>
          <Text style={styles.homeTickLabel}>{hourLabel(hour)}</Text>
          <View style={styles.homeTickMark} />
        </View>;
      })}
      <View style={[styles.homeNow, { left: chartPercent(cursor) }]}>
        <Text style={styles.homeNowText}>지금 {clockTime}</Text>
      </View>
      <View style={[styles.homeNowDot, { left: chartPercent(cursor) }]} />
    </View>
    {rows.slice(0, homeScheduleLimit).map(row => {
      const left = position(row.startDate);
      const width = position(row.endDate) - left;
      const compact = width < 0.22;
      const isSelected = selected?.key === row.key;
      const label = scheduleLabel(row.label);
      const tone = row.inProgress || isSelected ? '#1755C9' : '#6853A0';
      const identity = <>
        <Ionicons name={row.icon} size={14} color={tone} />
        <Text style={[styles.homeEventText, { color: tone }]} numberOfLines={1}>
          {compact ? `${label} · ${row.timeCaption}` : label}
        </Text>
      </>;
      return <TouchableOpacity key={row.key} style={styles.homeEventRow} accessibilityRole="button"
        accessibilityLabel={`${row.inProgress ? '진행 중' : '예정'} ${label} ${row.timeCaption}`}
        aria-pressed={isSelected} accessibilityState={{ selected: isSelected }} onPress={() => onSelect(row)}>
        <View style={[styles.homeEventBand, !row.inProgress && styles.homeUpcomingBand,
          compact && styles.homeCompactBand, isSelected && styles.homeSelectedBand,
          { left: chartPercent(left), width: chartPercent(width) }]}>
          {!compact && identity}
        </View>
        {compact && <View style={[styles.homeEventCaption, isSelected && styles.homeSelectedCaption]}>{identity}</View>}
      </TouchableOpacity>;
    })}
    {hiddenCount > 0 && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`일정 ${hiddenCount}개 더 보기`}
      style={styles.homeMoreSchedules} onPress={onOpenSchedule}>
      <Text style={styles.blue}>+{hiddenCount}개</Text>
      <Ionicons name="chevron-forward" size={14} color="#245DE5" />
    </TouchableOpacity>}
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

export default function TodaySchedulePanel({
  onEditRoutine,
  onViewBenefits,
  onPay,
  onOpenCards,
  cardList = null,
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
  const [aiByCategory, setAiByCategory] = useState({});
  // 서버 모드: 일정 창(시작 30분 전 ~ 끝 30분 후) 안이면 AI 배치 미리보기(기록 없음)와 그 예시 거래의 계산
  //   { key: 창 열쇠, result: applyRank 결과, estimates: { [지갑 카드 id]: 예상 혜택 } } (2026-11-23 홈 일정 카드 설계서)
  const [aiPreview, setAiPreview] = useState({ key: '', result: null, estimates: null });
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
      const label = `${best.value.toLocaleString('ko-KR')}원 예상 혜택 · AI 계산`;
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
  const firstMatch = timeline.find(row => row.match);
  const currentMatch = timeline.find(row => row.date && row.inProgress && row.match)
    || timeline.find(row => row.inProgress && row.match);
  const current = currentMatch || timeline.find(row => row.inProgress);
  const clockTime = clock.toTimeString().slice(0, 5);
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
    const windowStart = new Date(clock);
    windowStart.setMinutes(0, 0, 0);
    const windowEnd = windowStart.getTime() + 3 * hourMs;
    const windowRows = ready ? timeline.filter(row => row.startDate && row.startDate < windowEnd && row.endDate > clock)
      .sort((a, b) => Number(b.inProgress) - Number(a.inProgress) || a.startDate - b.startDate) : [];
    const defaultSchedule = windowRows.find(row => row.key === current?.key);
    const rows = defaultSchedule
      ? [defaultSchedule, ...windowRows.filter(row => row.key !== defaultSchedule.key)]
      : windowRows;
    const chosenSchedule = selection?.scope === day
      ? rows.slice(0, homeScheduleLimit).find(row => row.key === selection.key)
      : null;
    const selectedSchedule = chosenSchedule ?? defaultSchedule;
    const recommended = selectedSchedule?.match ? selectedSchedule : null;
    const card = recommended?.match.card || selectedCard;
    const artwork = recommended?.match.card.image || selectedProduct?.image;
    const canPay = Boolean(recommended || canPayWithSelected);
    const next = ready && (current || timeline.find(row => row.time >= clockTime) || timeline.find(row => !row.time));
    const cardAction = card ? '다른 카드로 변경' : '카드 등록';
    return <View style={styles.home}>
      <Text accessibilityRole="header" style={styles.headline}>내 지갑</Text>
      <View style={[styles.homeCard, styles.homeCardScheduled]}>
        <HomeScheduleRibbon clock={clock} clockTime={clockTime} start={windowStart} rows={rows} selected={selectedSchedule}
          onSelect={row => setSelection({ scope: day, key: row.key })} onOpenSchedule={onOpenSchedule}
          emptyMessage={error || (loading && !disabled ? '일정을 불러오는 중이에요' : '이 시간대에 등록된 일정이 없어요')} />
        {recommended && <View style={styles.homeRecommendation}>
          <View style={styles.homeRecommendationIcon}>
            <Ionicons name="sparkles" size={16} color="#245DE5" />
          </View>
          <Text accessibilityRole="header" style={styles.homeRecommendationTitle}>
            {recommended.inProgress ? '지금 일정에 맞는 카드예요' : '다가오는 일정에 맞는 카드예요'}
          </Text>
        </View>}
        {selectedSchedule && !recommended && <Text style={styles.homeFallback}>
          {card ? '이 일정에는 평소 쓰시는 이 카드로 결제하는 걸 추천드려요.' : '카드를 등록하면 이 일정에 맞는 혜택을 확인할 수 있어요.'}
        </Text>}
        {artwork && <View style={styles.homeCardStage}>
          <View pointerEvents="none" style={styles.homeCardHalo} />
          <Image source={artwork} resizeMode="contain" fadeDuration={0}
            style={[styles.homeArtwork, styles.homeScheduledArtwork]}
            accessibilityLabel={card.name + ' 상품 이미지'} />
        </View>}
        <Text style={[styles.homeCardName, card && styles.homeCardCaption]}>{card?.name || '등록된 카드가 없습니다'}</Text>
        {recommended && <Text style={styles.homeBenefit} numberOfLines={2}>{recommended.match.label}</Text>}
      </View>
      {card && <TouchableOpacity accessibilityRole="button" accessibilityLabel="이 카드로 결제"
        accessibilityState={{ disabled: !canPay }}
        disabled={!canPay} style={[styles.primary, !canPay && styles.homePayDisabled]}
        onPress={() => recommended?.inProgress ? payFor(recommended) : onPay?.({ cardId: card.id })}>
        <Ionicons name="qr-code-outline" size={19} color="#FFFFFF" />
        <Text style={styles.white}>이 카드로 결제</Text>
      </TouchableOpacity>}
      {/* 카드가 있으면 '다른 카드로 변경' 대신 내 카드 목록(누르면 결제 카드 변경, ☰로 순서 변경) */}
      {card && cardList ? cardList : <TouchableOpacity accessibilityRole="button" accessibilityLabel={cardAction}
        style={card ? styles.homeChangeCard : styles.primary} onPress={onOpenCards}>
        {card && <Ionicons name="swap-horizontal-outline" size={19} color="#245DE5" accessible={false} />}
        <Text style={card ? styles.blue : styles.white}>{cardAction}</Text>
      </TouchableOpacity>}
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
  const activeKey = selection?.scope === day ? selection.key : firstMatch?.key;
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
                  {!expanded && match && <Image source={match.card.image} resizeMode="contain" style={styles.thumbnail} accessibilityIgnoresInvertColors accessible={false}/>}
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
      <Ionicons name="sparkles-outline" size={22} color="#136975"/>
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
  homeAxis:{position:'relative',height:59,marginHorizontal:25},
  homeEmptyCaption:{marginTop:5,paddingHorizontal:10,fontSize:12,lineHeight:17,textAlign:'center',color:'#526783'},
  homeAxisLine:{position:'absolute',left:0,right:0,top:52,height:2,borderRadius:2,backgroundColor:'#D4E3FF'},
  homeTick:{position:'absolute',top:31,width:46,marginLeft:-23,alignItems:'center',gap:4},
  homeTickLabel:{fontSize:11,lineHeight:15,color:'#4B6284',fontWeight:'700',fontVariant:['tabular-nums']},
  homeTickMark:{width:2,height:7,borderRadius:1,backgroundColor:'#AAC3F1'},
  homeNow:{
    position:'absolute',top:0,width:83,marginLeft:-17,minHeight:24,justifyContent:'center',alignItems:'center',
    borderRadius:12,backgroundColor:'#1D55D9'
  },
  homeNowText:{fontSize:11,fontWeight:'800',color:'#FFFFFF',fontVariant:['tabular-nums']},
  homeNowDot:{
    position:'absolute',top:46,width:14,height:14,marginLeft:-7,borderWidth:3,borderColor:'#FFFFFF',
    borderRadius:7,backgroundColor:'#245DE5',zIndex:1
  },
  homeEventRow:{position:'relative',height:44,marginHorizontal:25},
  homeEventBand:{
    position:'absolute',top:6,height:32,flexDirection:'row',alignItems:'center',justifyContent:'center',
    gap:4,paddingHorizontal:4,borderRadius:14,backgroundColor:'#DCEAFF',overflow:'hidden'
  },
  homeCompactBand:{top:34,height:6,paddingHorizontal:0},
  homeEventText:{flexShrink:1,color:'#153E92',fontSize:12,fontWeight:'800'},
  homeUpcomingBand:{backgroundColor:'#F0EBFF'},
  homeSelectedBand:{borderWidth:2,borderColor:'#245DE5',backgroundColor:'#DCEAFF'},
  homeEventCaption:{
    alignSelf:'center',maxWidth:'100%',flexDirection:'row',alignItems:'center',gap:4,paddingHorizontal:7,
    height:26,marginTop:2,borderRadius:13,borderWidth:1,borderColor:'transparent'
  },
  homeSelectedCaption:{borderColor:'#245DE5',backgroundColor:'#EDF4FF'},
  homeMoreSchedules:{alignSelf:'center',flexDirection:'row',alignItems:'center',gap:3,minHeight:44,paddingHorizontal:10},
  homeFallback:{color:'#526783',fontSize:12,lineHeight:17,textAlign:'center',paddingHorizontal:8},
  homeRecommendation:{alignSelf:'center',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7,paddingHorizontal:6},
  homeRecommendationIcon:{
    width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#E1EDFF'
  },
  homeRecommendationTitle:{flexShrink:1,fontSize:18,lineHeight:24,fontWeight:'800',color:'#142D4E'},
  homeBenefit:{
    paddingHorizontal:10,paddingVertical:5,borderRadius:12,backgroundColor:'#E6F5F0',
    color:'#165C50',fontSize:12,lineHeight:17,fontWeight:'700',textAlign:'center'
  },
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
