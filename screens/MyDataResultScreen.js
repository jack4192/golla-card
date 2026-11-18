import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView } from 'react-native';
export default function MyDataResultScreen({
  onNext
}) {
  return <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        
        <View style={styles.headerSection}>
          <Text style={styles.sparkle}>✨</Text>
          <Text style={styles.title}>여승범 님의{'\n'}마이데이터 분석 완료</Text>
          <Text style={styles.subtitle}>최근 3개월 결제 내역을 바탕으로{'\n'}소비 패턴을 완벽히 파악했어요.</Text>
        </View>

        {/* 카드 1: 가장 많이 소비한 분야 */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>가장 많이 소비한 분야</Text>
          <Text style={styles.cardTitle}>식비와 교통비 비중이 매우 높아요!</Text>
          <Text style={styles.cardDesc}>
            주로 컴포즈커피, 맘스터치 등 식음료 지출과 K-패스 대중교통 지출이 전체의 75%를 차지하고 있습니다. 짐박스 등 건강/운동 분야 지출도 꾸준하네요.
          </Text>
        </View>

        {/* 카드 2: 분야별 지출 비율 */}
        <View style={styles.card}>
          <Text style={styles.cardTitleBlack}>분야별 지출 비율</Text>
          
          <View style={styles.graphRow}>
            <Text style={styles.graphLabel}>🍔 식비/카페</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, {
              width: '45%'
            }]} />
            </View>
            <Text style={styles.graphPercent}>45%</Text>
          </View>
          
          <View style={styles.graphRow}>
            <Text style={styles.graphLabel}>🚌 교통/이동</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, {
              width: '30%'
            }]} />
            </View>
            <Text style={styles.graphPercent}>30%</Text>
          </View>

          <View style={styles.graphRow}>
            <Text style={styles.graphLabel}>🏋️ 건강/운동</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, {
              width: '15%'
            }]} />
            </View>
            <Text style={styles.graphPercent}>15%</Text>
          </View>

          <View style={styles.graphRow}>
            <Text style={styles.graphLabel}>🛍️ 기타/쇼핑</Text>
            <View style={styles.barBackground}>
              <View style={[styles.barFill, {
              width: '10%',
              backgroundColor: '#C7C7CC'
            }]} />
            </View>
            <Text style={styles.graphPercent}>10%</Text>
          </View>
        </View>

        {/* 카드 3 & 4: 혜택 팁 (Split) */}
        <View style={styles.tipsContainer}>
          <View style={styles.tipCard}>
            <Text style={styles.tipIcon}>💰</Text>
            <Text style={styles.tipText}>식비 특화 카드 사용 시{'\n'}월 최대 3만원 절약</Text>
          </View>
          <View style={styles.tipCard}>
            <Text style={styles.tipIcon}>🎯</Text>
            <Text style={styles.tipText}>대중교통 할인 추가 시{'\n'}연간 15만원 혜택</Text>
          </View>
        </View>
        
      </ScrollView>

      <TouchableOpacity style={styles.bottomButton} onPress={onNext}>
        <Text style={styles.bottomButtonText}>분석 완료 · 홈으로 이동</Text>
      </TouchableOpacity>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F4F7FB"
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: 22,
    paddingTop: 28,
    paddingBottom: 40,
    gap: 18
  },
  headerSection: {
    marginTop: 40,
    marginBottom: 30
  },
  sparkle: {
    fontSize: 24,
    marginBottom: 8
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 39,
    marginBottom: 12
  },
  subtitle: {
    fontSize: 14,
    color: "#5A6E89",
    lineHeight: 24
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 24,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#E3EAF4"
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: 'bold',
    color: "#245DE5",
    marginBottom: 12
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: "#142D4E",
    marginBottom: 16
  },
  cardTitleBlack: {
    fontSize: 18,
    fontWeight: 'bold',
    color: "#142D4E",
    marginBottom: 24
  },
  cardDesc: {
    fontSize: 14,
    color: "#5A6E89",
    lineHeight: 22
  },
  graphRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  graphLabel: {
    width: 90,
    fontSize: 14,
    color: "#142D4E",
    fontWeight: '500'
  },
  barBackground: {
    flex: 1,
    height: 10,
    backgroundColor: '#F0F0F0',
    borderRadius: 5,
    marginHorizontal: 12,
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    backgroundColor: "#245DE5",
    borderRadius: 5
  },
  graphPercent: {
    width: 35,
    fontSize: 14,
    color: "#5A6E89",
    textAlign: 'right'
  },
  tipsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30
  },
  tipCard: {
    width: '48%',
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3
  },
  tipIcon: {
    fontSize: 24,
    marginBottom: 12
  },
  tipText: {
    fontSize: 12,
    color: "#142D4E",
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500'
  },
  bottomButton: {
    backgroundColor: "#245DE5",
    margin: 0,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    minHeight: 54,
    padding: 16,
    justifyContent: "center",
    width: "90%",
    maxWidth: 552,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 20
  },
  bottomButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: "#FFFFFF"
  }
});
