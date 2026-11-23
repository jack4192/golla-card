// Official brand images, bundled so the popup can render offline.
export const PROMOTION_BRANDS = {
  '메가MGC커피': {
    image: require('../assets/promotion-logos/mega.png'),
    source: 'https://www.mega-mgccoffee.com/about/bi/',
    background: '#FFF3B5',
  },
  '온라인 다이소몰': {
    image: require('../assets/promotion-logos/daiso.png'),
    source: 'https://www.daiso.co.kr/company/bi',
    background: '#FFF4F4',
  },
  '해피오더': {
    image: require('../assets/promotion-logos/happyorder.png'),
    source: 'https://apps.apple.com/kr/app/id1476336782',
    background: '#FFF1F4',
  },
  '유튜브 프리미엄': {
    image: require('../assets/promotion-logos/youtube-premium.png'),
    source: 'https://www.youtube.com/premium',
    background: '#FFFFFF',
  },
  'W컨셉(앱/웹)': {
    image: require('../assets/promotion-logos/wconcept.png'),
    source: 'https://www.wconcept.co.kr/',
    background: '#F4F4F5',
  },
};

export function selectDailyPromotion(items, now = Date.now()) {
  if (!items.length) return null;
  const day = Math.floor((now + 9 * 60 * 60 * 1000) / 86400000);
  // Start the rotation from the demo data's first review date.
  const firstDay = Date.UTC(2026, 10, 18) / 86400000;
  const index = ((day - firstDay) % items.length + items.length) % items.length;
  return items[index] ?? null;
}
