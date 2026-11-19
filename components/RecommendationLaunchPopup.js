import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { selectDailyPromotion } from '../data/promotionBrands';
import PromotionOffer from './PromotionOffer';
import RoutineRecommendationScreen from '../screens/RoutineRecommendationScreen';
import { hideAdForSevenDays, takeAutomaticAd } from '../utils/recommendationPopup';

export default function RecommendationLaunchPopup({
  enabled, allowAutomaticAds, includeMyData, openRequest, promotions, onViewPromotions
}) {
  const [ad, setAd] = useState(null);
  const [foreground, setForeground] = useState(!AppState.currentState || AppState.currentState === 'active');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lastRequest = useRef(openRequest);
  const lock = useRef(false);
  const hasPromotion = promotions.length > 0;
  const kind = ad?.kind;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let current = true;
    if (!enabled || !foreground || kind || saving) return;
    if (openRequest && lastRequest.current !== openRequest) {
      lastRequest.current = openRequest;
      setAd({ kind: openRequest.kind, automatic: false });
      return;
    }
    if (!allowAutomaticAds) return;
    takeAutomaticAd(hasPromotion, () => current).then(ready => {
      if (current && ready) setAd({ kind: ready, automatic: true });
    }).catch(() => {});
    return () => { current = false; };
  }, [enabled, allowAutomaticAds, hasPromotion, foreground, kind, saving, openRequest]);

  useEffect(() => {
    if (!enabled || !foreground) {
      setAd(null);
      setError('');
    }
  }, [enabled, foreground]);

  const close = () => {
    if (lock.current) return;
    setAd(null);
    setError('');
  };
  const hide = async () => {
    if (!kind || lock.current) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await hideAdForSevenDays(kind);
      setAd(null);
    } catch {
      setError('숨김을 저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  };
  const shown = Boolean(kind && enabled && foreground);
  const promotion = kind === 'promotion';
  const offer = promotion ? selectDailyPromotion(promotions) : null;
  return <Modal visible={shown} transparent animationType="fade" onRequestClose={close}>
      {shown && <View style={s.overlay}>
          <View style={[s.sheet, promotion && s.promoSheet]}>
            <View style={s.header}>
              <Text style={s.title}>
                {promotion ? '오늘의 프로모션' : '오늘의 카드 추천'}
              </Text>

              <TouchableOpacity accessibilityRole="button" accessibilityLabel={promotion ? "프로모션 팝업 닫기" : "추천 팝업 닫기"} disabled={saving} onPress={close} style={s.close}>
                <Text style={s.link}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={s.content}>
              {promotion ? <ScrollView contentContainerStyle={s.promoBody}>
                {offer ? <PromotionOffer offer={offer} /> : <Text style={s.promoText}>현재 진행 중인 이벤트가 없어요.</Text>}
                <TouchableOpacity accessibilityRole="button" onPress={() => {close();onViewPromotions();}} style={s.hide}>
                  <Text style={s.link}>혜택 둘러보기</Text>
                </TouchableOpacity>
              </ScrollView> : <RoutineRecommendationScreen
                presentation={ad.automatic ? 'card-ad' : 'popup'}
                onNext={close}
                includeMyData={includeMyData}
              />}
            </View>

            <View style={s.footer}>
              {!!error && <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>}

              <View style={s.row}>
                <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={hide} style={[s.hide, saving && s.dim]}>
                  {saving ? <ActivityIndicator color="#245DE5" /> : <Text style={s.link}>
                      7일간 보지 않기
                    </Text>}
                </TouchableOpacity>

                <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={close} style={[s.done, saving && s.dim]}>
                  <Text style={s.white}>닫기</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>}
    </Modal>;
}
const s = StyleSheet.create({
  promoSheet: {height:'72%',maxHeight:600},
  promoBody: {gap:12,padding:18},
  promoText: {fontSize:13,lineHeight:20,color:'#526783'},
  overlay: {
    flex: 1,
    backgroundColor: '#0008',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12
  },
  sheet: {
    width: '100%',
    maxWidth: 600,
    height: '92%',
    backgroundColor: "#F4F7FB",
    borderRadius: 28,
    overflow: 'hidden'
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 22,
    backgroundColor: "#FFFFFF"
  },
  title: {
    fontSize: 14,
    fontWeight: "800",
    color: "#142D4E",
    lineHeight: 23
  },
  close: {
    padding: 18
  },
  content: {
    flex: 1,
    minHeight: 0
  },
  footer: {
    padding: 16,
    paddingBottom: 26,
    backgroundColor: "#FFFFFF",
    gap: 10
  },
  row: {
    flexDirection: 'row',
    gap: 10
  },
  hide: {
    flex: 1,
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#EDF3FF",
    alignItems: 'center',
    minHeight: 48,
    justifyContent: "center"
  },
  done: {
    padding: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: "#245DE5",
    minHeight: 48,
    justifyContent: "center"
  },
  link: {
    color: "#245DE5",
    fontSize: 13,
    fontWeight: "700"
  },
  white: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 15
  },
  error: {
    fontSize: 13,
    lineHeight: 22,
    color: "#C53D56"
  },
  dim: {
    opacity: 0.4
  }
});
