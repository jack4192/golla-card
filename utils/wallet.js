// MYDATA_WALLET_LINK_V1
import { isMyDataSampleCardId } from './myDataService';
import * as Store from './demoStore';
import { CARD_CATALOG } from '../data/cards';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { readPreferences, savePreferences } from './cardRecommendation';
import { SERVER_MODE } from './api';
import { fetchServerWallet, saveServerCardOrder } from './serverCards';

export const WALLET_SELECTION_KEY = 'solpay_wallet_selection_v1';
export const CARD_ORDER_KEY = 'solpay_payment_card_order_v1';
const sampleIds = new Set(['shinhan', 'kb', 'kpass', ...Object.keys(CARD_CATALOG)]);

let pendingWrite = Promise.resolve();

export const walletIdForCode = code =>
  code === 'SH_SOLMATE_SOL_PLAN_CHECK' ? 'solmate' : code;

export function buildWallet(preferences) {
  return [...new Set(preferences.owned)].flatMap(code => {
    const card = CSV_CARD_CATALOG.find(item => item.code === code);
    if (!card) return [];

    const id = walletIdForCode(code);
    return [{
      ...card,
      id,
      catalogCode: code,
      image: CARD_CATALOG[id]?.image ?? CARD_PRODUCTS[code]?.image,
      number: '직접 등록',
      color: card.issuer.includes('KB') ? '#FFCA4B' : '#1459F5',
      textColor: card.issuer.includes('KB') ? '#263041' : '#FFFFFF',
      isOwned: true,
      isManuallyRegistered: true,
      isRecommendedOnly: false,
      category: '직접 등록한 카드',
      reason:
        '상품명으로 직접 등록한 카드입니다. 실제 보유 인증이나 실물 카드 등록은 아닙니다.',
    }];
  });
}

export const canRegisterWalletCard = code => CSV_CARD_CATALOG.some(card => card.code === code);

export function validWalletId(cards, id) {
  const candidate = walletIdForCode(id);

  return cards.some(card => card.id === candidate)
    ? candidate
    : cards[0]?.id ?? null;
}

function queueWalletWrite(action) {
  const operation = pendingWrite
    .catch(() => {})
    .then(action);

  pendingWrite = operation;
  return operation;
}

export function saveWalletSelection(id) {
  return queueWalletWrite(() => id == null
    ? Store.deleteItemAsync(WALLET_SELECTION_KEY)
    : Store.setItemAsync(WALLET_SELECTION_KEY, JSON.stringify({ version: 1, id })));
}

export function saveWalletCardOrder(value) {
  return queueWalletWrite(async () => {
    await Store.setItemAsync(CARD_ORDER_KEY, JSON.stringify(value));
    // 서버 모드: 바뀐 순서를 서버에도 저장합니다. 실패하면 화면에 오류를 보여줄 수 있게 그대로 던집니다.
    if (SERVER_MODE) await saveServerCardOrder(value.ids);
  });
}

// 서버 모드: 서버의 내 카드 목록으로 기기의 보유 카드·결제 카드 순서를 맞춥니다.
async function syncFromServer(preferences) {
  const server = await fetchServerWallet();
  let next = preferences;
  if (server.owned.join('|') !== preferences.owned.join('|')) {
    next = await savePreferences({ ...preferences, owned: server.owned });
  }
  await Store.setItemAsync(CARD_ORDER_KEY, JSON.stringify({ version: 1, ids: server.orderIds }));
  return {
    preferences: next,
    warning: server.unmatched
      ? `서버에 등록된 카드 중 ${server.unmatched}장은 앱에서 보여줄 수 없는 상품이라 빠졌어요.`
      : '',
  };
}

export async function waitForWalletWrites() {
  await pendingWrite.catch(() => {});
}

export function readWallet() {
  return queueWalletWrite(async () => {
    let preferences = await readPreferences();
    let serverWarning = '';
    if (SERVER_MODE) {
      try {
        ({ preferences, warning: serverWarning } = await syncFromServer(preferences));
      } catch (error) {
        serverWarning = '서버에서 내 카드를 불러오지 못해 이 기기에 저장된 카드를 보여드려요. ' + (error?.message || '');
      }
    }
    const cards = buildWallet(preferences);
    const registeredIds = new Set(cards.map(card => card.id));
    const isObsoleteSample = id => !registeredIds.has(walletIdForCode(id)) &&
      (sampleIds.has(id) || isMyDataSampleCardId(id));

    let id = cards[0]?.id ?? null;
    let warning = '';

    try {
      const raw = await Store.getItemAsync(WALLET_SELECTION_KEY);

      if (raw) {
        const value = JSON.parse(raw);

        if (value?.version !== 1 || typeof value.id !== 'string') {
          throw Error('invalid');
        }

        id = validWalletId(cards, value.id);
        if (isObsoleteSample(value.id)) await Store.deleteItemAsync(WALLET_SELECTION_KEY);
      }
    } catch {
      warning = '마지막 선택 카드를 읽지 못했습니다. 사용할 카드를 다시 선택해주세요.';
    }

    try {
      const order = JSON.parse(await Store.getItemAsync(CARD_ORDER_KEY));
      if (order?.version === 1 && Array.isArray(order.ids) && order.ids.every(cardId => typeof cardId === 'string')) {
        const kept = order.ids.filter(cardId => !isObsoleteSample(cardId));
        if (kept.length !== order.ids.length) {
          await Store.setItemAsync(CARD_ORDER_KEY, JSON.stringify({ ...order, ids: kept }));
        }
      }
    } catch {
      // Let the existing card-order screen handle unreadable records.
    }

    return { cards, id, warning: warning || serverWarning, preferences };
  });
}
