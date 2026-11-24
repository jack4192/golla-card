// QR 결제 창(QuickPaySheet)이 서버 결제 코드 API(2026-11-24, PR #6)를 쓸 때의 순수 도우미.
// 서버 모드: 코드 발급 → 2초마다 상태 확인(가상 POS 결제 알아채기) 또는 '이 코드로 결제(시연)' → 결과 표시.
// 테스트: node --test utils/__tests__/paymentCodeCore.test.mjs
import { SERVER_CATEGORY } from './scheduleCategory.js';

export const POLL_MS = 2000;
const DEFAULT_SECONDS = 60;

// 발급 응답 { paymentTokenId, qrPayload, barcodeNumber, expiresAt, expiresInSeconds } → 결제 창이 쓰는 코드.
// 만료는 기기 시각 + 남은 초로 정한다(기기와 서버 시계가 조금 달라도 60초를 그대로 보여 주려고).
export function codeFromServer(res, cardId, now = Date.now()) {
  const value = String(res?.barcodeNumber ?? '');
  if (!/^\d{18}$/.test(value) || res?.paymentTokenId == null) {
    throw Error('결제 코드를 받지 못했어요. 다시 발급해 주세요.');
  }
  const seconds = Number(res.expiresInSeconds) > 0 ? Number(res.expiresInSeconds) : DEFAULT_SECONDS;
  return { value, tokenId: res.paymentTokenId, cardId, expiresAt: now + seconds * 1000, server: true };
}

const orZero = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// 앱 결제 응답(PosPaymentResponse) → 결과 표시. 거절이면 null.
export function receiptFromPayment(res) {
  if (!res?.approved) return null;
  const benefitAmount = orZero(res.benefitAmount);
  const promotionAmount = orZero(res.promotionAmount);
  return {
    paymentId: res.paymentId ?? null,
    merchantName: res.merchantName || '가맹점',
    amount: orZero(res.amount),
    benefitName: res.benefitName || null,
    benefitAmount,
    promotionName: res.promotionName || null,
    promotionAmount,
    totalDiscount: res.totalDiscount != null ? orZero(res.totalDiscount) : benefitAmount + promotionAmount,
    approvalNo: res.approvalNo || null,
    paidAt: res.paidAt || null,
  };
}

// 다른 기기(가상 POS)에서 결제된 경우: 최근 결제 목록에서 그 결제를 찾아 결과로 바꾼다. 못 찾으면 번호만.
export function receiptFromRecent(list, paymentId) {
  const rows = Array.isArray(list) ? list : Array.isArray(list?.items) ? list.items : [];
  const row = rows.find(item => String(item?.paymentId) === String(paymentId));
  if (!row) return { paymentId, merchantName: null, amount: null, benefitAmount: 0, promotionAmount: 0, totalDiscount: 0 };
  const benefitAmount = orZero(row.benefitAmount);
  const promotionAmount = orZero(row.promotionAmount);
  return {
    paymentId: row.paymentId,
    merchantName: row.merchantName || '가맹점',
    amount: orZero(row.amount),
    benefitName: null,
    benefitAmount,
    promotionName: null,
    promotionAmount,
    totalDiscount: benefitAmount + promotionAmount,
    approvalNo: null,
    paidAt: row.paidAt || null,
  };
}

const DECLINE_MESSAGES = {
  INVALID_FORMAT: '코드 형식이 올바르지 않아요.',
  NOT_ISSUED: '발급되지 않은 코드예요. 새 코드를 받아 주세요.',
  ALREADY_USED: '이미 결제에 쓰인 코드예요.',
  VOIDED: '취소된 코드예요. 새 코드를 받아 주세요.',
  EXPIRED: '시간이 지난 코드예요. 새 코드를 받아 주세요.',
};

export function declineMessage(reason) {
  return DECLINE_MESSAGES[reason] || '결제가 승인되지 않았어요. 새 코드를 받아 다시 시도해 주세요.';
}

// 일정에서 연 결제의 업종(앱 업종 id 또는 서버 코드) → 서버 업종 코드. 정할 수 없으면 null (서버가 아무 가맹점).
export function serverCategoryOf(category) {
  if (typeof category !== 'string' || !category) return null;
  const code = SERVER_CATEGORY[category] ?? (/^[A-Z][A-Z_]*$/.test(category) ? category : null);
  return code && code !== 'OTHER' ? code : null;
}

// 상태 확인을 할 때인지: 서버 코드가 있고, 아직 결과가 없고, 만료 전.
export function shouldPoll(code, receipt, now = Date.now()) {
  return Boolean(code?.server && code.tokenId != null && !receipt && now < code.expiresAt);
}
