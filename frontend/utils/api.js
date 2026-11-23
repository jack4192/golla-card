// 백엔드(Spring) 연동 클라이언트
// EXPO_PUBLIC_API_URL 이 설정되어 있으면 서버 모드, 없으면 기존 데모 모드로 동작합니다.
//   예) .env.local →  EXPO_PUBLIC_API_URL=http://localhost:8080
//       아이폰(Expo Go) → http://<PC의 IP>:8080
import * as Store from './demoStore';

const TOKEN_KEY = 'solpay_api_token_v1';
const TIMEOUT_MS = 10000;

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

async function request(path, { method = 'GET', body, auth = false } = {}) {
  if (!SERVER_MODE) throw new ApiError('서버 주소가 설정되지 않았어요.');
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await readToken();
    if (!token) throw new ApiError('로그인이 필요해요.', 401, 'UNAUTHORIZED');
    headers.Authorization = 'Bearer ' + token;
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
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
  async signup({ name, birthDate, phone, email, password }) {
    await request('/api/auth/signup', {
      method: 'POST',
      body: { name, birthDate: toIsoDate(birthDate), phone, email, password },
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
};
