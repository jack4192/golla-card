import FlowHeading from '../components/FlowHeading';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PHONE_NOTIFICATIONS_SUPPORTED, requestPhonePermission } from '../utils/notifications';

const agreements = {
  termsAgreed: {
    title: '[필수] 서비스 이용 동의',
    sections: [
      ['서비스 제공 목적', '로그인과 계정 관리, 일정 관리, 입력한 일정과 카드 정보를 바탕으로 한 카드 혜택 추천에 이용해요.'],
      ['서비스에서 이용하는 정보', '가입 과정에서 입력하는 계정 정보, 등록한 카드 정보와 일과·일정, 약관 동의 여부를 서비스에서 이용해요.'],
      ['기록 확인 및 관리', '일정 관리에서 등록한 일정을 확인하거나 수정·삭제할 수 있어요. 설정의 데이터 관리에서 이 기기의 기록을 지우거나 동의를 철회할 수 있고, 계정은 회원 탈퇴로 지울 수 있어요.'],
      ['서비스 이용 범위', '카드 혜택 안내와 가상 결제를 제공해요. 계좌 연결, 실제 카드 결제와 카드 발급은 제공하지 않아요.'],
      ['동의를 거부할 수 있어요', '서비스 이용 동의는 필수예요. 동의하지 않으면 홈, 일정 관리와 카드 추천으로 진행할 수 없어요.'],
    ],
  },
  morningNotificationAgreed: {
    title: '[선택] 알림 수신 동의',
    sections: [
      ['알림을 보내는 목적', '하루 일정을 입력하고, 일정에 맞는 카드 혜택을 확인할 수 있도록 안내해요.'],
      ['알림 내용과 시간', '매일 오전 7시에 휴대폰으로 일정 입력 안내를 보내요. 알림을 누르면 일정 관리가 열리고, 로그인이 필요한 경우 로그인한 뒤 이동해요.'],
      ['알림에 필요한 설정', '알림 수신 동의와 휴대폰의 알림 권한이 모두 필요해요.'],
      ['동의 거부 및 변경', '알림을 받지 않아도 홈, 일정 관리와 카드 추천을 이용할 수 있어요. 동의 여부는 앱 설정에서 변경할 수 있어요.'],
    ],
  },
};

