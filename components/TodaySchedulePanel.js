import React, { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import SpecialScheduleModal from './SpecialScheduleModal';

import {
  CATEGORIES,
  dateKey,
  eventLabel,
  isTodayConfirmed,
  makeSignals,
  readEvents,
  readProfile,
} from '../utils/routineData';

export default function TodaySchedulePanel({
  onEditRoutine,
  onViewBenefits,
  disabled = false,
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
        const [saved, routine, checked] = await Promise.all([
          readEvents(),
          readProfile(),
          isTodayConfirmed(today),
        ]);

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

  const labels = [
    ...new Set(todayEvents.flatMap(event => event.types)),
  ].map(eventLabel);

  const benefits = makeSignals(profile, events, day)
    .map(signal => CATEGORIES[signal.id].label);

  const refresh = () => setRevision(value => value + 1);

  return (
    <View style={styles.panel}>
      <Text style={styles.title}>🗓️ {day} 오늘의 일정</Text>

      <Text style={styles.summary}>
        {disabled
          ? '개발자 미리보기'
          : loading
            ? '일정 확인 중…'
            : error ||
              (labels.length
                ? labels.join(' · ')
                : '등록된 특별 일정 없음 · 평소 일과 기준')}
      </Text>

      {!disabled && !loading && !error && (
        <Text style={styles.hint}>
          {confirmed ? '오늘 일정 확인 완료' : '오늘 일정을 확인해주세요'}
          {benefits.length
            ? `\n관련 혜택: ${benefits.join(' · ')}`
            : ''}
        </Text>
      )}

      <View style={styles.row}>
        <TouchableOpacity
          disabled={disabled}
          style={styles.secondary}
          onPress={onEditRoutine}
        >
          <Text style={styles.blue}>평소 일과 수정</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={disabled}
          style={styles.primary}
          onPress={() => setOpen(true)}
        >
          <Text style={styles.white}>일정 확인·변경</Text>
        </TouchableOpacity>

        <TouchableOpacity
          disabled={disabled || loading || Boolean(error)}
          style={styles.secondary}
          onPress={onViewBenefits}
        >
          <Text style={styles.blue}>혜택 보기</Text>
        </TouchableOpacity>
      </View>

      {!!error && (
        <TouchableOpacity disabled={disabled} onPress={refresh}>
          <Text style={styles.blue}>다시 불러오기</Text>
        </TouchableOpacity>
      )}

      <SpecialScheduleModal
        key={day}
        visible={open && !disabled}
        onClose={() => setOpen(false)}
        onChanged={refresh}
        onConfirmed={() => {
          setConfirmed(true);
          refresh();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 14,
    backgroundColor: '#EDF4FF',
    gap: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#DDE8FA',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#204580',
  },
  summary: {
    fontSize: 13,
    color: '#324F76',
    lineHeight: 20,
  },
  hint: {
    fontSize: 12,
    color: '#637DAB',
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  secondary: {
    backgroundColor: '#FFF',
    padding: 11,
    borderRadius: 10,
  },
  primary: {
    backgroundColor: '#245DE5',
    padding: 11,
    borderRadius: 10,
  },
  blue: {
    color: '#315C9D',
    fontSize: 12,
    fontWeight: '800',
  },
  white: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
});