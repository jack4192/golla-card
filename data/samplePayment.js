import { CARD_CATALOG_40 } from './cardCatalog40';

export const SAMPLE_PAYMENT_CARDS = [
  ['DB40_24', 911200],
  ['KB_NORI2_CHECK', 737900],
].map(([code, previousSpend]) => {
  const product = CARD_CATALOG_40.find(card => card.code === code);
  return {
    ...product,
    id: 'sample-' + code,
    catalogCode: code,
    isOwned: true,
    status: { previousSpend },
  };
});
