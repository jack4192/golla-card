import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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
  heading:{fontSize:17,fontWeight:'800',color:'#142747'},
  total:{fontSize:49,letterSpacing:-2,lineHeight:60,fontWeight:'800',color:'#114FD7'},
  unit:{fontSize:24,letterSpacing:0},
  caption:{fontSize:12,lineHeight:18,color:'#536784'},
  symbol:{width:62,height:62,borderRadius:20,backgroundColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},
});
