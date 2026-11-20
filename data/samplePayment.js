import { CARD_CATALOG_40 } from './cardCatalog40';

const sampleCards = entries => entries.map(([code, previousSpend]) => {
  const product = CARD_CATALOG_40.find(card => card.code === code);
  return {
    ...product,
    id: 'sample-' + code,
    catalogCode: code,
    isOwned: true,
    status: { previousSpend },
  };
});

const commuteCards = sampleCards([['DB40_30', 710000], ['KB_GOODDAY', 740000]]);

export const SCHEDULE_SAMPLES = [
  {
    id: 'convenience', caption: '편의점', title: '편의점', start: '18:00', end: '19:00',
    category: 'convenience', cards: sampleCards([['DB40_24', 911200], ['KB_NORI2_CHECK', 737900]]),
  },
  {
    id: 'early-commute', caption: '30대 예시', title: '출근 지하철', start: '07:00', end: '08:00',
    category: 'transport', cards: commuteCards,
  },
  {
    id: 'late-commute', caption: '40대 예시', title: '출근 택시', start: '09:00', end: '10:00',
    category: 'taxi', cards: commuteCards,
  },
];
