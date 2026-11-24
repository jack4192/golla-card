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
    // 업종 코드도 주면 그 업종 가맹점만 (예: '이마트' + MART → 이마트24(편의점) 말고 이마트, 2026-11-24)
    const merchant = merchants.find(item => norm(item.name).startsWith(norm(scenario.merchant))
      && (!scenario.categoryCode || item.category_code === scenario.categoryCode));
    return merchant ? { category_code: merchant.category_code, merchant_id: merchant.merchant_id, amount: scenario.amount } : null;
  }
  if (!scenario.categoryCode) return null;
  return scenario.merchantId != null
    ? { category_code: scenario.categoryCode, merchant_id: scenario.merchantId, amount: scenario.amount }
    : { category_code: scenario.categoryCode, amount: scenario.amount };
}

// '실제 혜택 계산하기'에 직접 넣은 결제할 곳 → 무엇으로 계산할지 (PR #11 검토, 2026-11-24).
//   evaluateRequest 의 '이름이 그 말로 시작하는 첫 가맹점'을 쓰면 '카페'→카페베네, '배달'→배달의민족처럼 업종 말이 브랜드가 된다.
//   AI 가맹점 이름에는 지점이 붙어 있어('스타벅스 강남역점') 끝의 '… 점'을 뗀 브랜드 이름으로도 비교한다.
//   ① 가맹점 이름이나 브랜드 이름과 똑같으면(띄어쓰기·대소문자 무시) 그 가맹점 (지점이 여럿이면 첫 지점)
//   ② 아니면 category (일정 입력과 같은 업종 분류 결과, 분류 안 되면 null)
//   ③ 그래도 없으면 앞부분이 맞는 브랜드가 하나뿐일 때만 그 가맹점 (스타→스타벅스). 두 글자 미만은 찾지 않는다
//   merchants: AI 가맹점 목록 [{ merchant_id, name, category_code }]. 반환: { merchant, brand } | { category } | null
const brandOf = name => String(name || '').trim().replace(/\s+\S+점$/, '');
export function matchPlace(text, merchants = [], category = null) {
  const q = norm(text);
  if (!q) return null;
  const list = Array.isArray(merchants) ? merchants : [];
  const found = item => ({ merchant: item, brand: brandOf(item.name) });
  const exact = list.find(item => norm(item.name) === q) || list.find(item => norm(brandOf(item.name)) === q);
  if (exact) return found(exact);
  if (category) return { category };
  if (q.length < 2) return null;
  const prefixed = list.filter(item => norm(brandOf(item.name)).startsWith(q));
  return new Set(prefixed.map(item => norm(brandOf(item.name)))).size === 1 ? found(prefixed[0]) : null;
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
  return `추천 문구의 '약 ${amount[1]}원'은 이 시간대에 결제할 만한 곳의 행사 혜택을 가능성만큼 더한 금액이에요. `
    + `${example.name}에서 결제할 가능성은 ${percent}예요.`;
}

// 상자 아래 줄의 앞부분: 예시 거래를 어떻게 골랐는지. 실적·구간 지키기처럼 문구가 거래를 말하지 않으면(likely)
// '문구가 말하는 거래'라고 하지 않는다.
const BASIS_LINE = {
  promotion: '추천 문구가 말하는 거래로 계산했어요. ',
  benefit: '추천 문구가 말하는 거래로 계산했어요. ',
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
      name: (card.benefit > 0 ? '예상 혜택' : '다음 결제에서 혜택을 챙겨 봐요!') + promo,
      reason: '이번 달 실적·한도와 진행 중인 행사를 반영해 계산했어요.',
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
