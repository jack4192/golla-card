import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView } from 'react-native';

export default function MyDataScreen({ onNext }) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
        
        {/* 상단 타이틀 영역 */}
        <View style={styles.header}>
          <Text style={styles.titleIcon}>✨</Text>
          <Text style={styles.title}>여승범 님의{'\n'}마이데이터 분석 완료</Text>
          <Text style={styles.subtitle}>최근 3개월 결제 내역을 바탕으로{'\n'}소비 패턴을 완벽히 파악했어요.</Text>
        </View>

        {/* 핵심 소비 성향 요약 카드 */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>가장 많이 소비한 분야</Text>
          <Text style={styles.summaryHighlight}>식비와 교통비 비중이 매우 높아요!</Text>
          <Text style={styles.summaryDesc}>
            주로 컴포즈커피, 맘스터치 등 식음료 지출과 K-패스 대중교통 지출이 전체의 75%를 차지하고 있습니다. 짐박스 등 건강/운동 분야 지출도 꾸준하네요.
          </Text>
        </View>

        {/* 카테고리별 지출 바 차트 (순수 UI 구현) */}
        <View style={styles.chartContainer}>
          <Text style={styles.sectionTitle}>분야별 지출 비율</Text>
          
          {/* 항목 1 */}
          <View style={styles.chartRow}>
            <Text style={styles.chartLabel}>🍔 식비/카페</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, { width: '45%', backgroundColor: '#2b65f0' }]} />
            </View>
            <Text style={styles.chartValue}>45%</Text>
          </View>

          {/* 항목 2 */}
          <View style={styles.chartRow}>
            <Text style={styles.chartLabel}>🚌 교통/이동</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, { width: '30%', backgroundColor: '#4b85f0' }]} />
            </View>
            <Text style={styles.chartValue}>30%</Text>
          </View>

          {/* 항목 3 */}
          <View style={styles.chartRow}>
            <Text style={styles.chartLabel}>🏋️ 건강/운동</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, { width: '15%', backgroundColor: '#7ba5f0' }]} />
            </View>
            <Text style={styles.chartValue}>15%</Text>
          </View>
          
          {/* 항목 4 */}
          <View style={styles.chartRow}>
            <Text style={styles.chartLabel}>🛍️ 기타/쇼핑</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, { width: '10%', backgroundColor: '#d0d8f0' }]} />
            </View>
            <Text style={styles.chartValue}>10%</Text>
          </View>
        </View>

        {/* AI 최적 카드 추천은 추후 챗봇에서 제공할 예정입니다. */}

      </ScrollView>

      {/* 하단 고정 다음 단계 버튼 */}
      <View style={styles.bottomFixed}>
        <TouchableOpacity style={styles.primaryBtn} onPress={onNext}>
          <Text style={styles.primaryBtnText}>분석 완료 · 홈으로 이동</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f7fb' },
  
  header: { paddingHorizontal: 25, paddingTop: 40, paddingBottom: 20 },
  titleIcon: { fontSize: 32, marginBottom: 10 },
  title: { fontSize: 26, fontWeight: '800', color: '#111', lineHeight: 36, marginBottom: 10 },
  subtitle: { fontSize: 15, color: '#666', lineHeight: 22 },

  summaryCard: { backgroundColor: '#fff', marginHorizontal: 20, borderRadius: 20, padding: 25, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, marginBottom: 25 },
  summaryLabel: { fontSize: 13, color: '#2b65f0', fontWeight: 'bold', marginBottom: 8 },
  summaryHighlight: { fontSize: 18, fontWeight: 'bold', color: '#111', marginBottom: 12 },
  summaryDesc: { fontSize: 14, color: '#555', lineHeight: 22 },

  chartContainer: { backgroundColor: '#fff', marginHorizontal: 20, borderRadius: 20, padding: 25, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, marginBottom: 25 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#111', marginBottom: 20 },
  
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  chartLabel: { width: 95, fontSize: 13, color: '#444', fontWeight: '600' },
  barBackground: { flex: 1, height: 12, backgroundColor: '#f0f0f0', borderRadius: 6, overflow: 'hidden', marginHorizontal: 10 },
  barFill: { height: '100%', borderRadius: 6 },
  chartValue: { width: 35, fontSize: 13, color: '#888', textAlign: 'right', fontWeight: 'bold' },

  benefitContainer: { flexDirection: 'row', marginHorizontal: 20, justifyContent: 'space-between' },
  benefitBox: { flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 20, marginHorizontal: 5, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2 },
  benefitIcon: { fontSize: 28, marginBottom: 10 },
  benefitText: { fontSize: 13, color: '#333', textAlign: 'center', fontWeight: '600', lineHeight: 18 },

  bottomFixed: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#fff', paddingHorizontal: 20, paddingTop: 15, paddingBottom: 35, borderTopWidth: 1, borderTopColor: '#eee' },
  primaryBtn: { backgroundColor: '#2b65f0', borderRadius: 14, paddingVertical: 18, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});