function CheckRow({
  title,
  checked,
  disabled,
  onOpen
}) {
  return (
    <View style={[styles.checkCard, checked && styles.selected, disabled && styles.disabled]}>
      <View style={styles.checkRow}>
        <TouchableOpacity accessibilityRole="checkbox" accessibilityLabel={title}
          accessibilityHint="상세 내용을 열어요" accessibilityState={{ checked, disabled }} aria-checked={checked}
          disabled={disabled} onPress={onOpen} style={styles.checkControl}>
          <Text style={[styles.square, checked && styles.squareChecked]}>{checked ? '✓' : ''}</Text>
          <Text style={styles.checkTitle}>{title}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={title + ' 상세보기'}
          disabled={disabled} onPress={onOpen} style={styles.detailsButton}>
          <Text style={styles.link}>상세보기</Text>
        </TouchableOpacity>
      </View>
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
  const [detailKey, setDetailKey] = useState(null);
  const detail = agreements[detailKey];
  const mounted = useRef(true);
  const lock = useRef(false);
  const busy = !!pending;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const openDetail = key => {
    setMessage('');
    setDetailKey(key);
  };
  const closeDetail = () => {
    if (lock.current) return;
    setMessage('');
    setDetailKey(null);
  };
  const saveChoice = async (key, agreed) => {
    if (lock.current) return;
    if (choices[key] === agreed) {
      closeDetail();
      return;
    }
    const next = { ...choices, [key]: agreed };
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
        setMessage('폰 설정에서 Pay·Mate 알림을 허용해야 알림을 받을 수 있어요.');
        return;
      }
    }
    setChoices(next);
    setMessage('');
    onDraftChange(next);
    setDetailKey(null);
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

        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.section}>필수 항목</Text>
          <CheckRow
            title={agreements.termsAgreed.title}
            checked={termsAgreed}
            disabled={busy}
            onOpen={() => openDetail('termsAgreed')}
          />
        </View>

        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.section}>선택 항목</Text>
          <Text style={styles.hint}>선택 항목을 건너뛰어도 홈, 일정 관리와 일과 기반 카드 추천을 이용할 수 있어요.</Text>
          <CheckRow
            title={agreements.morningNotificationAgreed.title}
            checked={morningNotificationAgreed}
            disabled={busy}
            onOpen={() => openDetail('morningNotificationAgreed')}
          />
        </View>

        {!detail && !!message && <Text style={styles.message} accessibilityLiveRegion="polite">
            {message}
          </Text>}

      </ScrollView>

      <TouchableOpacity accessibilityRole="button" disabled={busy || !termsAgreed} style={[styles.primary, (busy || !termsAgreed) && styles.disabled]} onPress={next}>
        {pending === 'save' ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>
            동의하고 계속하기
          </Text>}
      </TouchableOpacity>

      {detail && <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={closeDetail}>
        <SafeAreaView style={styles.detailScreen} accessibilityViewIsModal>
          <View style={styles.detailHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="동의 항목으로 돌아가기"
              disabled={busy} onPress={closeDetail} style={styles.detailBack}>
              <Text style={styles.detailArrow}>←</Text>
            </TouchableOpacity>
            <Text style={styles.detailHeaderTitle}>약관 상세</Text>
          </View>
          <ScrollView contentContainerStyle={[styles.content, styles.detailContent]}>
            <Text accessibilityRole="header" style={styles.detailTitle}>{detail.title}</Text>
            {detail.sections.map(([heading, body]) => <View key={heading} style={styles.detailSection}>
              <Text accessibilityRole="header" style={styles.detailSectionTitle}>{heading}</Text>
              <Text style={styles.detailBody}>{body}</Text>
            </View>)}
            {!!message && <Text style={styles.message} accessibilityRole="alert">{message}</Text>}
          </ScrollView>
          <View style={styles.detailFooter}>
            {choices[detailKey] && <TouchableOpacity accessibilityRole="button" disabled={busy}
              onPress={() => saveChoice(detailKey, false)} style={styles.detailUndo}>
              <Text style={styles.link}>동의 해제</Text>
            </TouchableOpacity>}
            <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => saveChoice(detailKey, true)}
              style={[styles.primary, styles.detailPrimary, busy && styles.disabled]}>
              {pending === 'permission' ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>동의하기</Text>}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>}
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
  detailScreen: { flex: 1, backgroundColor: '#FFFFFF' },
  detailHeader: { minHeight: 56, justifyContent: 'center', backgroundColor: '#F4F7FF', borderBottomWidth: 1, borderBottomColor: '#E4EAF3' },
  detailBack: { position: 'absolute', left: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  detailArrow: { color: '#104FE7', fontSize: 22 },
  detailHeaderTitle: { color: '#142D4E', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  detailContent: { paddingTop: 24, paddingBottom: 24, gap: 20 },
  detailTitle: { color: '#142D4E', fontSize: 22, lineHeight: 31, fontWeight: '800' },
  detailSection: { borderTopWidth: 1, borderTopColor: '#E4EAF3', paddingTop: 14, gap: 5 },
  detailSectionTitle: { color: '#142D4E', fontSize: 15, lineHeight: 22, fontWeight: '700' },
  detailBody: { color: '#3B4F6A', fontSize: 14, lineHeight: 23 },
  detailFooter: { borderTopWidth: 1, borderTopColor: '#E4EAF3', paddingTop: 10 },
  detailUndo: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  detailPrimary: { marginTop: 6, marginBottom: 12 },
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
