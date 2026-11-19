import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function FlowHeading({children, icon, brand = false}) {
  if (brand) {
    return (
      <View style={styles.hero}>
        <Text style={styles.wordmark}>SOL·Pay</Text>
        <View style={styles.halo} accessible={false}>
          <View style={styles.medallion}>
            <Ionicons name={icon} size={30} color="#104FE7" />
          </View>
        </View>
        <Text accessibilityRole="header" style={[styles.title, styles.centered]}>{children}</Text>
      </View>
    );
  }
  return <View style={styles.header}>
    <View style={styles.symbol}><Ionicons name={icon} size={23} color="#1557D8" /></View>
    <Text accessibilityRole="header" style={styles.title}>{children}</Text>
  </View>;
}
const styles = StyleSheet.create({
  hero: {alignSelf: 'stretch', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 16},
  wordmark: {fontSize: 24, fontWeight: '900', letterSpacing: -0.9, color: '#104FE7'},
  halo: {width: 76, height: 76, borderRadius: 38, backgroundColor: '#E5EEFF', alignItems: 'center', justifyContent: 'center'},
  medallion: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  centered: {textAlign: 'center'},
  header:{alignSelf:'stretch',gap:12,paddingVertical:12,alignItems:'flex-start'},
  symbol:{width:44,height:44,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:'#E6EFFF'},
  title:{fontSize:30,lineHeight:39,letterSpacing:-1.2,fontWeight:'800',color:'#101F3A'}
});
