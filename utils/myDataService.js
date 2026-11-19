
import * as Store from './demoStore';
import fixtures from '../data/myDataFixture.json';
import { findCatalog40Product } from '../data/cardCatalog40';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';
import { CARD_PRODUCTS } from '../data/cardRecommendationProducts';

export const MYDATA_KEY = 'solpay_mydata_import_v1';
const profileLabel = label => label.replace(/데모/g, '예시');

export const DEMO_USERS = Object.values(fixtures).map(
  snapshot => ({
    id: snapshot.userId,
    label: profileLabel(snapshot.label),
  })
);

const listeners = new Set();
let snapshot = null;
let restored = false;
let queue = Promise.resolve();

const normalize = value =>
  String(value || '')
    .toUpperCase()
    .replace(
      /신한카드|KB국민카드|KB국민|NH농협카드|하나카드|롯데카드|BC카드|신한|카드|신용|체크|[\s()·]/g,
      ''
    );

function hydrate(id) {
  const raw = fixtures[id];

  if (!raw) {
    throw Error('선택한 예시 내역을 찾지 못했어요.');
  }

  return {
    ...raw,
    label: profileLabel(raw.label),
    cards: raw.cards.map(card => {
      const product = findCatalog40Product(card);
      const matches = CSV_CARD_CATALOG.filter(
        old =>
          normalize(old.name) === normalize(card.name) &&
          old.type === card.type
      );

      const code =
        matches.length === 1
          ? matches[0].code
          : product?.code ?? null;

      return {
        ...card,
        number: card.number?.replace('가상 보유', '예시 카드'),
        catalogCode: code,
        image: product?.image ?? CARD_PRODUCTS[code]?.image,
        color: card.issuer.includes('KB')
          ? '#FFCA4B'
          : '#1459F5',
        textColor: card.issuer.includes('KB')
          ? '#263041'
          : '#FFFFFF',
        isOwned: true,
        isDemoOwned: true,
        isImportedMyData: true,
        isManuallyRegistered: false,
        category: '예시 내역에서 추가한 카드',
        reason:
          '예시 내역에 포함된 카드예요. 금융기관에서 조회한 정보는 제공되지 않아요.',
      };
    }),
  };
}

const emit = () =>
  listeners.forEach(listener => listener(snapshot));

const enqueue = action => {
  const job = queue.catch(() => {}).then(action);
  queue = job;
  return job;
};

export async function waitForMyDataWrites() {
  await queue.catch(() => {});
}

export const getMyDataSnapshot = () => snapshot;

export function subscribeMyData(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearMyDataMemory() {
  snapshot = null;
  restored = false;
  emit();
}

export function restoreMyData() {
  return enqueue(async () => {
    if (restored) return snapshot;

    const raw = await Store.getItemAsync(MYDATA_KEY);

    if (raw) {
      const value = JSON.parse(raw);

      if (value.version !== 1) {
        throw Error('불러오기 기록을 다시 생성해주세요.');
      }

      snapshot = hydrate(String(value.userId));
    } else {
      snapshot = null;
    }

    restored = true;
    emit();
    return snapshot;
  });
}

const yieldFrame = () =>
  new Promise(resolve => setTimeout(resolve, 0));

export function importMyData(
  userId,
  onStep = () => {},
  { isCancelled = () => false } = {}
) {
  return enqueue(async () => {
    const check = () => {
      if (isCancelled()) {
        throw Error('불러오기가 취소되었습니다.');
      }
    };

    check();
    onStep(0);
    await yieldFrame();
    check();

    const next = hydrate(String(userId));

    if (!next.cards.length) {
      throw Error('보유 카드 목록이 없습니다.');
    }

    onStep(1);
    await yieldFrame();
    check();

    if (
      next.transactionCount !==
      next.transactions.length
    ) {
      throw Error('결제내역 건수가 일치하지 않습니다.');
    }

    onStep(2);
    await yieldFrame();
    check();

    if (next.cards.some(card => !card.status)) {
      throw Error('카드 실적 정보가 누락되었습니다.');
    }

    await Store.setItemAsync(
      MYDATA_KEY,
      JSON.stringify({
        version: 1,
        userId: String(userId),
      })
    );

    snapshot = next;
    restored = true;
    emit();
    onStep(3);

    return next;
  });
}

export function mergeImportedWallet(
  existing,
  data = snapshot
) {
  if (!data) return existing;

  const names = new Set(
    data.cards.map(card =>
      normalize(card.name) + card.type
    )
  );

  return [
    ...data.cards,
    ...existing.filter(card =>
      card.isManuallyRegistered &&
      !card.isImportedMyData &&
      !names.has(normalize(card.name) + card.type)
    ),
  ];
}

export function findImportedCard(
  card,
  data = snapshot
) {
  if (!data || !card) return null;

  return data.cards.find(imported =>
    imported.id === card.id ||
    (
      imported.catalogCode &&
      imported.catalogCode ===
        (card.catalogCode || card.code)
    ) ||
    (
      normalize(imported.name) === normalize(card.name) &&
      (!card.type || card.type === imported.type)
    )
  ) || null;
}
