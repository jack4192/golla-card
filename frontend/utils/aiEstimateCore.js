// 결제 화면 '이 거래의 예상 혜택'을 AI 엔진 계산(/api/ai/payments/evaluate)으로 만드는 순수 함수들.
// 테스트: node --test utils/__tests__/aiEstimateCore.test.mjs
import { SERVER_CATEGORY } from './scheduleCategory.js';

const norm = value => String(value || '').replace(/\s+/g, '').toLowerCase();

// 예시 거래 → { category_code, merchant_id?, amount }. 계산할 수 없으면 null.
//   가맹점 예시(스타벅스 등): AI 가맹점 목록에서 이름이 그 브랜드로 시작하는 첫 가맹점
//   업종 예시(categoryCode): 그 업종으로
//   일정 예시(schedule.category): 앱 업종을 서버 업종으로 바꿔서 (기타·PC방은 계산하지 않음)
export function evaluateRequest(scenario, merchants = []) {
  if (!scenario?.amount) return null;
  if (scenario.schedule) {
    const code = SERVER_CATEGORY[scenario.schedule.category];
    return code && code !== 'OTHER' ? { category_code: code, amount: scenario.amount } : null;
  }
  if (scenario.namedMerchant) {
    const merchant = merchants.find(item => norm(item.name).startsWith(norm(scenario.merchant)));
    return merchant ? { category_code: merchant.category_code, merchant_id: merchant.merchant_id, amount: scenario.amount } : null;
  }
  return scenario.categoryCode ? { category_code: scenario.categoryCode, amount: scenario.amount } : null;
}

// AI 결과 { cards: [{ user_card_id, benefit, promotion, promotion_label }] } → { [지갑 카드 id]: 예상 혜택 }
//   linked: { [지갑 카드 id]: 서버 userCardId }. benefit 은 카드 혜택 + 행사를 합한 금액이다.
export function toEstimates(result, linked) {
  const byServer = new Map((Array.isArray(result?.cards) ? result.cards : []).map(card => [String(card.user_card_id), card]));
  const out = {};
  for (const [walletId, userCardId] of Object.entries(linked || {})) {
    const card = byServer.get(String(userCardId));
    if (!card) continue;
    const promo = card.promotion > 0 && card.promotion_label ? ' · ' + card.promotion_label + ' 포함' : '';
    out[walletId] = {
      value: Number(card.benefit) || 0,
      unit: 'KRW',
      name: (card.benefit > 0 ? 'AI 계산 예상 혜택' : '이 거래에 받을 혜택 없음') + promo,
      reason: '이번 달 실적·한도와 진행 중인 행사를 반영해 AI 엔진이 계산했어요.',
      condition: '',
      source: 'ai',
    };
  }
  return out;
}

// 업종별 AI 예상 혜택 → 일정에 맞는 카드 { walletId, value } (혜택이 가장 큰 카드, 0원이면 없음)
export function bestCardOf(estimates) {
  let best = null;
  for (const [walletId, row] of Object.entries(estimates || {})) {
    if (row?.value > 0 && (!best || row.value > best.value)) best = { walletId, value: row.value };
  }
  return best;
}
