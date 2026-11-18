import React, { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CARD_CATALOG } from '../data/cards';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
export function resolveWalletProduct(card) {
  if (!card) return null;
  const code = card.catalogCode || card.code || (card.id === 'solmate' ? 'SH_SOLMATE_SOL_PLAN_CHECK' : card.id);
  const catalog = CSV_CARD_CATALOG.find(item => item.code === code) || CSV_CARD_CATALOG.find(item => item.name === card.name && (!card.type || item.type === card.type));
  if (catalog) {
    const image = CARD_PRODUCTS[catalog.code]?.image;
    return image ? {
      key: catalog.code,
      name: catalog.name,
      issuer: catalog.issuer,
      image
    } : null;
  }
  const pdf = CARD_CATALOG[card.id];
  return pdf?.image ? {
    key: card.id,
    name: pdf.name,
    issuer: '신한카드',
    image: pdf.image
  } : null;
}
export function WalletProductCardBody({
  card,
  product,
  onPress
}) {
  const [loading, setLoading] = useState(!!product);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const name = product?.name || card.name;
  return <View style={s.card}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={name + ' 카드로 결제 화면 열기'} activeOpacity={0.88} onPress={onPress} style={s.pressable}>
      <View style={s.artwork}>
        {product && !failed ? <Image key={attempt} source={product.image} resizeMode="contain" style={s.image} accessibilityLabel={name + ' 실제 상품 이미지'} onLoad={() => setLoading(false)} onError={() => {
          setLoading(false);
          setFailed(true);
        }} /> : <View style={s.missing}><Text style={s.missingTitle}>{failed ? '이미지를 불러오지 못했어요' : '상품 이미지 확인이 필요해요'}</Text>
            <Text style={s.hint}>{failed ? '인터넷 연결을 확인한 뒤 다시 불러와주세요.' : '정확한 상품 이미지가 등록되지 않은 카드예요.'}</Text></View>}
        {loading && !failed && <View pointerEvents="none" style={s.loading}><ActivityIndicator color="#245DE5" /></View>}
      </View>
      <Text style={s.issuer}>{product?.issuer || card.issuer}</Text>
      <Text style={s.name}>{name}</Text>
      
    </TouchableOpacity>
    {failed && <TouchableOpacity accessibilityRole="button" accessibilityLabel="지갑 카드 이미지 다시 불러오기" onPress={() => {
      setLoading(true);
      setFailed(false);
      setAttempt(value => value + 1);
    }} style={s.retry}>
      <Text style={s.link}>이미지 다시 불러오기</Text>
    </TouchableOpacity>}
  </View>;
}
export default function WalletProductCard({
  card,
  onPress
}) {
  const product = resolveWalletProduct(card);
  const identity = String(card.id) + ':' + (product?.key || 'missing') + ':' + (product?.image?.uri || 'local');
  return <WalletProductCardBody key={identity} card={card} product={product} onPress={onPress} />;
}
const s = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 440, alignSelf:'center', backgroundColor:'#FFFFFF',
    borderRadius:18, padding:12, gap:4
  },
  pressable: {
    alignItems: 'center',
    gap: 8
  },
  artwork: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1.35,
    alignItems: 'center',
    justifyContent: 'center'
  },
  image: {
    width: '100%',
    height: '100%'
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  issuer: {
    fontSize: 12,
    fontWeight: '700',
    color: "#5A6E89",
    textAlign: 'center',
    lineHeight: 20
  },
  name: {
    fontSize: 19,
    lineHeight: 28,
    fontWeight: '800',
    color: "#142D4E",
    textAlign: 'center'
  },
  hint: {
    fontSize: 13,
    lineHeight: 22,
    color: "#5A6E89",
    textAlign: 'center'
  },
  missing: {
    alignItems: 'center',
    gap: 10,
    padding: 18
  },
  missingTitle: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '700',
    color: '#627A9C',
    textAlign: 'center'
  },
  retry: {
    alignSelf: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#EDF3FF",
    minHeight: 44,
    justifyContent: 'center'
  },
  link: {
    fontSize: 13,
    fontWeight: "700",
    color: "#245DE5"
  }
});
