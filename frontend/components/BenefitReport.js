import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export const benefitFontFamily = Platform.select({
  web: '"Pretendard", "Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif',
  ios: 'System',
  android: 'sans-serif',
});

export default function BenefitReport({offers, date}) {
  const active = offers.filter(offer => offer.start <= date && offer.end >= date).length;
  return <View style={s.report}>
    <View style={s.hero}>
      <View style={{flex:1}}>
        <Text style={s.heading}>지금 확인할 수 있는 혜택</Text>
        <Text style={s.total}>{active}<Text style={s.unit}>건</Text></Text>
        <Text style={s.caption}>진행 기간 기준</Text>
      </View>
      <View style={s.symbol}><Ionicons name="pricetags-outline" size={30} color="#1854DC"/></View>
    </View>
  </View>;
}
const s=StyleSheet.create({
  report:{gap:14},
  hero:{backgroundColor:'#EAF2FF',borderRadius:24,padding:20,flexDirection:'row',alignItems:'center',gap:12},
  heading:{fontFamily:benefitFontFamily,fontSize:16,lineHeight:24,fontWeight:'600',color:'#142747'},
  total:{fontFamily:benefitFontFamily,fontSize:46,letterSpacing:-1,lineHeight:58,fontWeight:'700',fontVariant:['tabular-nums'],color:'#114FD7'},
  unit:{fontSize:21,fontWeight:'500',letterSpacing:0},
  caption:{fontFamily:benefitFontFamily,fontSize:12,lineHeight:18,color:'#536784'},
  symbol:{width:62,height:62,borderRadius:20,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
});
