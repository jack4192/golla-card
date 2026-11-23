import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

export default function PromotionOffer({ offer }) {
  // 로고는 서버가 준다 (offer.logo = { uri }, 2026-11-23 행사 DB 이전). 없으면 그림 칸 없이 이름만
  return <View style={s.card}>
    {offer.logo && <View style={s.logoBox}>
      <Image source={offer.logo} style={s.logo} resizeMode="contain" accessibilityLabel={offer.merchant + ' 로고'} />
    </View>}
    <Text style={s.merchant}>{offer.merchant}</Text>
    <Text style={s.offer}>{offer.benefit}</Text>
    <Text style={s.detail}>{offer.method}{offer.minimum != null ? ' · ' + offer.minimum.toLocaleString('ko-KR') + '원 이상' : ''}</Text>
    {!!offer.note && <Text style={s.detail}>{offer.note}</Text>}
    <Text style={s.detail}>{offer.start} ~ {offer.end}</Text>
  </View>;
}

const s = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 18, gap: 8 },
  logoBox: { height: 144, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#F4F7FC' },
  logo: { width: '78%', maxWidth: 270, height: 102 },
  merchant: { fontSize: 15, fontWeight: '700', color: '#244874', textAlign: 'center' },
  offer: { fontSize: 20, fontWeight: '800', color: '#154EC7', textAlign: 'center' },
  detail: { fontSize: 13, lineHeight: 20, color: '#526783', textAlign: 'center' },
});
