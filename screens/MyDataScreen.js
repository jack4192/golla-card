import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import MyDataCardStatus, { useMyDataSnapshot, box, title, hint, money } from '../components/MyDataCardStatus';
function Bars({
  rows
}) {
  return rows.map((row, index) => <View key={index} style={{
    gap: 5,
    marginVertical: 7
  }}>
      <Text style={hint}>
        {row.label}
        {' · '}{money(row.amount)}
        {' · '}{(row.share * 100).toFixed(1)}%
      </Text>

      <View style={{
      height: 9,
      borderRadius: 5,
      backgroundColor: "#E3EAF4",
      overflow: 'hidden'
    }}>
        <View style={{
        height: 9,
        width: Math.min(100, row.share * 100) + '%',
        backgroundColor: "#245DE5"
      }} />
      </View>
    </View>);
}
export default function MyDataScreen({
  onNext,
  includeMyData = true
}) {
  const {
    snapshot: data,
    error,
    loading
  } = useMyDataSnapshot(includeMyData);
  return <ScrollView contentContainerStyle={{
    padding: 22,
    paddingBottom: 40,
    gap: 18,
    backgroundColor: "#F4F7FB",
    flexGrow: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingTop: 28
  }} style={{
    flex: 1,
    backgroundColor: "#F4F7FB"
  }}>
      <Text style={{
      ...title,
      fontSize: 25
    }}>
        마이데이터 소비 분석
      </Text>

      {loading && <ActivityIndicator color="#245DE5" />}

      {!!error && <Text style={{
      color: '#B4374B'
    }}>
          {error}
        </Text>}

      {!loading && !data && <Text style={hint}>
          표시할 소비 내역이 없어요.
        </Text>}

      {data && <>
          <View style={box}>
            <Text style={title}>
              {data.label}
            </Text>

            <Text style={{
          ...title,
          fontSize: 28
        }}>
              {money(data.total)}
            </Text>

            <Text style={hint}>
              {data.period}
              {' · '}
              {data.transactionCount.toLocaleString('ko-KR')}건
              {' · '}자료가 있는 달{' '}
              {data.coverageMonths}/6개월
            </Text>

            <Text style={hint}>
              업종·시간·요일 비중은 모두 이 기간의
              결제 금액 기준입니다.
              한국 시간으로 분석했습니다.
              예시 소비 내역을 바탕으로 계산한 금액이에요.
            </Text>
          </View>

          <View style={box}>
            <Text style={title}>
              소비 업종 상위 3개
            </Text>
            <Bars rows={data.topCategories} />
          </View>

          <View style={box}>
            <Text style={title}>
              주요 소비 시간대
            </Text>
            <Bars rows={data.topHours} />
          </View>

          <View style={box}>
            <Text style={title}>
              요일별 소비 비중
            </Text>
            <Bars rows={data.weekdays} />
          </View>

          <View style={box}>
            <Text style={title}>
              월별 소비 금액
            </Text>
            <Bars rows={data.months} />
          </View>

          <Text style={title}>
            자동 등록된 보유 카드 {data.cards.length}장
          </Text>

          {data.cards.map(card => <MyDataCardStatus key={card.id} card={card} expanded />)}

          <Text style={hint}>
            소비 요약은 완료된 6개월,
            카드 이용액은 예시 기록의 {data.asOf} 기준이에요.
            현재 달은 일부 기간입니다.
          </Text>
        </>}

      <TouchableOpacity accessibilityRole="button" disabled={!data || loading} style={{
      padding: 16,
      backgroundColor: data ? '#245DE5' : '#AAB8D0',
      borderRadius: 12,
      alignItems: 'center'
    }} onPress={() => onNext?.()}>
        <Text style={{
        color: "#FFFFFF",
        fontWeight: '800'
      }}>
          다음 단계로
        </Text>
      </TouchableOpacity>
    </ScrollView>;
}
