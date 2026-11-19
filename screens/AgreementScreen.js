import FlowHeading from '../components/FlowHeading';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
function normalizePermission(response) {
  const Notifications = require('expo-notifications');
  const provisional = response.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
  return {
    status: response.granted || provisional ? 'granted' : response.status,
    canAskAgain: response.canAskAgain !== false && !(Platform.OS === 'ios' && response.status === 'denied'),
    provisional
  };
}

// 현재 상태만 조회합니다. 권한 요청 창은 띄우지 않습니다.
export async function getDeviceNotificationPermission() {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !('Notification' in window) || !window.isSecureContext) {
      return {
        status: 'unsupported',
        canAskAgain: false
      };
    }
    const status = window.Notification.permission;
    return {
      status: status === 'default' ? 'undetermined' : status,
      canAskAgain: status === 'default'
    };
  }
  const Notifications = require('expo-notifications');
  const response = await Notifications.getPermissionsAsync();
  return normalizePermission(response);
}

// 사용자가 버튼을 눌렀을 때만 호출합니다.
export async function requestDeviceNotificationPermission() {
  const current = await getDeviceNotificationPermission();
  if (current.status === 'granted' || current.status === 'unsupported' || !current.canAskAgain) {
    return current;
  }
  if (Platform.OS === 'web') {
    const status = await window.Notification.requestPermission();
    return {
      status: status === 'default' ? 'undetermined' : status,
      canAskAgain: status === 'default'
    };
  }
  const Notifications = require('expo-notifications');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('morning-schedule', {
      name: '아침 일정 확인',
      importance: Notifications.AndroidImportance.DEFAULT
    });
  }
  const response = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true
    }
  });
  return normalizePermission(response);
}

function permissionMessage(status) {
  switch (status) {
    case 'granted': return '기기 알림 권한이 허용됐어요.';
    case 'denied': return '현재 알림 권한이 꺼져 있어요. 알림 없이도 계속 이용할 수 있어요.';
    case 'unsupported': return '현재 환경에서는 기기 알림을 사용할 수 없어요.';
    default: return '아직 알림 권한을 선택하지 않았어요.';
  }
}

