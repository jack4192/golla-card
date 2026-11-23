import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
export default function PrivacyDataModal({
  visible,
  pendingReset = false,
  onClose,
  onDelete
}) {
  const [scope, setScope] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setScope(pendingReset ? 'account' : null);
      setConfirmation('');
      setMessage('');
    }
    wasVisible.current = visible;
  }, [visible, pendingReset]);
  const select = value => {
    if (lock.current) return;
    setScope(value);
    setConfirmation('');
    setMessage('');
  };
  const close = () => {
    if (!lock.current) onClose?.();
  };
  const remove = async () => {
    if (lock.current || !scope || confirmation !== '삭제') return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const report = await onDelete(scope);
      setConfirmation('');
      setMessage(report.ok ? scope === 'account' ? '동의 철회와 이 기기의 계정 초기화를 완료했습니다. 로그인 화면에서 다시 시작할 수 있습니다.' : '일과·일정·추천 기록을 삭제했습니다.' : `일부 항목을 삭제하지 못했습니다: ${report.failed.join(', ')}. 같은 범위로 다시 시도해주세요.`);
    } catch (error) {
      setMessage(error?.message || '삭제하지 못했습니다. 저장소 설정을 확인하고 다시 시도해주세요.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <Text style={styles.title}>데이터 관리</Text>

            <Text style={styles.hint}>
              이 기기에 저장된 기록을 관리해요.
              실제 금융계좌·카드 발급 및 카드사 데이터는 대상이 아닙니다.
            </Text>

            {pendingReset && <Text style={styles.error}>
                이전 계정 초기화가 완료되지 않았습니다.
                초기화를 다시 완료한 후 로그인해주세요.
              </Text>}

            <TouchableOpacity disabled={busy || pendingReset} style={[styles.option, scope === 'personal' && styles.selected]} onPress={() => select('personal')}>
              <Text style={styles.label}>
                일과·추천 기록 삭제
              </Text>

              <Text style={styles.hint}>
                평소 일과, 특별 일정, 오늘 확인·카드 계획,
                추천용 보유·관심 목록을 삭제합니다.
                PIN과 서비스 동의는 유지합니다.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity disabled={busy} style={[styles.option, scope === 'account' && styles.selected]} onPress={() => select('account')}>
              <Text style={styles.label}>
                동의 철회 및 이 기기의 계정 초기화
              </Text>

              <Text style={styles.hint}>
                생활 기록, PIN, 서비스 동의, 가입 진행·화면 설정,
                이 기기에 저장된 계정 정보를 지우고
                로그인 화면으로 이동합니다.
              </Text>
            </TouchableOpacity>

            {scope && <>
                <Text style={styles.error}>
                  삭제한 기록은 복구할 수 없습니다.
                  진행하려면 아래에 ‘삭제’를 입력하세요.
                </Text>

                <TextInput style={styles.input} value={confirmation} onChangeText={setConfirmation} editable={!busy} placeholder="삭제" accessibilityLabel="삭제 확인 문구" autoCorrect={false} />

                <TouchableOpacity disabled={busy || confirmation !== '삭제'} style={[styles.danger, (busy || confirmation !== '삭제') && styles.dim]} onPress={remove}>
                  {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.white}>
                      {scope === 'account' ? '동의 철회·초기화 실행' : '선택한 기록 삭제'}
                    </Text>}
                </TouchableOpacity>
              </>}

            {!!message && <Text style={styles.message} accessibilityLiveRegion="polite">
                {message}
              </Text>}

            <TouchableOpacity disabled={busy} style={styles.option} onPress={close}>
              <Text style={styles.label}>닫기</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>;
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: '#0007'
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    width: "100%",
    maxWidth: 620,
    alignSelf: "center",
    borderRadius: 26
  },
  body: {
    padding: 24,
    paddingBottom: 38,
    gap: 18
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
  label: {
    fontSize: 15,
    fontWeight: '800',
    color: '#243D61'
  },
  option: {
    padding: 16,
    borderWidth: 1,
    borderColor: '#DFE5EF',
    borderRadius: 14,
    gap: 8,
    minHeight: 44
  },
  selected: {
    borderColor: "#245DE5",
    backgroundColor: "#EDF3FF"
  },
  input: {
    padding: 15,
    borderWidth: 1,
    borderColor: "#E3EAF4",
    borderRadius: 14,
    fontSize: 16,
    color: "#142D4E",
    minHeight: 52,
    backgroundColor: "#FFFFFF"
  },
  danger: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#B6384C'
  },
  white: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF"
  },
  error: {
    color: "#C53D56",
    fontSize: 13,
    lineHeight: 22
  },
  message: {
    color: "#245DE5",
    fontSize: 13,
    lineHeight: 22
  },
  dim: {
    opacity: 0.5
  }
});
