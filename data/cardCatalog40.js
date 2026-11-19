import cards from './cardCatalog40.json';

const images = {
  '01.webp': require('../assets/card-catalog-40/01.webp'),
  '02.webp': require('../assets/card-catalog-40/02.webp'),
  '03.webp': require('../assets/card-catalog-40/03.webp'),
  '04.webp': require('../assets/card-catalog-40/04.webp'),
  '05.webp': require('../assets/card-catalog-40/05.webp'),
  '06.webp': require('../assets/card-catalog-40/06.webp'),
  '07.webp': require('../assets/card-catalog-40/07.webp'),
  '08.webp': require('../assets/card-catalog-40/08.webp'),
  '09.webp': require('../assets/card-catalog-40/09.webp'),
  '10.webp': require('../assets/card-catalog-40/10.webp'),
  '11.webp': require('../assets/card-catalog-40/11.webp'),
  '12.webp': require('../assets/card-catalog-40/12.webp'),
  '13.webp': require('../assets/card-catalog-40/13.webp'),
  '14.webp': require('../assets/card-catalog-40/14.webp'),
  '15.webp': require('../assets/card-catalog-40/15.webp'),
  '16.webp': require('../assets/card-catalog-40/16.webp'),
  '17.webp': require('../assets/card-catalog-40/17.webp'),
  '18.webp': require('../assets/card-catalog-40/18.webp'),
  '19.webp': require('../assets/card-catalog-40/19.webp'),
  '20.webp': require('../assets/card-catalog-40/20.webp'),
  '21.webp': require('../assets/card-catalog-40/21.webp'),
  '22.webp': require('../assets/card-catalog-40/22.webp'),
  '23.webp': require('../assets/card-catalog-40/23.webp'),
  '24.webp': require('../assets/card-catalog-40/24.webp'),
  '25.webp': require('../assets/card-catalog-40/25.webp'),
  '26.webp': require('../assets/card-catalog-40/26.webp'),
  '27.webp': require('../assets/card-catalog-40/27.webp'),
  '28.webp': require('../assets/card-catalog-40/28.webp'),
  '29.webp': require('../assets/card-catalog-40/29.webp'),
  '30.webp': require('../assets/card-catalog-40/30.webp'),
  '31.webp': require('../assets/card-catalog-40/31.webp'),
  '32.webp': require('../assets/card-catalog-40/32.webp'),
  '33.webp': require('../assets/card-catalog-40/33.webp'),
  '35.webp': require('../assets/card-catalog-40/35.webp'),
  '36.webp': require('../assets/card-catalog-40/36.webp'),
  '37.webp': require('../assets/card-catalog-40/37.webp'),
  '38.webp': require('../assets/card-catalog-40/38.webp'),
  '39.webp': require('../assets/card-catalog-40/39.webp'),
  '40.webp': require('../assets/card-catalog-40/40.webp'),
};

export const CARD_CATALOG_40 = cards.map(card => ({
  ...card,
  image: images[card.imageFile],
}));

export const CARD_CATALOG_40_BENEFITS = CARD_CATALOG_40.reduce(
  (count, card) => count + card.benefits.length,
  0,
);

const byCode = new Map(CARD_CATALOG_40.map(card => [card.code, card]));
const byName = new Map(CARD_CATALOG_40.map(card => [card.name, card]));

// A wallet instance ID and a database product ID represent different entities.
export function findCatalog40Product(card) {
  if (!card) return null;
  const code = card.catalogCode || card.code;
  const product = (code && byCode.get(code)) || byName.get(card.name?.trim());
  if (!product || (card.type && card.type !== product.type)) return null;
  if (card.name && card.name.trim() !== product.name) return null;
  return product;
}
