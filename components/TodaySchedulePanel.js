import React, { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import SpecialScheduleModal from './SpecialScheduleModal';
import { CATEGORIES, dateKey, eventLabel, isTodayConfirmed, makeSignals, readEvents, readProfile } from '../utils/routineData';
export default function TodaySchedulePanel({
  onEditRoutine,
  onViewBenefits,
  showPage = true, disabled = false
}) {
  const [day, setDay] = useState(dateKey);
  const [events, setEvents] = useState([]);
  const [profile, setProfile] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const prompted = useRef('');
  useEffect(() => {
    if (disabled) return;
    let active = true;
    let reading = false;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      const today = dateKey();
      try {
        const [saved, routine, checked] = await Promise.all([readEvents(), readProfile(), isTodayConfirmed(today)]);
        if (!active) return;
        setDay(today);
        setEvents(saved);
        setProfile(routine);
        setConfirmed(checked);
        setError('');
        if (!checked && prompted.current !== today) {
          prompted.current = today;
          setOpen(true);
        }
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
  const todayEvents = events.filter(event => event.date === day);
  const labels = [...new Set(todayEvents.flatMap(event => event.types))].map(eventLabel);
  const benefits = makeSignals(profile, events, day).map(signal => CATEGORIES[signal.id].label);
  const refresh = () => setRevision(value => value + 1);
  return <>{showPage && <ScrollView style={{flex:1}} contentContainerStyle={styles.panel}>
      <Text style={{color:"#315C9B",fontWeight:"700"}}>{day}</Text><Text style={[styles.title,{fontSize:30,lineHeight:40}]}>오늘의 일정</Text>

      <Text style={styles.summary}>
        {disabled ? '개발자 미리보기' : loading ? '일정 확인 중…' : error || (labels.length ? labels.join(' · ') : '등록된 특별 일정 없음 · 평소 일과 기준')}
      </Text>

      {!disabled && !loading && !error && <Text style={styles.hint}>
          {confirmed ? '오늘 일정 확인 완료' : '오늘 일정을 확인해주세요'}
          {benefits.length ? `\n관련 혜택: ${benefits.join(' · ')}` : ''}
        </Text>}

      <View style={styles.row}>
        <TouchableOpacity disabled={disabled} style={styles.secondary} onPress={onEditRoutine}>
          <Text style={styles.blue}>평소 일과 수정</Text>
        </TouchableOpacity>

        <TouchableOpacity disabled={disabled} style={styles.primary} onPress={() => setOpen(true)}>
          <Text style={styles.white}>일정 확인·변경</Text>
        </TouchableOpacity>

        <TouchableOpacity disabled={disabled || loading || Boolean(error)} style={styles.secondary} onPress={onViewBenefits}>
          <Text style={styles.blue}>혜택 보기</Text>
        </TouchableOpacity>
      </View>

      {!!error && <TouchableOpacity disabled={disabled} onPress={refresh}>
          <Text style={styles.blue}>다시 불러오기</Text>
        </TouchableOpacity>}

      </ScrollView>}<SpecialScheduleModal key={day} visible={open && !disabled} onClose={() => setOpen(false)} onChanged={refresh} onConfirmed={() => {
      setConfirmed(true);
      refresh();
    }} />
    </>;
}
const styles = StyleSheet.create({
  panel: {
    padding: 14,
    backgroundColor: "#FFFFFF",
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#E3EAF4",
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 22,
    paddingVertical: 16
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
    backgroundColor: "#EDF3FF",
    padding: 12,
    borderRadius: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center"
  },
  primary: {
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
