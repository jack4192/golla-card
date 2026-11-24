// 필수 서비스 이용 동의를 서버(users.mydata_agreed)에도 두는 도우미 (2026-11-24 사용자 결정: 기존 칸만 사용).
// 알림 수신 동의는 폰 알림 권한과 묶여 있어 기기에 그대로 둔다. 테스트: node --test utils/__tests__/consentCore.test.mjs

// 서버에 필수 동의가 있고 이 기기에 동의 기록이 없으면(다른 기기에서 동의한 경우) 기기 동의를 만들어 돌려준다.
// 기기에 이미 있거나 서버 동의가 없으면 null.
export function consentFromServer(me, localConsent, version, now = new Date()) {
  if (localConsent?.termsAgreed === true) return null;
  if (me?.mydataAgreed !== true) return null;
  return {
    version,
    savedAt: now.toISOString(),
    termsAgreed: true,
    morningNotificationAgreed: localConsent?.morningNotificationAgreed === true,
  };
}
