// 백엔드(Spring) 연동 클라이언트
// EXPO_PUBLIC_API_URL 이 설정되어 있으면 서버 모드, 없으면 기존 데모 모드로 동작합니다.
//   예) .env.local →  EXPO_PUBLIC_API_URL=http://localhost:8080
//       아이폰(Expo Go) → http://<PC의 IP>:8080
import * as Store from './demoStore';

const TOKEN_KEY = 'solpay_api_token_v1';
const TIMEOUT_MS = 10000;
const AI_RANK_TIMEOUT_MS = 4000;    // 카드 순서는 결제 화면을 오래 붙잡지 않는다
const AI_CHAT_TIMEOUT_MS = 25000;   // 챗봇은 답이 최대 15초쯤 걸린다

export const API_BASE_URL = String(process.env.EXPO_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
export const SERVER_MODE = Boolean(API_BASE_URL);

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const readToken = () => Store.getItemAsync(TOKEN_KEY);
export const clearToken = () => Store.deleteItemAsync(TOKEN_KEY);

async function request(path, { method = 'GET', body, auth = false, timeout = TIMEOUT_MS } = {}) {
  if (!SERVER_MODE) throw new ApiError('서버 주소가 설정되지 않았어요.');
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await readToken();
    if (!token) throw new ApiError('로그인이 필요해요.', 401, 'UNAUTHORIZED');
    headers.Authorization = 'Bearer ' + token;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  let response;
  try {
    response = await fetch(API_BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch {
    throw new ApiError('서버에 연결하지 못했어요. 인터넷 연결이나 서버 상태를 확인해주세요.');
  } finally {
    if (timer) clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    // 백엔드 ErrorResponse: { code, message }
    throw new ApiError(data?.message || '요청을 처리하지 못했어요. (' + response.status + ')', response.status, data?.code || '');
  }
  return data;
}

// yyyyMMdd → yyyy-MM-dd (백엔드 LocalDate 형식)
const toIsoDate = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : String(value || '');
};

export const api = {
  async signup({ name, birthDate, phone, email, password, job, jobOther }) {
    await request('/api/auth/signup', {
      method: 'POST',
      // job·jobOther는 백엔드에 아직 칸이 없어 무시됩니다(백엔드에 추가 요청 필요).
      body: { name, birthDate: toIsoDate(birthDate), phone, email, password, job, jobOther: jobOther || null },
    });
  },
  async login(email, password) {
    const data = await request('/api/auth/login', { method: 'POST', body: { email, password } });
    if (!data?.accessToken) throw new ApiError('로그인 응답을 확인하지 못했어요.');
    await Store.setItemAsync(TOKEN_KEY, data.accessToken);
    return data;
  },
  async logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', auth: true });
    } catch {
      // 토큰이 이미 만료됐어도 기기에서는 로그아웃합니다.
    }
    await clearToken();
  },
  me: () => request('/api/users/me', { auth: true }),
  async isEmailTaken(email) {
    const data = await request('/api/users/email-availability?email=' + encodeURIComponent(email));
    return data?.available === false;
  },
  async isPhoneTaken(phone) {
    const data = await request('/api/users/phone-availability?phone=' + encodeURIComponent(phone));
    return data?.available === false;
  },

  // ── 카드 (백엔드 back 브랜치 기준 주소) ──
  // 내 카드 목록: [{ userCardId, cardCode(숫자 문자열), name, issuer, type, imageUrl, representative, order, cardLast4 }]
  myCards: () => request('/api/cards/user-cards', { auth: true }),
  // 카드 등록: cardCode는 서버의 카드 번호(cards.card_id). 이미 있으면 409 ALREADY_REGISTERED_CARD
  registerCard: cardCode => request('/api/cards/register', { method: 'POST', auth: true, body: { cardCode: String(cardCode) } }),
  // 결제 카드 순서: 내 카드 전체 userCardId를 빠짐없이 순서대로
  reorderCards: userCardIds => request('/api/cards/order', { method: 'PUT', auth: true, body: { userCardIds } }),
  cardBenefits: userCardId => request('/api/cards/' + encodeURIComponent(userCardId) + '/benefits', { auth: true }),
  // 카드 상품 검색: [{ cardCode, name, issuer, type, annualFee, tags, imageUrl, annualFeeOverseas, description }]
  cardProducts: (keyword = '') =>
    request('/api/card-products' + (keyword ? '?keyword=' + encodeURIComponent(keyword) : ''), { auth: true }),
  cardProduct: cardCode => request('/api/card-products/' + encodeURIComponent(cardCode), { auth: true }),

  // ── 일정 ──
  // [{ scheduleId, date, kind: SITUATION | PLACE, types[], category, categoryName, title, start, end, memo }]
  schedules: (from = '') =>
    request('/api/schedules' + (from ? '?from=' + encodeURIComponent(from) : ''), { auth: true }),
  createSchedule: body => request('/api/schedules', { method: 'POST', auth: true, body }),
  updateSchedule: (scheduleId, body) =>
    request('/api/schedules/' + encodeURIComponent(scheduleId), { method: 'PUT', auth: true, body }),
  deleteSchedule: scheduleId =>
    request('/api/schedules/' + encodeURIComponent(scheduleId), { method: 'DELETE', auth: true }),

  // ----- AI (백엔드가 AI 엔진을 대신 부른다. 응답 필드는 user_card_id 처럼 밑줄 형식) -----
  // 결제 화면 카드 순서. AI 가 늦으면 백엔드가 기본 순서(reason_code: 'FALLBACK')를 준다.
  aiRank: () => request('/api/ai/rank', { method: 'POST', auth: true, timeout: AI_RANK_TIMEOUT_MS }),
  // 홈 일정 카드 미리보기: 같은 계산, 추천 기록은 남기지 않는다 (기록이 '직전 기본 카드'를 바꾸지 않게, 2026-11-23)
  aiRankPreview: () => request('/api/ai/rank?record=false', { method: 'POST', auth: true, timeout: AI_RANK_TIMEOUT_MS }),
  // 챗봇. body: { message, history: [{ role, text }], screen: { name, recommendation_id } }
  aiChat: body => request('/api/ai/chat', { method: 'POST', auth: true, body, timeout: AI_CHAT_TIMEOUT_MS }),
  // 가정 계산: body { category_code, amount, merchant_id? } → { cards: [{ user_card_id, benefit, promotion, promotion_label }] }
  aiEvaluate: body => request('/api/ai/payments/evaluate', { method: 'POST', auth: true, body }),
  // AI 가맹점 목록: [{ merchant_id, name, category_code, category_name }]
  aiMerchants: () => request('/api/ai/merchants', { auth: true }),
  // 행사(카드사 이벤트·마이샵) 목록: [{ promotionId, kind, name, benefitType, benefitText, minAmount, maxAmount, start, end,
  //   payout, method, note, needsCheck, logoUrl }] (DB promotions, 챗봇·추천과 같은 목록)
  promotions: () => request('/api/promotions', { auth: true }),
  // 맞춤 추천 페이지: { tabs, card, merchant: { offers } } (AI 가 카드날·행사 여부로 탭을 정한다)
  aiRecommendationPage: () => request('/api/ai/recommendation-page', { method: 'POST', auth: true, timeout: AI_CHAT_TIMEOUT_MS }),
  aiConfirmRuleDraft: draftId => request('/api/ai/rules/drafts/' + encodeURIComponent(draftId) + '/confirm', { method: 'POST', auth: true }),
  aiCancelRuleDraft: draftId => request('/api/ai/rules/drafts/' + encodeURIComponent(draftId) + '/cancel', { method: 'POST', auth: true }),
};
