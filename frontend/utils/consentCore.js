// 필수 서비스 이용 동의(users.mydata_agreed)와 알림 수신 동의(users.notification_agreed)를 서버에도 두는 도우미 (2026-11-24).
// 알림 수신 동의는 2026-11-24 사용자 결정으로 서버에도 저장한다. 폰 알림 권한은 기기마다 따로라, 서버 값은 동의 기록일 뿐이다.
// 테스트: node --test utils/__tests__/consentCore.test.mjs

// 서버에 필수 동의가 있고 이 기기에 동의 기록이 없으면(다른 기기에서 동의한 경우) 기기 동의를 만들어 돌려준다.
// 알림 수신 동의는 서버 값(true/false)을 쓰고, 서버가 아직 모르면(null) 기기 값, 그것도 없으면 false.
// 기기에 이미 있거나 서버 동의가 없으면 null.
export function consentFromServer(me, localConsent, version, now = new Date()) {
  if (localConsent?.termsAgreed === true) return null;
  if (me?.mydataAgreed !== true) return null;
  return {
    version,
    savedAt: now.toISOString(),
    termsAgreed: true,
    morningNotificationAgreed: typeof me.notificationAgreed === 'boolean'
      ? me.notificationAgreed
      : localConsent?.morningNotificationAgreed === true,
  };
}
