import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RoutineRecommendationScreen from '../screens/RoutineRecommendationScreen';
import { canShowPopup, claimLaunch, currentLaunch, hideForSevenDays, launchPending, nextLaunch, readHiddenUntil } from '../utils/recommendationPopup';
export default function RecommendationLaunchPopup({
  enabled = true
}) {
  const [launch, setLaunch] = useState(currentLaunch),
    [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    let background = AppState.currentState === 'background';
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'background') background = true;
      if (state === 'active' && background) {
        background = false;
        setVisible(false);
        setError('');
        setLaunch(nextLaunch());
      }
    });
    return () => {
      alive.current = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!enabled) {
      setVisible(false);
      return;
    }
    if (!foreground || !launchPending(launch) || saving) return;
    readHiddenUntil().then(until => {
      if (active && claimLaunch(launch)) setVisible(canShowPopup(until));
    }).catch(() => {
      // 읽기 실패 시 저장한 숨김 설정을 무시해 광고를 띄우지 않습니다.
    });
    return () => {
      active = false;
    };
  }, [enabled, foreground, launch, saving]);
  const close = () => {
    if (!lock.current) {
      setVisible(false);
      setError('');
    }
  };
  const hide = async () => {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await hideForSevenDays();
      if (alive.current) setVisible(false);
    } catch {
      if (alive.current) setError('설정을 저장하지 못했어요. 다시 시도하거나 닫아주세요.');
    } finally {
      lock.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const shown = visible && enabled && foreground;
  return <Modal visible={shown} transparent animationType="fade" onRequestClose={close}>
    {shown && <View style={s.overlay}><View style={s.sheet}>
      <View style={s.header}><Text style={s.title}>오늘의 추천 · 시연</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="추천 팝업 닫기" disabled={saving} onPress={close} style={s.close}><Text style={s.link}>✕</Text></TouchableOpacity></View>
      <View style={s.content}><RoutineRecommendationScreen presentation="popup" onNext={close} /></View>
      <View style={s.footer}>
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <View style={s.row}>
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={hide} style={[s.hide, saving && s.dim]}>{saving ? <ActivityIndicator color="#245DE5" /> : <Text style={s.link}>7일간 보지 않기</Text>}</TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={close} style={[s.done, saving && s.dim]}><Text style={s.white}>닫기</Text></TouchableOpacity>
        </View>
      </View>
    </View></View>}
  </Modal>;
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#0008',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12
  },
  sheet: {
    width: '100%',
    maxWidth: 600,
    height: '92%',
    backgroundColor: "#F4F7FB",
    borderRadius: 28,
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 22,
    backgroundColor: "#FFFFFF"
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 23
  },
  close: {
    padding: 18
  },
  content: {
    flex: 1,
    minHeight: 0
  },
  footer: {
    padding: 16,
    paddingBottom: 26,
    backgroundColor: "#FFFFFF",
    gap: 10
  },
  row: {
    flexDirection: 'row',
    gap: 10
  },
  hide: {
    flex: 1,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    minHeight: 48,
    justifyContent: "center"
  },
  done: {
    padding: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: "#245DE5",
    minHeight: 48,
    justifyContent: "center"
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  white: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: "#C53D56"
  },
  dim: {
    opacity: 0.4
  }
});
