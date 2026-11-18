import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
const CONSENT_VERSION = 'solpay-mydata-items-v2';
const ITEMS = [{
  key: 'cardInfo',
  title: '[필수] 보유 카드 정보 활용 동의',
  description: '가상 보유 카드의 상품명·카드사·혜택 정보를 조회하고 카드 비교에 사용합니다.'
}, {
  key: 'spendingInfo',
  title: '[필수] 소비 내역 활용 동의',
  description: '가상 거래의 업종·금액·시간을 조회하고 평소 소비 패턴을 분석합니다.'
}, {
  key: 'recommendation',
  title: '[필수] 맞춤 카드 추천 활용 동의',
  description: '가상 카드·소비 패턴과 입력한 일과·일정을 조합해 카드 추천 및 예상 혜택 안내에 사용합니다.'
}];
const requiredAgreed = values => ITEMS.every(item => values[item.key] === true);
const normalize = value => ({
  cardInfo: value?.items?.cardInfo === true,
  spendingInfo: value?.items?.spendingInfo === true,
  recommendation: value?.items?.recommendation === true,
  morningNotification: value?.morningNotificationAgreed === true
});
const grantedStatus = response => {
  const Notifications = require('expo-notifications');
  const provisional = response.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;
  return {
    status: response.granted || provisional ? 'granted' : response.status,
    canAskAgain: response.canAskAgain !== false,
    provisional
  };
};
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
  return grantedStatus(await Notifications.getPermissionsAsync());
}
export async function requestDeviceNotificationPermission() {
  const current = await getDeviceNotificationPermission();
  if (current.status === 'granted' || current.status === 'unsupported' || !current.canAskAgain) return current;
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
  return grantedStatus(await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: false,
      allowSound: true
    }
  }));
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
  }} disabled={disabled} onPress={onPress} style={[s.checkRow, checked && s.selected, disabled && s.disabled]}>
    <Text style={[s.square, checked && s.squareChecked]}>{checked ? '✓' : ''}</Text>
    <View style={s.flex}><Text style={s.checkTitle}>{title}</Text><Text style={s.hint}>{description}</Text></View>
  </TouchableOpacity>;
}
export default function AgreementScreen({
  onNext,
  onBack,
  initialConsent = null,
  initialDraft = null,
  onDraftChange = () => {}
}) {
  // 기존 통합 동의값 하나만으로 새 세부 항목을 자동 체크하지 않습니다.
  const [values, setValues] = useState(() => normalize(initialDraft ?? initialConsent));
  const [permission, setPermission] = useState({
    status: 'undetermined',
    canAskAgain: true
  });
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true),
    lock = useRef(false),
    revision = useRef(0);
  const allRequired = requiredAgreed(values);
  const busy = !!pending;
  const publish = (next, nextPermission = permission) => {
    onDraftChange({
      myDataAgreed: requiredAgreed(next),
      items: {
        cardInfo: next.cardInfo,
        spendingInfo: next.spendingInfo,
        recommendation: next.recommendation
      },
      morningNotificationAgreed: next.morningNotification,
      notificationPermission: nextPermission.status,
      consentVersion: CONSENT_VERSION
    });
  };
  useEffect(() => {
    mounted.current = true;
    const ticket = ++revision.current;
    // 이 시점에는 권한 상태만 읽고, 시스템 권한 창을 띄우지 않습니다.
    getDeviceNotificationPermission().then(result => {
      if (mounted.current && ticket === revision.current) setPermission(result);
    }).catch(() => {
      if (mounted.current && ticket === revision.current) setMessage('알림 권한 상태를 확인하지 못했습니다. 다시 확인해주세요.');
    });
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);
  const change = (key, checked) => {
    if (lock.current) return;
    const next = {
      ...values,
      [key]: checked
    };
    setValues(next);
    setMessage('');
    publish(next);
  };
  const toggleRequired = () => {
    if (lock.current) return;
    const next = {
      ...values,
      cardInfo: !allRequired,
      spendingInfo: !allRequired,
      recommendation: !allRequired
    };
    setValues(next);
    setMessage('');
    publish(next);
  };
  const checkPermission = async (request = false) => {
    if (lock.current || request && !values.morningNotification) return;
    lock.current = true;
    setPending('permission');
    setMessage('');
    const ticket = ++revision.current;
    try {
      const result = request ? await requestDeviceNotificationPermission() : await getDeviceNotificationPermission();
      if (!mounted.current || ticket !== revision.current) return;
      setPermission(result);
      publish(values, result);
      setMessage(result.status === 'granted' ? '기기 알림 권한이 허용되었습니다.' : result.status === 'denied' ? '알림 권한이 거부되었습니다. 알림 없이도 계속 이용할 수 있습니다.' : result.status === 'unsupported' ? '현재 환경은 기기 알림을 지원하지 않습니다. 일정은 직접 확인할 수 있습니다.' : '아직 알림 권한을 허용하지 않았습니다. 나중에 설정할 수 있습니다.');
    } catch (error) {
      if (mounted.current) setMessage(error.message || '알림 권한 요청에 실패했습니다. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      if (mounted.current) setPending('');
    }
  };
  const next = async () => {
    if (lock.current || !allRequired) return;
    lock.current = true;
    setPending('save');
    setMessage('');
    try {
      if (typeof onNext !== 'function') throw Error('다음 화면 연결을 확인해주세요.');
      const agreedAt = new Date().toISOString();
      await onNext({
        myDataAgreed: true,
        items: {
          cardInfo: values.cardInfo,
          spendingInfo: values.spendingInfo,
          recommendation: values.recommendation
        },
        morningNotificationAgreed: values.morningNotification,
        notificationPermission: permission.status,
        notificationPermissionInfo: permission,
        consentVersion: CONSENT_VERSION,
        agreedAt,
        itemAgreedAt: {
          cardInfo: agreedAt,
          spendingInfo: agreedAt,
          recommendation: agreedAt,
          morningNotification: values.morningNotification ? agreedAt : null
        }
      });
    } catch (error) {
      if (mounted.current) setMessage(error.message || '동의 처리를 완료하지 못했습니다. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      if (mounted.current) setPending('');
    }
  };
  const permissionLabel = permission.provisional ? '임시 허용' : {
    granted: '허용',
    denied: '거부',
    undetermined: '아직 요청하지 않음',
    unsupported: '지원하지 않는 환경'
  }[permission.status] || permission.status;
  return <View style={s.screen}>
    <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => onBack?.()} style={s.back}>
        <Text style={s.link}>← 뒤로</Text>
      </TouchableOpacity>
      <Text accessibilityRole="header" style={s.title}>마이데이터 활용 동의</Text>
      <Text style={s.hint}>처음 이용하기 전에 활용 항목을 각각 확인해주세요. 현재는 가상 데이터로만 작동하며 실제 금융기관을 조회하지 않습니다.</Text>
      <CheckRow title="필수 항목 모두 동의" description="아래 필수 3개 항목을 함께 선택하거나 해제합니다." checked={allRequired} disabled={busy} onPress={toggleRequired} />
      {ITEMS.map(item => <CheckRow key={item.key} title={item.title} description={item.description} checked={values[item.key]} disabled={busy} onPress={() => change(item.key, !values[item.key])} />)}
      <Text style={s.section}>아침 일정 알림</Text>
      <CheckRow title="[선택] 아침 일정 확인 알림 받기" description="알림을 원하면 선택 후 아래 버튼으로 기기 알림 권한을 허용해주세요. 거부해도 가입과 일정 등록은 가능합니다." checked={values.morningNotification} disabled={busy} onPress={() => change('morningNotification', !values.morningNotification)} />
      <View style={s.box}>
        <Text style={s.label}>기기 알림 권한: {permissionLabel}</Text>
        <TouchableOpacity accessibilityRole="button" disabled={busy || !values.morningNotification || permission.status === 'granted' || permission.status === 'unsupported' || !permission.canAskAgain} style={[s.secondary, (busy || !values.morningNotification || permission.status === 'granted' || permission.status === 'unsupported' || !permission.canAskAgain) && s.disabled]} onPress={() => checkPermission(true)}>
          <Text style={s.link}>{pending === 'permission' ? '확인 중…' : permission.status === 'granted' ? '알림 권한 허용됨' : '아침 알림 권한 요청'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.secondary} onPress={() => checkPermission(false)}>
          <Text style={s.link}>권한 상태 다시 확인</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' && permission.status === 'denied' && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.secondary} onPress={() => Linking.openSettings().catch(() => setMessage('기기의 설정 앱에서 알림 권한을 변경해주세요.'))}>
          <Text style={s.link}>기기 설정에서 권한 변경</Text>
        </TouchableOpacity>}
        <Text style={s.hint}>{Platform.OS === 'web' ? '웹은 HTTPS 또는 localhost에서 브라우저가 알림을 지원해야 합니다. 거부했다면 주소창의 사이트 권한에서 변경한 뒤 다시 확인해주세요. 브라우저 권한은 모바일 앱 권한과 별개입니다.' : 'Expo Go에서는 Expo Go 앱의 알림 권한을 요청합니다. 설정에서 변경했다면 돌아온 뒤 권한 상태를 다시 확인해주세요.'}</Text>
        <Text style={s.hint}>이번 단계는 기기 권한 요청까지입니다. 아침 시간 설정·매일 알림 예약은 이후 연결하며, 권한 허용만으로 알림을 예약하지 않습니다.</Text>
      </View>
      {!!message && <Text style={s.message} accessibilityLiveRegion="polite">{message}</Text>}
      {!allRequired && <Text style={s.hint}>필수 3개 항목에 동의하면 다음으로 이동할 수 있습니다.</Text>}
    </ScrollView>
    <TouchableOpacity accessibilityRole="button" disabled={busy || !allRequired} style={[s.primary, (busy || !allRequired) && s.disabled]} onPress={next}>
      {pending === 'save' ? <ActivityIndicator color="#FFF" /> : <Text style={s.white}>동의하고 계속하기</Text>}
    </TouchableOpacity>
  </View>;
}
const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  content: {
    padding: 22,
    paddingBottom: 40,
    gap: 18,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingTop: 28
  },
  flex: {
    flex: 1
  },
  back: {
    paddingVertical: 10,
    alignSelf: 'flex-start',
    minHeight: 44
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 39
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
    borderColor: "#245DE5",
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
    backgroundColor: "#245DE5",
    borderColor: "#245DE5"
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
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  primary: {
    margin: 0,
    padding: 16,
    minHeight: 54,
    backgroundColor: "#245DE5",
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
