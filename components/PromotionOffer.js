import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { PROMOTION_BRANDS } from '../data/promotionBrands';

export default function PromotionOffer({ offer }) {
  const brand = PROMOTION_BRANDS[offer.merchant];
  return <View style={s.card}>
    {brand && <View style={[s.logoBox, { backgroundColor: brand.background }]}>
      <Image source={brand.image} style={s.logo} resizeMode="contain" accessibilityLabel={offer.merchant + ' 로고'} />
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
  logoBox: { height: 144, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  logo: { width: '78%', maxWidth: 270, height: 102 },
  merchant: { fontSize: 15, fontWeight: '700', color: '#244874', textAlign: 'center' },
  offer: { fontSize: 20, fontWeight: '800', color: '#154EC7', textAlign: 'center' },
  detail: { fontSize: 13, lineHeight: 20, color: '#526783', textAlign: 'center' },
});
