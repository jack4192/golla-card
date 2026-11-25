import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function FlowHeading({children, icon, brand = false, compact = false}) {
  if (brand) {
    return (
      <View style={[styles.hero, compact && styles.compactHero]}>
        <Text style={[styles.wordmark, compact && styles.compactWordmark]}>Pay·Mate</Text>
        <View style={[styles.heroHeading, compact && styles.compactHeroHeading]}>
          <View style={[styles.halo, compact && styles.compactHalo]} accessible={false}>
            <View style={[styles.medallion, compact && styles.compactMedallion]}>
              <Ionicons name={icon} size={compact ? 18 : 30} color="#104FE7" />
            </View>
          </View>
          <Text accessibilityRole="header" style={[styles.title, styles.centered, compact && styles.compactTitle]}>{children}</Text>
        </View>
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
  heroHeading: {alignItems: 'center', gap: 16},
  wordmark: {fontSize: 24, fontWeight: '900', letterSpacing: -0.9, color: '#104FE7'},
  halo: {width: 76, height: 76, borderRadius: 38, backgroundColor: '#E5EEFF', alignItems: 'center', justifyContent: 'center'},
  medallion: {width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center'},
  compactHero: {paddingVertical: 2, gap: 5},
  compactWordmark: {fontSize: 18},
  compactHeroHeading: {flexDirection: 'row', gap: 8},
  compactHalo: {width: 34, height: 34, borderRadius: 17},
  compactMedallion: {width: 26, height: 26, borderRadius: 13},
  compactTitle: {fontSize: 24, lineHeight: 30},
  centered: {textAlign: 'center'},
  header:{alignSelf:'stretch',gap:12,paddingVertical:12,alignItems:'flex-start'},
  symbol:{width:44,height:44,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:'#E6EFFF'},
  title:{fontSize:30,lineHeight:39,letterSpacing:-1.2,fontWeight:'800',color:'#101F3A'}
});
