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
  if (!scenario.categoryCode) return null;
  return scenario.merchantId != null
    ? { category_code: scenario.categoryCode, merchant_id: scenario.merchantId, amount: scenario.amount }
    : { category_code: scenario.categoryCode, amount: scenario.amount };
}

// AI 배치 응답의 example(1순위 카드 문구가 가리키는 거래) → 결제 화면 예시 거래. 업종·금액이 없으면 null.
//   category·brand 는 앱 자체 계산이 혹시 불려도 아무 혜택도 맞추지 않게 하는 빈 정규식이다 (계산은 AI 로만 한다).
export function exampleScenario(example) {
  if (!example?.category_code || !example?.amount) return null;
  return {
    id: 'ai-example:' + example.category_code + ':' + (example.merchant_id ?? '') + ':' + example.amount,
    merchant: example.name || example.category_name || example.category_code,
    amount: example.amount,
    categoryCode: example.category_code,
    merchantId: example.merchant_id ?? null,
    aiExample: true,
    basis: example.basis,
    prob: example.prob,
    category: /(?!)/,
    brand: /(?!)/,
  };
}

// 예상 혜택 상자의 거래: (계산이 온) AI 예시 > 일정 결제 > 고정 예시.
//   예시 계산이 아직 없거나 실패하면 일정·고정 예시를 그대로 둔다 ('조건 확인 필요'가 남지 않게).
//   일정 결제에는 AI 가 그 일정을 보고 정했을 때만 예시가 넘어온다
//   (2026-11-23 홈 일정 카드 설계서, utils/scheduleAiCore.js scheduleAiExample).
export function chooseEstimateScenario({ scheduleScenario, example, exampleRows, fixed }) {
  if (example && exampleRows && Object.keys(exampleRows).length) return example;
  if (scheduleScenario) return scheduleScenario;
  return fixed;
}

// 행사 문구의 '약 N원'과 상자 금액(그 거래 한 건)이 왜 다른지 알려 주는 한 줄.
//   문구 금액은 이 시간대 행사 혜택 전체(예: 현대백화점 + 올리브영)를 가능성만큼 더한 기대 금액이라,
//   예시 가게 한 곳 × 가능성과 같다고 말하지 않는다 (2026-11-23 실제 데이터에서 확인).
export function exampleNote(example, message) {
  if (example?.basis !== 'promotion' || !(example.prob > 0 && example.prob < 1)) return '';
  const amount = String(message || '').match(/약 ([\d,]+)원/);
  if (!amount) return '';
  const percent = example.prob * 100 < 1 ? '1% 미만' : '약 ' + Math.round(example.prob * 100) + '%';
  return `AI 문구의 '약 ${amount[1]}원'은 이 시간대에 결제할 만한 곳의 행사 혜택을 가능성만큼 더한 금액이에요. `
    + `${example.name}에서 결제할 가능성은 ${percent}예요.`;
}

// 상자 아래 줄의 앞부분: 예시 거래를 어떻게 골랐는지. 실적·구간 지키기처럼 문구가 거래를 말하지 않으면(likely)
// '문구가 말하는 거래'라고 하지 않는다.
const BASIS_LINE = {
  promotion: 'AI 추천 문구가 말하는 거래로 계산했어요. ',
  benefit: 'AI 추천 문구가 말하는 거래로 계산했어요. ',
  likely: '지금 시간대에 결제할 가능성이 가장 높은 거래로 계산했어요. ',
  schedule: '오늘 일정에 맞춘 거래로 계산했어요. ',
};
export function exampleBasisLine(basis) {
  return BASIS_LINE[basis] || '';
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
      name: (card.benefit > 0 ? '예상 혜택' : '이 거래에 받을 혜택 없음') + promo,
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
