
import React, { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Alert } from '../utils/demoAlert';

export default function AgreementScreen({
  onNext,
  onBack,
  initialConsent = null,
}) {
  const [myDataAgreed, setMyDataAgreed] = useState(
    initialConsent?.myDataAgreed === true
  );
  const [isSaving, setIsSaving] = useState(false);

  const handleNext = async () => {
    if (isSaving) return;

    if (!myDataAgreed) {
      Alert.alert(
        '필수 동의 안내',
        '서비스 이용을 위해 마이데이터 활용에 동의해주세요.'
      );
      return;
    }

    setIsSaving(true);

    try {
      await onNext({
        myDataAgreed: true,
      });
    } catch (error) {
      console.warn('약관 저장 실패:', error);
      Alert.alert(
        '저장 실패',
        '동의정보를 저장하지 못했습니다.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
      >
        <TouchableOpacity
          onPress={onBack}
          disabled={isSaving}
          style={styles.backButton}
        >
          <Text style={styles.backText}>← 뒤로</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          서비스 이용 동의
        </Text>

        <Text style={styles.subtitle}>
          SOL페이의 소비 패턴 분석과
          맞춤형 카드 혜택 기능을 이용하려면
          아래 항목을 확인해주세요.
        </Text>

        {initialConsent && (
          <View style={styles.savedNotice}>
            <Text style={styles.savedNoticeText}>
              ✓ 이전에 저장된 동의정보를 불러왔습니다.
            </Text>
          </View>
        )}

        <View style={styles.agreeBox}>
          <Switch
            value={myDataAgreed}
            onValueChange={setMyDataAgreed}
            disabled={isSaving}
            trackColor={{
              false: '#D1D1D6',
              true: '#1A237E',
            }}
            thumbColor="#FFFFFF"
          />

          <View style={styles.agreeTextArea}>
            <Text style={styles.agreeTitle}>
              [필수] 마이데이터 활용 동의
            </Text>

            <Text style={styles.agreeDescription}>
              보유 카드 불러오기 및
              소비 패턴 분석에 대한 시연용 동의
            </Text>
          </View>
        </View>

        <View style={styles.statusBox}>
          <Text style={styles.statusTitle}>
            현재 동의 상태
          </Text>

          <Text
            style={[
              styles.statusValue,
              !myDataAgreed && styles.notAgreed,
            ]}
          >
            {myDataAgreed
              ? '마이데이터 활용: 동의'
              : '마이데이터 활용: 미동의'}
          </Text>
        </View>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            ※ 현재는 시연용 앱이며
            실제 금융기관의 마이데이터 서비스나
            본인확인 절차에 연결되지 않았습니다.
          </Text>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[
          styles.primaryButton,
          isSaving && styles.disabled,
        ]}
        onPress={handleNext}
        disabled={isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>
            동의하고 계속하기
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  content: {
    flexGrow: 1,
    paddingTop: 35,
    paddingBottom: 20,
  },
  backButton: {
    marginBottom: 30,
  },
  backText: {
    color: '#667085',
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    color: '#1A237E',
    fontSize: 27,
    fontWeight: '900',
    marginBottom: 12,
  },
  subtitle: {
    color: '#657083',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 25,
  },
  savedNotice: {
    backgroundColor: '#E9F2FF',
    padding: 13,
    borderRadius: 11,
    marginBottom: 16,
  },
  savedNoticeText: {
    color: '#2459A4',
    fontSize: 12,
    fontWeight: '700',
  },
  agreeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F9FD',
    borderRadius: 15,
    padding: 17,
  },
  agreeTextArea: {
    flex: 1,
    marginLeft: 14,
  },
  agreeTitle: {
    color: '#28364F',
    fontSize: 14,
    fontWeight: '900',
    marginBottom: 6,
  },
  agreeDescription: {
    color: '#778399',
    fontSize: 12,
    lineHeight: 18,
  },
  statusBox: {
    borderColor: '#E5EAF2',
    borderWidth: 1,
    borderRadius: 13,
    padding: 17,
    marginTop: 18,
  },
  statusTitle: {
    color: '#33415B',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 10,
  },
  statusValue: {
    color: '#245DE5',
    fontSize: 13,
    fontWeight: '800',
  },
  notAgreed: {
    color: '#D46464',
  },
  notice: {
    marginTop: 20,
  },
  noticeText: {
    color: '#8792A3',
    fontSize: 12,
    lineHeight: 20,
  },
  primaryButton: {
    padding: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A237E',
    borderRadius: 12,
    marginBottom: 22,
    minHeight: 54,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
  },
  disabled: {
    opacity: 0.6,
  },
});
