
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as SecureStore from '../utils/demoStore';

const STORAGE_KEY = 'solpay_routine_exceptions_v1';
const WEB_PREFIX = 'solpay_demo_';

const EVENT_OPTIONS = [
  { value: 'hospital', label: '🏥 병원 예약' },
  { value: 'half_day', label: '🕒 반차·조퇴' },
  { value: 'day_off', label: '🌿 휴무·휴강' },
  { value: 'unwell', label: '🤒 몸 상태가 좋지 않음' },
  { value: 'overtime', label: '💻 야근·추가 공부' },
  { value: 'appointment', label: '🤝 개인 약속' },
  { value: 'team_dinner', label: '🍽️ 회식·모임' },
  { value: 'travel', label: '🚆 외출·여행' },
  { value: 'other', label: '✏️ 기타' },
];

function todayText() {
  const now = new Date();

  return (
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0')
  );
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] =
    value.split('-').map(Number);

  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

async function readEvents() {
  if (Platform.OS === 'web') {
    return window.localStorage.getItem(
      WEB_PREFIX + STORAGE_KEY
    );
  }

  return SecureStore.getItemAsync(STORAGE_KEY);
}

async function writeEvents(events) {
  const raw = JSON.stringify(events);

  if (Platform.OS === 'web') {
    window.localStorage.setItem(
      WEB_PREFIX + STORAGE_KEY,
      raw
    );
    return;
  }

  await SecureStore.setItemAsync(
    STORAGE_KEY,
    raw
  );
}

function eventName(value) {
  const event = EVENT_OPTIONS.find(
    (item) => item.value === value
  );

  return event ? event.label : value;
}