function CheckRow({
  title,
  description,
  checked,
  disabled,
  onPress
}) {
  return <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={title} accessibilityState={{
    checked,
    disabled
  }} disabled={disabled} onPress={onPress} style={[styles.checkRow, checked && styles.selected, disabled && styles.disabled]}>
      <Text style={[styles.square, checked && styles.squareChecked]}>
        {checked ? '✓' : ''}
      </Text>

      <View style={styles.flex}>
        <Text style={styles.checkTitle}>
          {title}
        </Text>

        <Text style={styles.hint}>
          {description}
        </Text>
      </View>
    </TouchableOpacity>;
}
export default function AgreementScreen({
  onNext,
  onBack,
  initialConsent = null,
  initialDraft = null,
  onDraftChange = () => {}
}) {
  const [choices, setChoices] = useState(() => {
    const saved = initialDraft ?? initialConsent;
    return {
      termsAgreed: saved?.termsAgreed === true,
      myDataAgreed: saved?.termsAgreed === true && saved?.myDataAgreed === true,
      morningNotificationAgreed: saved?.morningNotificationAgreed === true
    };
  });
  const { termsAgreed, myDataAgreed, morningNotificationAgreed } = choices;
  const [permission, setPermission] = useState({
    status: 'undetermined',
    canAskAgain: true
  });
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const revision = useRef(0);
  const returningFromSettings = useRef(false);
  const busy = !!pending;
  useEffect(() => {
    mounted.current = true;
    const refresh = async (showResult = false) => {
      if (lock.current) return;
      const ticket = ++revision.current;
      try {
        const result = await getDeviceNotificationPermission();
        if (!mounted.current || ticket !== revision.current) return;
        setPermission(result);
        if (showResult) setMessage(permissionMessage(result.status));
      } catch {
        if (mounted.current && ticket === revision.current) {
          setMessage('알림 권한 상태를 확인하지 못했어요. 다시 확인해주세요.');
        }
      }
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' || Platform.OS === 'web') return;
      const showResult = returningFromSettings.current;
      returningFromSettings.current = false;
      refresh(showResult);
    });
    return () => {
      mounted.current = false;
      revision.current += 1;
      subscription.remove();
    };
  }, []);
  const toggleChoice = key => {
    if (lock.current) return;
    const next = { ...choices, [key]: !choices[key] };
    setChoices(next);
    setMessage('');
    onDraftChange(next);
  };
  const checkPermission = async (request = false) => {
    if (lock.current || request && !morningNotificationAgreed) {
      return;
    }
    lock.current = true;
    setPending('permission');
    setMessage('');
    const ticket = ++revision.current;
    try {
      const result = request ? await requestDeviceNotificationPermission() : await getDeviceNotificationPermission();
      if (!mounted.current || ticket !== revision.current) {
        return;
      }
      setPermission(result);
      setMessage(permissionMessage(result.status));
    } catch (error) {
      if (mounted.current) {
        setMessage(error.message || '알림 권한 요청에 실패했습니다. 다시 시도해주세요.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setPending('');
      }
    }
  };
  const openNotificationSettings = async () => {
    returningFromSettings.current = true;
    try {
      await Linking.openSettings();
    } catch {
      returningFromSettings.current = false;
      setMessage('기기 설정 앱에서 알림을 켜주세요. Expo Go로 실행 중이면 Expo Go의 알림 설정을 열어주세요.');
    }
  };
  const next = async () => {
    if (lock.current || !termsAgreed) return;
    lock.current = true;
    setPending('save');
    setMessage('');
    try {
      if (typeof onNext !== 'function') {
        throw Error('다음 화면 연결을 확인해주세요.');
      }
      await onNext(choices);
    } catch (error) {
      if (mounted.current) {
        setMessage(error.message || '선택 사항을 저장하지 못했습니다. 다시 시도해주세요.');
      }
    } finally {
      lock.current = false;
      if (mounted.current) {
        setPending('');
      }
    }
  };
  const permissionLabel = permission.provisional ? '임시 허용' : {
    granted: '허용',
    denied: '거부',
    undetermined: '아직 요청하지 않음',
    unsupported: '지원하지 않는 환경'
  }[permission.status] || permission.status;
  const needsSettings = Platform.OS !== 'web' && permission.status === 'denied' && !permission.canAskAgain;
  return <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => onBack?.()} style={styles.back}>
          <Text style={styles.link}>
            ← 뒤로
          </Text>
        </TouchableOpacity>

        <FlowHeading brand icon="document-text-outline">
          서비스 이용 동의
        </FlowHeading>

        <Text style={styles.hint}>
          필수 항목을 확인한 뒤, 사용할 선택 기능을 골라주세요.
        </Text>

        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.section}>필수 항목</Text>
          <CheckRow
            title="[필수] 서비스 이용 동의"
            description="일과와 일정을 저장하고, 이를 바탕으로 카드 혜택을 추천해요. 계좌 연결, 실제 결제, 카드 발급은 현재 제공되지 않아요."
            checked={termsAgreed}
            disabled={busy}
            onPress={() => toggleChoice('termsAgreed')}
          />
        </View>

        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.section}>선택 항목</Text>
          <Text style={styles.hint}>선택 항목을 건너뛰어도 홈, 일정 관리와 일과 기반 카드 추천을 이용할 수 있어요.</Text>
          <CheckRow
            title="[선택] 카드·소비 데이터 활용 동의"
            description="불러온 예시 카드와 소비 내역을 지갑, 소비 분석, 카드 추천에 사용해요."
            checked={myDataAgreed}
            disabled={busy}
            onPress={() => toggleChoice('myDataAgreed')}
          />
          <CheckRow
            title="[선택] 아침 일정 알림 받기"
            description="알림을 받으려면 이 항목을 선택한 뒤 알림 권한을 허용해주세요."
            checked={morningNotificationAgreed}
            disabled={busy}
            onPress={() => toggleChoice('morningNotificationAgreed')}
          />
        </View>

        {morningNotificationAgreed && <View style={styles.box}>
          <Text style={styles.label}>
            기기 알림 권한: {permissionLabel}
          </Text>

          {needsSettings ? (
            <TouchableOpacity accessibilityRole="button" disabled={busy} style={[styles.secondary, styles.permissionAction, busy && styles.disabled]} onPress={openNotificationSettings}>
              <Text style={styles.white}>기기 설정에서 알림 켜기</Text>
            </TouchableOpacity>
          ) : permission.canAskAgain && permission.status !== 'granted' && permission.status !== 'unsupported' && (
            <TouchableOpacity accessibilityRole="button" disabled={busy} style={[styles.secondary, styles.permissionAction, busy && styles.disabled]} onPress={() => checkPermission(true)}>
              <Text style={styles.white}>알림 권한 허용</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity accessibilityRole="button" disabled={busy} style={styles.secondary} onPress={() => checkPermission(false)}>
            <Text style={styles.link}>
              {pending === 'permission' ? '확인 중…' : '현재 권한 상태 확인'}
            </Text>
          </TouchableOpacity>

          {needsSettings && <Text style={styles.hint}>
            기기 설정에서 알림을 켠 뒤 돌아오면 권한 상태가 자동으로 바뀌어요. Expo Go로 실행 중이면 Expo Go의 알림을 켜주세요.
          </Text>}
          {Platform.OS === 'ios' && permission.status === 'undetermined' && <Text style={styles.hint}>
            버튼을 누르면 아이폰이 알림을 허용할지 물어봐요. Expo Go로 실행 중이면 팝업에 Expo Go 이름이 표시돼요.
          </Text>}
          {Platform.OS === 'web' && permission.status === 'denied' && <Text style={styles.hint}>
            브라우저 주소창의 사이트 설정에서 알림을 허용한 뒤 현재 권한 상태를 확인해주세요.
          </Text>}
          {Platform.OS === 'web' && permission.status === 'unsupported' && <Text style={styles.hint}>
            브라우저에서 알림 권한을 요청하려면 HTTPS 또는 localhost로 접속해야 해요.
          </Text>}

          <Text style={styles.hint}>
            알림 권한을 허용해도 아침 알림이 자동으로 예약되지는 않아요.
          </Text>
        </View>}

        {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">
            {message}
          </Text>}

      </ScrollView>

      <TouchableOpacity accessibilityRole="button" disabled={busy || !termsAgreed} style={[styles.primary, (busy || !termsAgreed) && styles.disabled]} onPress={next}>
        {pending === 'save' ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>
            동의하고 계속하기
          </Text>}
      </TouchableOpacity>
    </View>;
}
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FF"
  },
  content: {
    padding: 22,
    paddingBottom: 40,
    gap: 18,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingTop: 12
  },
  flex: {
    flex: 1
  },
  back: {
    paddingVertical: 10,
    alignSelf: 'flex-start',
    minHeight: 44
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: "#5A6E89"
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderColor: '#E4EAF3',
    borderRadius: 18,
    padding: 18,
    backgroundColor: "#FFFFFF",
    minHeight: 64
  },
  selected: {
    borderColor: "#104FE7",
    backgroundColor: "#EDF3FF"
  },
  square: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: '#B3BED0',
    borderRadius: 7,
    textAlign: 'center',
    lineHeight: 22,
    color: "#FFFFFF",
    fontWeight: "800"
  },
  squareChecked: {
    backgroundColor: "#104FE7",
    borderColor: "#104FE7"
  },
  checkTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: "#142D4E",
    lineHeight: 22,
    marginBottom: 5
  },
  section: {
    fontSize: 18,
    color: "#142D4E",
    fontWeight: '800',
    marginTop: 12
  },
  group: { gap: 10 },
  box: {
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 20,
    padding: 20,
    gap: 12,
    backgroundColor: "#FFFFFF"
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: '#315483'
  },
  secondary: {
    backgroundColor: "#EDF3FF",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    minHeight: 46,
    justifyContent: "center"
  },
  permissionAction: {
    backgroundColor: '#104FE7',
  },
  link: {
    color: "#104FE7",
    fontSize: 13,
    fontWeight: "700"
  },
  primary: {
    margin: 0,
    padding: 16,
    minHeight: 54,
    backgroundColor: "#104FE7",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    width: "90%",
    maxWidth: 552,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 20
  },
  white: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700"
  },
  message: {
    color: '#88512E',
    fontSize: 13,
    lineHeight: 22
  },
  disabled: {
    opacity: 0.5
  }
});
