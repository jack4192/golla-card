import FlowHeading from '../components/FlowHeading';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PHONE_NOTIFICATIONS_SUPPORTED, requestPhonePermission } from '../utils/notifications';
function CheckRow({
  title,
  description,
  checked,
  disabled,
  onPress
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[styles.checkCard, checked && styles.selected, disabled && styles.disabled]}>
      <View style={styles.checkRow}>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={title}
          accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={styles.checkControl}>
          <Text style={[styles.square, checked && styles.squareChecked]}>{checked ? '✓' : ''}</Text>
          <Text style={styles.checkTitle}>{title}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={title + ' 상세보기'}
          accessibilityState={{ expanded }} disabled={disabled} onPress={() => setExpanded(value => !value)} style={styles.detailsButton}>
          <Text style={styles.link}>{expanded ? '접기' : '상세보기'}</Text>
        </TouchableOpacity>
      </View>
      {expanded && <Text style={[styles.hint, styles.details]}>{description}</Text>}
    </View>
  );
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
      morningNotificationAgreed: saved?.morningNotificationAgreed === true
    };
  });
  const { termsAgreed, morningNotificationAgreed } = choices;
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const mounted = useRef(true);
  const lock = useRef(false);
  const busy = !!pending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const toggleChoice = async key => {
    if (lock.current) return;
    const next = { ...choices, [key]: !choices[key] };
    // 알림 수신 동의를 켜는 순간 폰의 '알림 허용' 창을 띄운다 (2026-11-24). 거절하면 체크하지 않는다
    if (key === 'morningNotificationAgreed' && next[key] && PHONE_NOTIFICATIONS_SUPPORTED) {
      lock.current = true;
      setPending('permission');
      let granted = false;
      try {
        granted = await requestPhonePermission();
      } catch {
        granted = false;
      } finally {
        lock.current = false;
        if (mounted.current) setPending('');
      }
      if (!mounted.current) return;
      if (!granted) {
        setMessage('폰 설정에서 SOL·Pay 알림을 허용해야 알림을 받을 수 있어요.');
        return;
      }
    }
    setChoices(next);
    setMessage('');
    onDraftChange(next);
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
            title="[선택] 알림 수신 동의"
            description="아침 일정과 혜택 알림을 받아볼 수 있어요."
            checked={morningNotificationAgreed}
            disabled={busy}
            onPress={() => toggleChoice('morningNotificationAgreed')}
          />
        </View>

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
  checkCard: {
    borderWidth: 1,
    borderColor: '#E4EAF3',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: "#FFFFFF"
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  checkControl: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44
  },
  detailsButton: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 6
  },
  details: {
    marginLeft: 36,
    paddingBottom: 8
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
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
    color: "#142D4E",
    lineHeight: 22
  },
  section: {
    fontSize: 18,
    color: "#142D4E",
    fontWeight: '800',
    marginTop: 12
  },
  group: { gap: 10 },
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
