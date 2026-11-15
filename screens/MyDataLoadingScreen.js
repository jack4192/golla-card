import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Animated, ActivityIndicator } from 'react-native';

export default function MyDataLoadingScreen({ onNext }) {
  // 프로그레스 바 게이지 애니메이션 (0 -> 1)
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 1. 3초(3000ms) 동안 부드럽게 100%로 게이지가 차오름
    Animated.timing(progress, {
      toValue: 1,
      duration: 3000,
      useNativeDriver: false,
    }).start();

    // 2. 3.2초 뒤에 자동으로 다음 화면(AI 맞춤 추천)으로 이동
    const timer = setTimeout(() => {
      onNext();
    }, 3200);

    return () => clearTimeout(timer);
  }, []);

  // 0~1 값을 0%~100% 문자열로 변환
  const widthInterpolate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        
        {/* 상단 텍스트 영역 */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>금융 정보를{'\n'}안전하게 분석하고 있어요</Text>
          <Text style={styles.subtitle}>흩어진 자산과 결제 내역을 모아{'\n'}최적의 혜택 시나리오를 계산 중입니다.</Text>
        </View>

        {/* 중앙 기본 로딩 스피너 (파일 다운로드 불필요) */}
        <View style={styles.animationContainer}>
          <ActivityIndicator size="large" color="#0046FF" style={{ transform: [{ scale: 1.5 }] }} />
        </View>

        {/* 하단 프로그레스 바 영역 */}
        <View style={styles.progressWrapper}>
          <Text style={styles.progressText}>마이데이터 연동 및 분석 중...</Text>
          <View style={styles.progressBackground}>
            <Animated.View style={[styles.progressBar, { width: widthInterpolate }]} />
          </View>
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between', paddingVertical: 40 },
  textContainer: { marginTop: 20 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1A1A1A', lineHeight: 34, marginBottom: 12 },
  subtitle: { fontSize: 16, color: '#767676', lineHeight: 24 },
  
  // 애니메이션 컨테이너
  animationContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // 프로그레스 바 스타일
  progressWrapper: { marginBottom: 20 },
  progressText: { fontSize: 14, fontWeight: 'bold', color: '#0046FF', marginBottom: 12, textAlign: 'center' },
  progressBackground: { height: 8, backgroundColor: '#E5E5EA', borderRadius: 4, overflow: 'hidden' },
  progressBar: { height: '100%', backgroundColor: '#0046FF', borderRadius: 4 },
});