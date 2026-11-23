// 카드 탭의 카드 상품 목록. 서버 모드에서는 백엔드(/api/card-products)에서 읽고, 데모 모드이거나 읽지 못하면 앱 데이터(40장)를 쓴다.
import { useEffect, useState } from 'react';
import { API_BASE_URL, SERVER_MODE, api } from './api';
import { CARD_CATALOG_40 } from '../data/cardCatalog40';
import { toCatalogBenefits, toCatalogCard } from './serverCatalogCore';

let cached = null;   // 한 번 읽으면 앱을 다시 열 때까지 쓴다

export async function loadServerCatalog() {
  if (cached) return cached;
  const list = await api.cardProducts();
  const cards = (Array.isArray(list) ? list : []).map(item => toCatalogCard(item, CARD_CATALOG_40, API_BASE_URL));
  // 검색·상세에 혜택이 필요해 상세를 함께 읽는다 (40장). 상세를 못 읽은 카드는 혜택 없이 둔다.
  await Promise.all(cards.map(card => api.cardProduct(card.serverCode)
    .then(detail => { card.benefits = toCatalogBenefits(detail); })
    .catch(() => {})));
  if (cards.length) cached = cards;
  return cards;
}

// { cards, source: 'server' | 'app' }
export function useCardCatalog() {
  const [state, setState] = useState({ cards: SERVER_MODE && cached ? cached : CARD_CATALOG_40, source: SERVER_MODE && cached ? 'server' : 'app' });
  useEffect(() => {
    if (!SERVER_MODE || cached) return undefined;
    let stopped = false;
    loadServerCatalog()
      .then(cards => { if (!stopped && cards.length) setState({ cards, source: 'server' }); })
      .catch(() => {});
    return () => { stopped = true; };
  }, []);
  return state;
}
