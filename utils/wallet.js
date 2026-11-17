// MYDATA_WALLET_LINK_V1
import {mergeImportedWallet, getMyDataSnapshot, restoreMyData} from './myDataService';
import * as Store from './demoStore';
import { DEMO_WALLET_CARDS } from '../data/cards';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';
import { readPreferences } from './cardRecommendation';

export const WALLET_SELECTION_KEY = 'solpay_wallet_selection_v1';

let pendingWrite = Promise.resolve();

export const walletIdForCode = code =>
  code === 'SH_SOLMATE_SOL_PLAN_CHECK' ? 'solmate' : code;

export function buildWallet(preferences) {
  const registered = [...new Set(preferences.owned)].flatMap(code => {
    const card = CSV_CARD_CATALOG.find(item => item.code === code);
    if (!card) return [];

    const id = walletIdForCode(code);
    const existing = DEMO_WALLET_CARDS.find(item => item.id === id);

    return [{
      ...existing,
      ...card,
      id,
      catalogCode: code,
      image: CARD_PRODUCTS[code]?.image || existing?.image,
      number: '직접 등록 · DEMO',
      color: card.issuer.includes('KB') ? '#FFCA4B' : '#1459F5',
      textColor: card.issuer.includes('KB') ? '#263041' : '#FFFFFF',
      isOwned: true,
      isDemoOwned: true,
      isManuallyRegistered: true,
      isRecommendedOnly: false,
      category: '직접 등록한 보유 카드 · 결제 시연용',
      reason:
        '상품명으로 직접 등록한 카드입니다. 실제 보유 인증이나 실물 카드 등록은 아닙니다.',
    }];
  });

  const ids = new Set(registered.map(card => card.id));

  return mergeImportedWallet([
    ...registered,
    ...DEMO_WALLET_CARDS.filter(card => !ids.has(card.id)),
  ], getMyDataSnapshot());
}

export function validWalletId(cards, id) {
  const candidate = walletIdForCode(id);

  return cards.some(card => card.id === candidate)
    ? candidate
    : cards[0].id;
}

export function saveWalletSelection(id) {
  const operation = pendingWrite
    .catch(() => {})
    .then(() =>
      Store.setItemAsync(
        WALLET_SELECTION_KEY,
        JSON.stringify({ version: 1, id })
      )
    );

  pendingWrite = operation;
  return operation;
}

export async function waitForWalletWrites() {
  await pendingWrite.catch(() => {});
}

export async function readWallet() {
  await waitForWalletWrites();

  await restoreMyData();
  const preferences = await readPreferences();
  const cards = buildWallet(preferences);

  let id = cards[0].id;
  let warning = '';

  try {
    const raw = await Store.getItemAsync(WALLET_SELECTION_KEY);

    if (raw) {
      const value = JSON.parse(raw);

      if (value?.version !== 1 || typeof value.id !== 'string') {
        throw Error('invalid');
      }

      id = validWalletId(cards, value.id);
    }
  } catch {
    warning =
      '마지막 선택 카드를 읽지 못했습니다. 사용할 카드를 다시 선택해주세요.';
  }

  return { cards, id, warning, preferences };
}