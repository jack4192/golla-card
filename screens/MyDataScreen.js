import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import MyDataCardStatus, { useMyDataSnapshot, box, title, hint, money } from '../components/MyDataCardStatus';
function Bars({
  rows
}) {
  return rows.map((r, i) => <View key={i} style={{
    gap: 5,
    marginVertical: 7
  }}><Text style={hint}>{r.label} · {money(r.amount)} · {(r.share * 100).toFixed(1)}%</Text><View style={{
      height: 9,
      borderRadius: 5,
      backgroundColor: "#E3EAF4",
      overflow: 'hidden'
    }}><View style={{
        height: 9,
        width: Math.min(100, r.share * 100) + '%',
        backgroundColor: "#245DE5"
      }} /></View></View>);
}
export default function MyDataScreen({
  onNext
}) {
  const {
    snapshot: s,
    error,
    loading
  } = useMyDataSnapshot();
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
    }}>마이데이터 소비 분석</Text>
  {loading && <ActivityIndicator color="#245DE5" />}
  {!!error && <Text style={{
      color: '#B4374B'
    }}>{error}</Text>}
  {!loading && !s && <Text style={hint}>불러온 데이터가 없습니다. 개발자 메뉴의 마이데이터 불러오기 화면에서 먼저 데이터를 준비해주세요.</Text>}
  {s && <><View style={box}><Text style={title}>{s.label}</Text><Text style={{
          ...title,
          fontSize: 28
        }}>{money(s.total)}</Text><Text style={hint}>{s.period} · {s.transactionCount.toLocaleString('ko-KR')}건 · 자료가 있는 달 {s.coverageMonths}/6개월</Text><Text style={hint}>업종·시간·요일 비중은 모두 이 기간의 결제 금액 기준입니다. 한국 시간으로 분석했습니다. 실제 지출·절약액이 아닌 가상 데이터입니다.</Text></View>
   <View style={box}><Text style={title}>소비 업종 상위 3개</Text><Bars rows={s.topCategories} /></View>
   <View style={box}><Text style={title}>주요 소비 시간대</Text><Bars rows={s.topHours} /></View>
   <View style={box}><Text style={title}>요일별 소비 비중</Text><Bars rows={s.weekdays} /></View>
   <View style={box}><Text style={title}>월별 소비 금액</Text><Bars rows={s.months} /></View>
   <Text style={title}>자동 등록된 보유 카드 {s.cards.length}장</Text>
   {s.cards.map(c => <MyDataCardStatus key={c.id} card={c} expanded />)}
   <Text style={hint}>소비 요약은 완료된 6개월, 카드 실적은 {s.asOf}까지의 DB 기록입니다. 현재 달은 일부 기간입니다.</Text>
  </>}
  <TouchableOpacity accessibilityRole="button" disabled={!s || loading} style={{
      padding: 16,
      backgroundColor: s ? '#245DE5' : '#AAB8D0',
      borderRadius: 12,
      alignItems: 'center'
    }} onPress={() => onNext?.()}><Text style={{
        color: "#FFFFFF",
        fontWeight: '800'
      }}>다음 단계로</Text></TouchableOpacity>
 </ScrollView>;
}
