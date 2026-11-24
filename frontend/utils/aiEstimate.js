// 결제 화면 '이 거래의 예상 혜택'을 AI 엔진으로 계산한다 (서버 모드). 실패하면 null 을 돌려주고 화면은 앱 계산을 쓴다.
import { SERVER_MODE, api } from './api';
import { evaluateRequest, toEstimates } from './aiEstimateCore';
import { fetchServerWallet, serverCardLinks } from './serverCards';

let merchants = null;   // AI 가맹점 목록은 한 번만 읽는다

async function walletLinks() {
  let links = serverCardLinks();
  if (!Object.keys(links).length) {
    await fetchServerWallet();
    links = serverCardLinks();
  }
  return links;
}

// AI 가맹점 목록 [{ merchant_id, name, category_code, ... }] (한 번만 읽는다). 못 읽으면 [] (다음에 다시 읽는다)
export async function loadAiMerchants() {
  if (!SERVER_MODE) return [];
  try {
    if (!merchants) merchants = await api.aiMerchants();
    return Array.isArray(merchants) ? merchants : [];
  } catch {
    return [];
  }
}

// 반환: { [지갑 카드 id]: { value, unit, name, reason, condition, source: 'ai' } } 또는 null
export async function loadAiEstimates(scenario) {
  if (!SERVER_MODE) return null;
  try {
    if (scenario?.namedMerchant && !merchants) merchants = await api.aiMerchants();
    const body = evaluateRequest(scenario, merchants || []);
    if (!body) return null;
    const [links, result] = await Promise.all([walletLinks(), api.aiEvaluate(body)]);
    const estimates = toEstimates(result, links);
    return Object.keys(estimates).length ? estimates : null;
  } catch {
    return null;
  }
}
