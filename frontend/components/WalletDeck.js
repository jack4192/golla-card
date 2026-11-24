import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { resolveWalletProduct } from './WalletProductCard';

// 카드가 덱에서 차지하는 자리(0=맨 앞, 1·2=뒤에 겹친 카드, -1=이전 카드가 나갈 자리)에 따른 모양
const SLOTS = [-2, -1, 0, 1, 2, 3, 4];
const SLOT_STYLE = {
  translateX: [-160, -120, 0, 14, 26, 36, 40],
  translateY: [0, 0, 0, -9, -18, -27, -30],
  rotate: ['-12deg', '-8deg', '0deg', '5deg', '9deg', '13deg', '14deg'],
  opacity: [0, 0, 1, 0.55, 0.55, 0, 0],
};
const clampSlot = offset => Math.max(-2, Math.min(4, offset));

export default function WalletDeck({cards, selected, onSelect, canPay, onPay, highlight, status, onDetails}) {
  const [listOpen,setListOpen] = useState(false);
  const index = cards.findIndex(item => item.id === selected?.id);
  // 카드마다 자리 값을 가지고, 카드를 바꾸면 앞·뒤 카드가 함께 부드럽게 이동합니다.
  const slots = useRef({}).current;
  const deckCards = index < 0 ? [] : cards
    .map((card, i) => ({ card, product: resolveWalletProduct(card), offset: i - index }))
    .filter(item => item.product?.image && item.offset >= -2 && item.offset <= 4);
  deckCards.forEach(({ card, offset }) => {
    if (!slots[card.id]) slots[card.id] = new Animated.Value(clampSlot(offset));
  });
  const deckKey = deckCards.map(item => item.card.id + ':' + item.offset).join('|');
  useEffect(() => {
    deckCards.forEach(({ card, offset }) => {
      Animated.timing(slots[card.id], {
        toValue: clampSlot(offset),
        duration: 320,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    });
  }, [deckKey]);
  const move = offset => {
    const next = cards[index + offset];
    if (next) onSelect(next.id);
  };
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder:(_,g) => Math.abs(g.dx)>14 && Math.abs(g.dx)>1.5*Math.abs(g.dy),
    onPanResponderRelease:(_,g) => { if(Math.abs(g.dx)>35) move(g.dx<0?1:-1); }
  });
  if (index < 0) return <View style={styles.stage}>
    <Text style={styles.heading}>내 지갑</Text>
    <Text style={styles.caption}>등록된 카드가 없습니다</Text>
  </View>;
  const product = resolveWalletProduct(selected);
  return <View style={styles.wallet}>
    <View style={styles.stage}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{expanded:listOpen}} onPress={() => setListOpen(!listOpen)} style={styles.countButton}>
      <Text style={styles.caption}>카드 선택</Text>
      <View style={styles.countChevron}>
        <Ionicons name={listOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#BECEE9" accessible={false} />
      </View>
    </TouchableOpacity>
    {listOpen && <View style={styles.list}>{cards.map(item => <TouchableOpacity key={item.id}
      accessibilityRole="button" accessibilityState={{selected:selected.id===item.id}}
      onPress={() => {onSelect(item.id);setListOpen(false);}} style={styles.listItem}>
      <Text style={styles.action}>{item.name}{selected.id===item.id?'  ✓':''}</Text>
    </TouchableOpacity>)}</View>}
    <Text style={styles.heading}>내 지갑</Text>
    <View {...swipe.panHandlers} style={styles.deck}>
      {!product?.image && <Text style={[styles.caption, styles.frontCard]}>상품 이미지 확인 필요</Text>}
      {deckCards.map(({ card, product: item, offset }) => {
        const value = slots[card.id];
        const front = offset === 0;
        return <Animated.Image key={card.id} accessible={front} accessibilityLabel={front ? selected.name : undefined}
          source={item.image} resizeMode="contain" fadeDuration={0}
          style={[styles.image, {
            zIndex: front ? 4 : offset === 1 ? 3 : offset === 2 ? 2 : 1,
            opacity: value.interpolate({ inputRange: SLOTS, outputRange: SLOT_STYLE.opacity }),
            transform: [
              { translateX: value.interpolate({ inputRange: SLOTS, outputRange: SLOT_STYLE.translateX }) },
              { translateY: value.interpolate({ inputRange: SLOTS, outputRange: SLOT_STYLE.translateY }) },
              { rotate: value.interpolate({ inputRange: SLOTS, outputRange: SLOT_STYLE.rotate }) },
            ],
          }]} />;
      })}
    </View>
    <View style={styles.controls}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="이전 카드" disabled={index===0} onPress={() => move(-1)} style={styles.arrow}><Text style={[styles.action,index===0&&styles.dim]}>‹</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="다음 카드" disabled={index===cards.length-1} onPress={() => move(1)} style={styles.arrow}><Text style={[styles.action,index===cards.length-1&&styles.dim]}>›</Text></TouchableOpacity>
    </View>
    </View>
    <View style={styles.summary}>
      <Text style={styles.name}>{selected.name}</Text>
      {!!highlight && <TouchableOpacity accessibilityRole="button" onPress={onDetails} style={styles.highlight}>
        <Ionicons name="pricetag-outline" size={21} color="#1857D9"/>
        <Text style={styles.highlightText}>{highlight}</Text>
        <Ionicons name="chevron-forward" size={16} color="#365E94"/>
      </TouchableOpacity>}
      {status && <View style={styles.summaryRow}>
        <Ionicons name="card-outline" size={20} color="#254467"/>
        <Text style={styles.summaryLabel}>{status.month} 예시 이용액</Text>
        <Text style={styles.summaryValue}>{status.currentSpend.toLocaleString('ko-KR')}원</Text>
      </View>}
      {status?.nextThreshold != null && <View style={styles.summaryRow}>
        <Ionicons name="gift-outline" size={20} color="#254467"/>
        <Text style={styles.summaryLabel}>다음 실적까지</Text>
        <Text style={styles.summaryValue}>{status.remainingToNext.toLocaleString('ko-KR')}원</Text>
      </View>}
      <TouchableOpacity accessibilityRole="button" disabled={!canPay} onPress={onPay} style={[styles.pay,!canPay&&styles.dim]}><Text style={styles.action}>{canPay?'선택한 카드로 결제':'결제에 사용할 수 없는 카드'}</Text></TouchableOpacity>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  list:{padding:8,borderRadius:12,backgroundColor:'#192F56'},
  listItem:{minHeight:44,justifyContent:'center',paddingHorizontal:10},
  countButton:{alignSelf:'flex-start',minHeight:44,flexDirection:'row',alignItems:'center',gap:6},
  countChevron:{width:20,height:20,alignItems:'center',justifyContent:'center'},
  controls:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:16},
  arrow:{minWidth:44,minHeight:44,alignItems:'center',justifyContent:'center',backgroundColor:'#1D345D',borderRadius:22},
  dim:{opacity:0.4},
  stage:{backgroundColor:'#0B1940',borderRadius:28,padding:18,gap:4,overflow:'hidden'},
  caption:{color:'#BECEE9',fontSize:14}, heading:{color:'white',fontWeight:'800',fontSize:30},
  deck:{height:174,marginTop:16,alignItems:'center',justifyContent:'center'},
  image:{position:'absolute',width:'76%',maxWidth:300,height:168},
  frontCard:{zIndex:1},
  wallet:{backgroundColor:'#0B1940',borderRadius:26,overflow:'hidden'},
  summary:{backgroundColor:'#FFFFFF',borderTopLeftRadius:25,borderTopRightRadius:25,borderColor:'#E1E9F5',borderWidth:1,padding:18,gap:12},
  name:{fontSize:20,color:'#13223C',fontWeight:'800'},
  highlight:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48,padding:10,backgroundColor:'#EAF2FF',borderRadius:12},
  highlightText:{flex:1,fontSize:14,color:'#183B73',fontWeight:'700'},
  summaryRow:{flexDirection:'row',alignItems:'center',gap:9,minHeight:44},
  summaryLabel:{flex:1,fontSize:13,color:'#354C6F'},
  summaryValue:{fontSize:15,color:'#13223C',fontWeight:'800'},
  pay:{minHeight:50,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#1855EB'},
  action:{color:'white',fontSize:16,fontWeight:'700'}
});
