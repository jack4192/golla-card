// 회원 탈퇴 화면의 순수 함수 (2026-11-24 사용자 결정: 서버 모드는 비밀번호를 다시 확인하고 서버에서 바로 완전 삭제).
// 테스트: node --test utils/__tests__/withdrawalCore.test.mjs

export function withdrawalCopy(serverMode) {
  if (serverMode) {
    return {
      needsPassword: true,
      confirm: '탈퇴하면 계정과 카드·일정·결제·추천 기록이 서버에서 모두 삭제되고, 이 기기에 저장된 기록도 지워집니다. 삭제한 데이터는 되돌릴 수 없어요.',
      done: '회원 탈퇴를 마쳤어요. 로그인 화면으로 이동합니다.',
    };
  }
  return {
    needsPassword: false,
    confirm: '탈퇴하면 이 기기에 저장된 로그인 정보, 동의, 일과·일정, 카드 추천·등록 설정이 삭제됩니다. 삭제한 데이터는 복원할 수 없습니다.',
    done: '이 기기의 계정 기록을 삭제했어요. 로그인 화면으로 이동합니다.',
  };
}

// '회원 탈퇴 확정'을 누를 수 있는지. 서버에서 이미 지웠으면(serverDone) 기기 정리만 다시 하므로 비밀번호가 필요 없다.
export function canSubmitWithdrawal({ serverMode, password, busy, serverDone = false }) {
  if (busy) return false;
  if (!serverMode || serverDone) return true;
  return String(password || '').trim().length > 0;
}
