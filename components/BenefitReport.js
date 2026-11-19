import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function BenefitReport({offers, date, data, onCardPress}) {
  const month = date.slice(0, 7);
  const weeks = [0, 0, 0, 0, 0];
  for (const offer of offers) {
    if (offer.start.startsWith(month)) weeks[Math.floor((Number(offer.start.slice(8)) - 1) / 7)]++;
  }
  const peak = Math.max(1, ...weeks);
  const active = offers.filter(offer => offer.start <= date && offer.end >= date).length;
  const eligible = (data?.cards || []).filter(card => card.status?.nextThreshold > 0);
  return <View style={s.report}>
    <View style={s.hero}>
      <View style={{flex:1}}>
        <Text style={s.heading}>지금 확인할 수 있는 혜택</Text>
        <Text style={s.total}>{active}<Text style={s.unit}>건</Text></Text>
        <Text style={s.caption}>진행 기간 기준</Text>
      </View>
      <View style={s.symbol}><Ionicons name="pricetags-outline" size={30} color="#1854DC"/></View>
    </View>
    <View style={s.panel}>
      <Text style={s.title}>주차별 혜택 시작</Text>
      <View style={s.chart}>
        {weeks.map((count,index) => <View key={index} accessible accessibilityLabel={(index+1)+'주차 '+count+'건'} style={s.column}>
          <Text style={s.number}>{count}건</Text>
          <View style={[s.bar,{height:Math.max(3,70*count/peak), backgroundColor:count===peak?'#1858E8':'#B0CDFF'}]} />
          <Text style={s.caption}>{index+1}주차</Text>
        </View>)}
      </View>
    </View>
    {eligible.length > 0 && <View style={s.progressList}>
      <Text style={s.title}>실적까지 한 걸음</Text>
      <Text style={s.caption}>예시 소비 내역 · {data.asOf?.slice(0,10)} 기준</Text>
      {eligible.map(card => {
        const progress = Math.max(0, Math.min(1, card.status.progress || 0));
        return <TouchableOpacity key={card.id} accessibilityRole="button" style={s.panel} onPress={() => onCardPress(card)}>
          <Text style={s.number}>{card.name}</Text>
          <Text style={s.caption}>{card.status.currentSpend.toLocaleString('ko-KR')}원 / {card.status.nextThreshold.toLocaleString('ko-KR')}원</Text>
          <View accessibilityLabel={'실적 '+Math.round(progress*100)+'%'} style={s.track}><View style={[s.filled,{width: Math.round(progress*100)+'%'}]}/></View>
        </TouchableOpacity>;
      })}
    </View>}
  </View>;
}
const s=StyleSheet.create({
  report:{gap:14},
  hero:{backgroundColor:'#EAF2FF',borderRadius:24,padding:20,flexDirection:'row',alignItems:'center',gap:12},
  heading:{fontSize:17,fontWeight:'800',color:'#142747'},
  total:{fontSize:49,letterSpacing:-2,lineHeight:60,fontWeight:'800',color:'#114FD7'},
  unit:{fontSize:24,letterSpacing:0},
  caption:{fontSize:12,lineHeight:18,color:'#536784'},
  symbol:{width:62,height:62,borderRadius:20,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
  panel:{padding:16,borderRadius:19,borderColor:'#E5EBF4',borderWidth:1,backgroundColor:'#FFFFFF',gap:7},
  title:{fontSize:18,fontWeight:'800',color:'#142747'},
  chart:{flexDirection:'row',alignItems:'flex-end',gap:10,marginTop:4},
  column:{flex:1,alignItems:'center',gap:5},
  bar:{width:'100%',maxWidth:54,borderTopLeftRadius:7,borderTopRightRadius:7},
  number:{fontSize:13,fontWeight:'700',color:'#142747'},
  progressList:{gap:8},
  track:{height:7,borderRadius:5,backgroundColor:'#E4EBF7',overflow:'hidden'},
  filled:{height:'100%',backgroundColor:'#1858E8'},
});