// 로그인 만료 처리 (2026-11-24 점검 문제 6, 사용자 결정 '자동 로그아웃 + 안내'). 순수 함수만 둔다.
// 테스트: node --test utils/__tests__/sessionCore.test.mjs

export const SESSION_EXPIRED_MESSAGE = '로그인 시간이 지나 다시 로그인해 주세요.';

// 로그인이 필요한 요청이 401 이면 로그인이 만료된 것. 로그인(토큰 없음)·로그아웃 요청의 401 은 제외한다.
export function isSessionExpired({ status, auth, path }) {
  return status === 401 && Boolean(auth) && path !== '/api/auth/logout';
}

// 여러 요청이 한꺼번에 401 을 받아도 만료 처리는 한 번만. 다시 로그인하면 reset 한다.
export function createExpiryNotifier() {
  let handler = null;
  let fired = false;
  return {
    setHandler(next) { handler = typeof next === 'function' ? next : null; },
    notify() {
      if (fired || !handler) return;
      fired = true;
      handler();
    },
    reset() { fired = false; },
  };
}

// 앱을 켤 때 저장된 토큰을 확인하다 실패했을 때: 401(만료·무효)이면 로그아웃,
// 연결 오류(status 0)·서버 오류면 로그인을 유지한다 (예전에는 서버가 잠깐 꺼져도 로그아웃됐다).
export function startupKeepsSession(error) {
  return error?.status !== 401;
}
