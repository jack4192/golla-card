import React, { useEffect, useState } from 'react';
import { AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { findCatalog40Product } from '../data/cardCatalog40';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { evaluatePdfCard, PAYMENT_SCENARIOS } from '../data/paymentBenefits';
import { benefitText } from '../utils/cardRecommendation';
import { DAYS, routineLabel } from '../utils/routineDetails';
import { isScheduleBenefitAt, matchesScheduleBenefit } from '../utils/schedulePayment';
import { SAMPLE_PAYMENT_CARDS } from '../data/samplePayment';
import SpecialScheduleModal from './SpecialScheduleModal';
import { CATEGORIES, dailyBasicSchedule, dateKey, effectiveDetailedRoutine, eventBenefitCategories, eventEndDate, eventTimeCaption, eventTitle, isTodayConfirmed, makeSignals, readEvents, readProfile, shiftDate } from '../utils/routineData';

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
  sampleActive = false,
  onStartSample,
  onEndSample,
  cards = [],
  home = false,
  disabled = false
}) {
  const [day, setDay] = useState(dateKey);
  const [clock, setClock] = useState(() => new Date());
  const [events, setEvents] = useState([]);
  const [profile, setProfile] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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
  const signals = makeSignals(profile, events, day).map(signal => CATEGORIES[signal.id].label);
  const refresh = () => setRevision(value => value + 1);
  const products = cards.map(card => ({
    card,
    catalog: findCatalog40Product(card),
    legacy: CSV_CARD_CATALOG.find(product => product.code === card.catalogCode),
  }));
  const timeline = [
    ...dailyBasicSchedule(profile, day).map(({ label, category, start, end }) => {
      const time = hourLabel(start);
      const inProgress = isCurrentDay && currentHour >= start && currentHour < end;
      const matchTime = inProgress ? clock : new Date(`${day}T${time}:00`);
      return {
        key: `basic:${label}:${start}`,
        icon: categoryIcons[category] || 'restaurant-outline',
        label,
        time,
        timeCaption: `${time}~${hourLabel(end)}`,
        description: '평소 일과 · ' + (category ? CATEGORIES[category].label : '저장한 점심 시간'),
        inProgress,
        basic: true,
        match: category ? findScheduleCard([category], products, matchTime) : null,
      };
    }),
    ...routines.map(row => ({
      key:'routine:'+row.id, icon:categoryIcons[row.category] || 'time-outline', time:row.start,
      label:routineLabel(row),
      description:(row.nextDay?'다음 날 ':'')+row.end+'까지 · 평소 일과',
      match:findScheduleCard([row.category], products),
    })),
    ...todayEvents.map(event => {
      const categories = eventBenefitCategories(event);
      const timed = Boolean(event.start && event.end);
      const startDate = timed ? new Date(`${event.date}T${event.start}:00`) : null;
      const inProgress = timed && isCurrentDay && clock >= startDate && clock < eventEndDate(event);
      return {
        key:'special:'+event.id, icon:categoryIcons[categories[0]] || 'calendar-outline',
        label:eventTitle(event),
        date:event.date,
        time:event.start,
        timeCaption:eventTimeCaption(event),
        description:event.memo || (timed ? '특별 일정' : '특별 일정 · 시간 미지정'),
        inProgress,
        match:findScheduleCard(categories, products, inProgress ? clock : startDate),
      };
    }),
  ].sort((a, b) => (a.time || '24:00').localeCompare(b.time || '24:00'));
  const firstMatch = timeline.find(row => row.match);
  const currentMatch = timeline.find(row => row.date && row.inProgress && row.match)
    || timeline.find(row => row.inProgress && row.match);
  const scope = home ? `${day}:${currentMatch?.key || currentHour}` : day;
  const autoExpand = home ? currentMatch || timeline.find(row => !row.basic && row.match) : firstMatch;
  const activeKey = selection?.scope === scope ? selection.key : autoExpand?.key;
  return <View style={styles.panel}>
    <View style={styles.hero}>
      <View style={{flex:1}}>
        <Text accessibilityRole="header" style={styles.headline}>
          {home ? currentMatch ? '지금 일과에 맞는\n카드를 추천해요' : firstMatch ? '오늘 일정에 맞춰\n카드를 준비했어요' : '오늘의 일정과\n카드 혜택을 확인해요' : '오늘의 일정'}
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
          : sampleActive ? <View style={styles.empty}>
            <Text style={styles.blue}>예시 일정 · 저장되지 않아요</Text>
            <View style={styles.timelineButton}>
              <View style={styles.entryIcon}><Ionicons name="storefront-outline" size={21} color="#2059C7" /></View>
              <Text style={styles.title}>18:00 편의점</Text>
            </View>
            <View style={styles.recommendation}>
              <Text style={styles.blue}>체험용 추천 카드</Text>
              <View style={styles.cardPreview}>
                <Image source={SAMPLE_PAYMENT_CARDS[0].image} resizeMode="contain" style={styles.productImage} accessibilityLabel="BC 업턴 카드 상품 이미지" />
                <View style={styles.entryText}>
                  <Text style={styles.title}>{SAMPLE_PAYMENT_CARDS[0].name}</Text>
                  <Text style={styles.offer}>CU 10,000원 결제 예시</Text>
                </View>
              </View>
              <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={() => onPay?.({
                cardId: SAMPLE_PAYMENT_CARDS[0].id,
                category: 'convenience',
                title: '편의점 · 예시 일정',
                date: day,
                time: '18:00',
                sample: true,
              })}>
                <Text style={styles.white}>이 카드로 결제 체험</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={onEndSample}>
              <Text style={styles.blue}>체험 종료</Text>
            </TouchableOpacity>
          </View> : timeline.length === 0 ? <View style={styles.empty}>
            <Text style={styles.title}>등록된 일정이 없어요</Text>
            <Text style={styles.hint}>시간과 일과를 정해 특별 일정을 추가할 수 있어요.</Text>
            {onStartSample && <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={onStartSample}>
              <Text style={styles.white}>예시 일정 확인</Text>
            </TouchableOpacity>}
          </View> : <View style={styles.timeline}>
            {timeline.map(row => {
              const expanded = activeKey === row.key;
              const match = row.match;
              return <View key={row.key} style={styles.timelineRow}>
                <View style={[styles.marker, expanded && styles.markerActive]}/>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  style={styles.timelineButton}
                  onPress={() => setSelection({ scope, key: expanded ? null : row.key })}
                >
                  <View style={styles.entryIcon}><Ionicons name={row.icon} size={21} color="#2059C7"/></View>
                  <View style={styles.entryText}>
                    <Text style={styles.title}>{row.time ? (row.timeCaption || row.time) + '  ' : ''}{row.label}</Text>
                    <Text numberOfLines={expanded ? undefined : 2} style={styles.hint}>{expanded ? row.description : match?.label || row.description}</Text>
                  </View>
                  {!expanded && match && <Image source={match.card.image} resizeMode="contain" style={styles.thumbnail} accessibilityIgnoresInvertColors accessible={false}/>}
                  <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={expanded ? '#1858E8' : '#62738D'}/>
                </TouchableOpacity>
                {expanded && (match ? <View style={styles.recommendation}>
                  <Text style={styles.blue}>{home && row.inProgress ? '지금 쓸 보유 카드' : '보유 카드 추천'}</Text>
                  <View style={styles.cardPreview}>
                    <Image source={match.card.image} resizeMode="contain" style={styles.productImage} accessibilityIgnoresInvertColors accessibilityLabel={match.card.name + ' 실제 카드 이미지'}/>
                    <View style={styles.entryText}>
                      <Text style={styles.title}>{match.card.name}</Text>
                      <Text style={styles.offer}>{match.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.hint}>실제 적용 여부는 가맹점과 카드 이용 조건에 따라 달라져요.</Text>
                  {onPay && <TouchableOpacity accessibilityRole="button" style={styles.primary} onPress={() => onPay({
                    cardId: match.card.id,
                    category: match.category,
                    benefitName: match.benefitName,
                    pdfScenario: match.pdfScenario,
                    title: row.label,
                    date: row.inProgress ? day : row.date || day,
                    time: row.inProgress ? clock.toTimeString().slice(0, 5) : row.time,
                  })}>
                    <Text style={styles.white}>이 카드로 결제</Text>
                    <Ionicons name="chevron-forward" size={17} color="#FFFFFF"/>
                  </TouchableOpacity>}
                </View> : <View style={styles.recommendation}>
                  <Text style={styles.hint}>이 일정에 맞는 보유 카드 혜택을 확인하지 못했어요.</Text>
                </View>)}
              </View>;
            })}
          </View>}
    {confirmed && <Text style={styles.hint}>오늘 일정 확인 완료</Text>}
    <View style={styles.row}>
      <TouchableOpacity accessibilityRole="button" disabled={disabled} style={styles.secondary} onPress={() => onEditRoutine?.(day)}>
        <Text style={styles.blue}>시간대별 일정 설정</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={disabled} style={styles.primary} onPress={() => setOpen(true)}>
        <Ionicons name="add" size={18} color="#FFFFFF"/>
        <Text style={styles.white}>{!timeline.length && !sampleActive ? '내 일정 추가' : '특별 일정 등록·관리'}</Text>
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
      <SpecialScheduleModal key={day} visible={open && !disabled} onClose={() => setOpen(false)} onChanged={refresh} onEditTimed={onEditRoutine} onConfirmed={() => {
      setConfirmed(true);
      refresh();
    }} />
    </View>;
}
const styles = StyleSheet.create({
  hero:{flexDirection:'row',alignItems:'center',gap:14,marginBottom:9},
  headline:{fontSize:33,lineHeight:41,letterSpacing:-1.2,fontWeight:'800',color:'#13213E'},
  dateChip:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:7,backgroundColor:'#EDF4FF',borderRadius:13,paddingVertical:8,paddingHorizontal:10,marginTop:10},
  heroIcon:{width:66,height:66,borderRadius:23,alignItems:'center',justifyContent:'center',backgroundColor:'#E5F5FA'},
  empty:{padding:18,borderRadius:18,backgroundColor:'#F1F6FE',gap:5},
  timeline:{marginLeft:7,borderLeftWidth:2,borderLeftColor:'#D6E3F7',gap:10},
  timelineRow:{position:'relative',paddingLeft:16,gap:9},
  timelineButton:{minHeight:60,flexDirection:'row',alignItems:'center',gap:10},
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
    flexWrap: 'wrap',
    gap: 8
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
