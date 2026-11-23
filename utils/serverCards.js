// 서버 모드에서 '내 카드'를 백엔드와 맞추는 도우미
//
// 서버의 카드 상품 코드(cardCode)는 DB의 숫자 번호(cards.card_id, 예: "13")이고,
// 앱은 내장 카드 데이터의 코드(예: "SH_SOLMATE_SOL_PLAN_CHECK")로 화면을 그립니다.
// 그래서 카드 이름으로 둘을 짝지어 쓰고, 이름이 안 맞으면 내장 데이터의 id(같은 원본 데이터의 번호)로 짝짓습니다.
import { api, ApiError } from './api';
import { CSV_CARD_CATALOG } from '../data/cardCatalogCsv';

const walletIdForCode = code => (code === 'SH_SOLMATE_SOL_PLAN_CHECK' ? 'solmate' : code);

// 띄어쓰기·괄호·기호·대소문자 차이를 무시하고 비교합니다.
const normalizeName = value => String(value || '')
  .toLowerCase()
  .replace(/[\s()[\]{}·・\-_.,+]/g, match => (match === '+' ? 'plus' : ''));

const withoutIssuer = value => normalizeName(value).replace(/^(신한카드|신한|kb국민카드|kb국민|kb)/, '');

let productIndex = null; // { appCodeByServer: Map, serverByAppCode: Map }

function matchAppCode(product) {
  const name = normalizeName(product?.name);
  const short = withoutIssuer(product?.name);
  const byName =
    CSV_CARD_CATALOG.find(card => normalizeName(card.name) === name) ||
    (short && CSV_CARD_CATALOG.find(card => withoutIssuer(card.name) === short));
  if (byName) return byName.code;
  const byId = CSV_CARD_CATALOG.find(card => String(card.id) === String(product?.cardCode));
  return byId?.code ?? null;
}

function indexProducts(products) {
  const appCodeByServer = new Map();
  const serverByAppCode = new Map();
  for (const product of Array.isArray(products) ? products : []) {
    const appCode = matchAppCode(product);
    if (!appCode || serverByAppCode.has(appCode)) continue;
    appCodeByServer.set(String(product.cardCode), appCode);
    serverByAppCode.set(appCode, String(product.cardCode));
  }
  return { appCodeByServer, serverByAppCode };
}

async function loadProductIndex() {
  if (!productIndex) productIndex = indexProducts(await api.cardProducts());
  return productIndex;
}

// 지갑에서 쓰는 카드 id(walletId) → 서버 userCardId (마지막으로 불러온 목록 기준)
let userCardIdByWalletId = new Map();
let serverOrder = [];

/**
 * 서버의 내 카드 목록을 읽어 앱 형식으로 바꿉니다.
 * @returns {{ owned: string[], orderIds: string[], unmatched: number }}
 *   owned: 앱 카드 코드(서버 순서대로), orderIds: 결제 카드 순서용 지갑 id, unmatched: 앱 데이터에 없는 카드 수
 */
export async function fetchServerWallet() {
  const [index, cards] = await Promise.all([loadProductIndex(), api.myCards()]);
  const sorted = [...(Array.isArray(cards) ? cards : [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const owned = [];
  const nextMap = new Map();
  let unmatched = 0;

  for (const card of sorted) {
    const appCode = index.appCodeByServer.get(String(card.cardCode)) ?? matchAppCode(card);
    if (!appCode || owned.includes(appCode)) {
      unmatched += 1;
      continue;
    }
    owned.push(appCode);
    nextMap.set(walletIdForCode(appCode), card.userCardId);
  }

  userCardIdByWalletId = nextMap;
  serverOrder = sorted.map(card => card.userCardId);
  return { owned, orderIds: owned.map(walletIdForCode), unmatched };
}

/** 앱 카드 코드로 서버에 카드를 등록합니다. 이미 등록돼 있으면 그대로 둡니다. */
export async function registerServerCard(appCode) {
  const index = await loadProductIndex();
  const serverCode = index.serverByAppCode.get(appCode);
  if (!serverCode) {
    throw new ApiError('서버에서 이 카드 상품을 찾지 못했어요. 잠시 후 다시 시도해주세요.', 404, 'CARD_NOT_FOUND');
  }
  try {
    await api.registerCard(serverCode);
  } catch (error) {
    if (error?.status !== 409) throw error;
  }
}

/**
 * 결제 카드 순서를 서버에 저장합니다.
 * 서버는 내 카드 전체를 빠짐없이 받아야 해서, 앱에 안 보이는 카드는 원래 순서대로 뒤에 붙입니다.
 */
export async function saveServerCardOrder(walletIds) {
  const ordered = walletIds
    .map(id => userCardIdByWalletId.get(String(id)))
    .filter(id => id !== undefined);
  const rest = serverOrder.filter(id => !ordered.includes(id));
  const userCardIds = [...new Set([...ordered, ...rest])];
  if (!userCardIds.length) return;
  await api.reorderCards(userCardIds);
}

/** 로그아웃·계정 변경 시 이전 계정의 카드 정보를 비웁니다. */
export function resetServerCards() {
  userCardIdByWalletId = new Map();
  serverOrder = [];
}
