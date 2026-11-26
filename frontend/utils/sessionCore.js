// 로그인 만료 처리 (2026-11-24 점검 문제 6, 팀 결정 '자동 로그아웃 + 안내'). 순수 함수만 둔다.
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

// 로그인 뒤 첫 화면 (2026-11-26 팀 결정: 직접 로그인하면 동의를 마친 사람도 약관 동의 화면을 항상 거친다, 지난 선택은 체크된 채).
// 로그인을 유지한 채 새로고침·앱을 다시 열 때(resumed)는 가입을 마쳤으면 바로 홈.
// 'LoginFlow' 는 일정 관리 → 카드 추천 → 홈 순서.
export function screenAfterLogin({ termsAgreed, completed, resumed }) {
  if (!resumed || termsAgreed !== true) return 'Agreement';
  return completed ? 'Main' : 'LoginFlow';
}
