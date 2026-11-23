import { selectDailyPromotion } from './promotionBrands';

const EVENT_ROWS = [['메가MGC커피', '500 마이신한포인트 적립', null, '2026-11-01', '2026-11-30', '2026-12-13', '신한 슈퍼SOL/SOL페이 바코드 결제', '키오스크에서 바코드 스캔 필요'], ['온라인 다이소몰', '1,000 마이신한포인트 적립', 30000, '2026-11-01', '2026-11-30', '2026-12-10', '신한 슈퍼SOL/SOL페이 결제', '3만 원 이상 결제'], ['온라인 다이소몰', '500 마이신한포인트 추가 적립', null, '2026-11-16', '2026-11-30', '2026-12-10', '신한 슈퍼SOL/SOL페이 결제', '다이소데이 11월 16일 오픈. 기존 행사와 별도이며 중복 적용 여부는 확인 필요'], ['W컨셉(앱/웹)', '10,000 마이신한포인트 적립', 200000, '2026-11-01', '2026-11-30', '2026-12-16', '신한 슈퍼SOL/SOL페이 결제', '20만 원 이상 결제'], ['해피오더', '2,000원 즉시 할인', 15000, '2026-11-11', '2026-12-25', '즉시 할인', '신한 슈퍼SOL/SOL페이 결제', 'X-MAS 사전예약 제품 대상. 매일 오전 10:30부터 선착순'], ['유튜브 프리미엄', '5,000원 캐시백', null, '2026-11-01', '2026-11-30', '2027년 1월 중', '이벤트 응모 후 신규 정기 결제', '2026.05.01~10.31 결제 이력이 없는 고객 대상']];

export const PROMOTIONS = EVENT_ROWS.map((row, index) => ({
  id: `event-${index + 1}`,
  type: '이벤트',
  merchant: row[0],
  benefit: row[1],
  minimum: row[2],
  cap: null,
  start: row[3],
  end: row[4],
  payout: row[5],
  method: row[6],
  note: row[7]
}));

export function activePromotions(now = new Date()) {
  const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return PROMOTIONS.filter(offer => offer.start <= date && date <= offer.end);
}

const merchantCategory = {
  '메가MGC커피': 'cafe',
  '온라인 다이소몰': 'shopping',
  'W컨셉(앱/웹)': 'shopping',
  해피오더: 'delivery',
};

export function recommendPromotion(signals, now) {
  const offers = activePromotions(now);
  const ranked = offers.map(offer => ({
    offer,
    signal: signals.find(item => item.id === merchantCategory[offer.merchant]),
  }));
  const bestWeight = Math.max(0, ...ranked.map(item => item.signal?.weight || 0));
  const matching = ranked.filter(item => item.signal?.weight === bestWeight && bestWeight > 0);
  const offer = selectDailyPromotion(matching.length ? matching.map(item => item.offer) : offers, now.getTime());
  const reason = matching.find(item => item.offer.id === offer?.id)?.signal?.reasons[0];
  return { offer, reason };
}