export default function SpecialScheduleModal({
  visible,
  onClose,
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [events, setEvents] = useState([]);
  const [date, setDate] = useState(todayText());
  const [selected, setSelected] = useState([]);
  const [memo, setMemo] = useState('');
  const [message, setMessage] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] =
    useState(null);

  // 홈 화면에서 열릴 때 저장된 특별 일정 불러오기
  useEffect(() => {
    if (!visible) return;

    let active = true;

    const load = async () => {
      setLoading(true);
      setMessage('');
      setConfirmDeleteId(null);

      try {
        const raw = await readEvents();

        if (!active) return;

        const parsed = raw ? JSON.parse(raw) : [];

        setEvents(
          Array.isArray(parsed)
            ? parsed
            : []
        );
      } catch {
        if (active) {
          setEvents([]);
          setMessage(
            '이전 일정 기록을 불러오지 못했습니다.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [visible]);

  const toggleEvent = (value) => {
    setSelected((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );

    setMessage('');
  };

  const handleSave = async () => {
    if (saving || loading) return;

    if (selected.length === 0) {
      setMessage('특별 일정 종류를 선택해주세요.');
      return;
    }

    if (!isValidDate(date)) {
      setMessage(
        '날짜를 YYYY-MM-DD 형식으로 입력해주세요.'
      );
      return;
    }

    setSaving(true);
    setMessage('');

    try {
      const newEvent = {
        id:
          String(Date.now()) +
          '-' +
          Math.random().toString(36).slice(2, 8),
        date,
        types: selected,
        memo: memo.trim().slice(0, 80),
        createdAt: new Date().toISOString(),
      };

      // 기존에 작성한 기록을 유지하고 최근 20건 보관
      const next = [
        newEvent,
        ...events,
      ].slice(0, 20);

      await writeEvents(next);

      setEvents(next);
      setSelected([]);
      setMemo('');
      setDate(todayText());
      setConfirmDeleteId(null);

      setMessage('특별 일정이 저장됐습니다.');
    } catch (error) {
      setMessage(
        '일정을 저장하지 못했습니다. 다시 시도해주세요.'
      );
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (id) => {
    if (saving || loading) return;

    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setMessage('같은 삭제 버튼을 다시 누르면 삭제됩니다.');
      return;
    }

    setSaving(true);

    try {
      const next = events.filter(
        (item) => item.id !== id
      );

      await writeEvents(next);

      setEvents(next);
      setConfirmDeleteId(null);
      setMessage('선택한 일정 기록을 삭제했습니다.');
    } catch {
      setMessage('일정 삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    if (saving || loading) return;

    setSelected([]);
    setMemo('');
    setDate(todayText());
    setMessage('');
    setConfirmDeleteId(null);
    onClose?.();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}
          >
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>
                  SOL Pay · 일과 관리
                </Text>

                <Text style={styles.title}>
                  오늘은 평소와 다른 일정이 있나요?
                </Text>
              </View>

              <TouchableOpacity
                style={styles.xButton}
                onPress={close}
              >
                <Text style={styles.xText}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.description}>
              특별한 일정이 있는 날을 기록해주세요.
              선택한 일정은 이 기기에 저장됩니다.
            </Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                01. 어떤 일정인가요?
              </Text>

              <Text style={styles.hint}>
                여러 개 선택할 수 있습니다.
              </Text>

              <View style={styles.optionWrap}>
                {EVENT_OPTIONS.map((option) => {
                  const active = selected.includes(
                    option.value
                  );

                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.option,
                        active && styles.optionActive,
                      ]}
                      onPress={() =>
                        toggleEvent(option.value)
                      }
                    >
                      <Text
                        style={[
                          styles.optionText,
                          active && styles.optionTextActive,
                        ]}
                      >
                        {active ? '✓ ' : ''}
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                02. 언제 예정되어 있나요?
              </Text>

              <TextInput
                style={styles.input}
                placeholder="2026-11-14"
                value={date}
                onChangeText={setDate}
                maxLength={10}
                keyboardType="numbers-and-punctuation"
              />

              <TouchableOpacity
                style={styles.todayButton}
                onPress={() => setDate(todayText())}
              >
                <Text style={styles.todayText}>
                  오늘 날짜로 설정
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                03. 추가 메모 (선택)
              </Text>

              <TextInput
                style={styles.input}
                value={memo}
                onChangeText={setMemo}
                maxLength={80}
                placeholder="예: 퇴근 후 친구와 저녁 약속"
              />

              <Text style={styles.hint}>
                실제 병명이나 상세 의료정보 등
                민감한 정보는 입력하지 마세요.
              </Text>
            </View>

            {!!message && (
              <Text style={styles.message}>
                {message}
              </Text>
            )}

            <TouchableOpacity
              style={[
                styles.saveButton,
                (saving || loading) && styles.disabled,
              ]}
              onPress={handleSave}
              disabled={saving || loading}
            >
              <Text style={styles.saveText}>
                {saving ? '저장 중...' : '특별 일정 저장하기'}
              </Text>
            </TouchableOpacity>

            <View style={styles.historySection}>
              <Text style={styles.historyTitle}>
                📅 저장된 특별 일정
              </Text>

              {loading ? (
                <ActivityIndicator
                  color="#245DE5"
                  style={{ marginVertical: 20 }}
                />
              ) : events.length === 0 ? (
                <Text style={styles.emptyText}>
                  아직 등록된 특별 일정이 없습니다.
                </Text>
              ) : (
                events.map((event, index) => (
                  <View
                    key={event.id || `event-${index}`}
                    style={styles.historyItem}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyDate}>
                        {event.date}
                      </Text>

                      <Text style={styles.historyLabel}>
                        {(event.types || [])
                          .map(eventName)
                          .join(' · ')}
                      </Text>

                      {!!event.memo && (
                        <Text style={styles.historyMemo}>
                          {event.memo}
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      onPress={() =>
                        deleteEvent(event.id)
                      }
                      disabled={saving}
                    >
                      <Text style={styles.deleteText}>
                        {confirmDeleteId === event.id
                          ? '삭제 확인'
                          : '삭제'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>

            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                이 기능은 시연용이며, 저장된 일정은
                아직 AI 카드 추천이나 자동 알림에
                연결되지 않습니다. 웹에서는 브라우저
                저장소에 기록되므로 다른 기기와
                동기화되지 않습니다.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.closeButton}
              onPress={close}
              disabled={saving || loading}
            >
              <Text style={styles.closeText}>
                닫기 · 메인으로 돌아가기
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10,20,40,0.55)',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  content: {
    padding: 20,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2861DD',
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#1E3255',
    lineHeight: 28,
  },
  xButton: {
    padding: 6,
  },
  xText: {
    color: '#7B8799',
    fontWeight: '900',
    fontSize: 17,
  },
  description: {
    color: '#758298',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 12,
    marginBottom: 16,
  },
  section: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#EDF1F7',
  },
  sectionTitle: {
    color: '#233C68',
    fontWeight: '900',
    fontSize: 14,
    marginBottom: 10,
  },
  hint: {
    fontSize: 11,
    color: '#8A96A8',
    marginBottom: 10,
    lineHeight: 17,
  },
  optionWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DEE6F2',
  },
  optionActive: {
    backgroundColor: '#E9F1FF',
    borderColor: '#2860DF',
  },
  optionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#61718A',
  },
  optionTextActive: {
    color: '#2458D1',
    fontWeight: '900',
  },
  input: {
    backgroundColor: '#F9FBFE',
    borderWidth: 1,
    borderColor: '#DCE5F1',
    borderRadius: 11,
    padding: 12,
    fontSize: 13,
    color: '#263955',
  },
  todayButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 5,
  },
  todayText: {
    color: '#2860D9',
    fontSize: 12,
    fontWeight: '800',
  },
  message: {
    marginVertical: 12,
    color: '#A65A45',
    fontSize: 12,
    lineHeight: 19,
  },
  saveButton: {
    backgroundColor: '#245DE5',
    borderRadius: 13,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  saveText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  historySection: {
    marginTop: 25,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#E8EDF5',
  },
  historyTitle: {
    color: '#253C69',
    fontSize: 16,
    fontWeight: '900',
    marginBottom: 12,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF1F6',
    paddingVertical: 13,
    gap: 8,
  },
  historyDate: {
    color: '#2760DA',
    fontSize: 12,
    fontWeight: '900',
  },
  historyLabel: {
    color: '#344660',
    fontSize: 12,
    marginTop: 5,
    lineHeight: 19,
  },
  historyMemo: {
    color: '#8390A2',
    fontSize: 11,
    marginTop: 5,
  },
  deleteText: {
    color: '#BE5C5C',
    fontSize: 12,
    fontWeight: '800',
  },
  emptyText: {
    color: '#8792A3',
    fontSize: 12,
    paddingVertical: 18,
  },
  notice: {
    backgroundColor: '#F1F5FB',
    borderRadius: 12,
    padding: 12,
    marginTop: 18,
  },
  noticeText: {
    color: '#74829A',
    fontSize: 11,
    lineHeight: 18,
  },
  closeButton: {
    alignItems: 'center',
    paddingVertical: 15,
    marginTop: 10,
  },
  closeText: {
    color: '#667894',
    fontSize: 13,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.6,
  },
});
