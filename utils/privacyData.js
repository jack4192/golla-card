// MYDATA_DELETE_LINK_V1
import {clearMyDataMemory, waitForMyDataWrites} from './myDataService';
import { Platform } from 'react-native';
import * as Store from './demoStore';
import { waitForEventWrites } from './routineData';
import { AUTOMATIC_AD_HISTORY_KEY, waitForAdWrites } from './recommendationPopup';

export const RESET_KEY = 'solpay_demo_reset_pending_v1';

const PERSONAL = [
  ['solpay_recommendation_hide_until_v1', '추천 팝업 숨김 설정'],
  ['solpay_recommendation_last_shown_v1', '추천 팝업 표시 기록'],
  ['solpay_promotion_hide_until_v1', '프로모션 팝업 숨김 설정'],
  ['solpay_promotion_last_shown_v1', '프로모션 팝업 표시 기록'],
  [AUTOMATIC_AD_HISTORY_KEY, '자동 광고 표시 기록'],
  ['solpay_payment_card_order_v1', '결제 카드 표시 순서'],
  ['solpay_mydata_import_v1', '마이데이터 불러오기'],
  ['solpay_routine_profile_v1', '평소 일과'],
  ['solpay_routine_exceptions_v1', '특별 일정'],
  ['solpay_schedule_checked_v1', '오늘 일정 확인 기록'],
  ['solpay_recommendation_preferences_v1', '추천·보유·관심 설정'],
  ['solpay_today_card_plan_v1', '오늘 카드 계획'],
  ['solpay_wallet_selection_v1', '지갑 선택 카드'],
];

const ACCOUNT = [
  ['solpay_demo_account_v1', '가입 정보'],
  ['solpay_demo_session_v1', '로그인 상태'],
  ['solpay_demo_full_logout_v1', '로그아웃 상태'],
  ['solpay_demo_consent_v1', '서비스 안내 및 알림 선택'],
  ['solpay_demo_onboarding_v1', '가입 진행 상태'],
  ['solpay_demo_pin_v1', '간편비밀번호'],
  ['solpay_demo_pin_attempts_v1', 'PIN 시도 기록'],
  ['solpay_ui_settings_v1', '화면 설정'],
];

export async function hasPendingReset() {
  return (await Store.getItemAsync(RESET_KEY)) !== null;
}

async function erase(key) {
  await Store.deleteItemAsync(key);

  if ((await Store.getItemAsync(key)) !== null) {
    throw Error('삭제 확인 실패');
  }

  if (Platform.OS === 'web') {
    for (const prefix of ['solpay_demo_', 'solpay_public_demo_']) {
      window.localStorage.removeItem(prefix + key);

      if (window.localStorage.getItem(prefix + key) !== null) {
        throw Error('이전 기록 삭제 확인 실패');
      }
    }
  }
}

export async function deleteDemoData(scope) {
  if (!['personal', 'account'].includes(scope)) {
    throw Error('삭제 범위를 확인해주세요.');
  }

  if (scope === 'personal' && await hasPendingReset()) {
    throw Error('진행 중인 계정 초기화를 먼저 완료해주세요.');
  }

  if (scope === 'account') {
    await Store.setItemAsync(RESET_KEY, 'pending');
  }

  const failed = [];
  await waitForMyDataWrites();
  await waitForEventWrites();
  await waitForAdWrites();
  const targets =
    scope === 'account' ? [...PERSONAL, ...ACCOUNT] : PERSONAL;

  for (const [key, label] of targets) {
    try {
      await erase(key);
    } catch {
      failed.push(label);
    }
  }

  if (scope === 'account' && !failed.length) {
    try {
      await erase(RESET_KEY);
    } catch {
      failed.push('초기화 완료 기록');
    }
  }

  if (!failed.includes('마이데이터 불러오기')) clearMyDataMemory();

  return {
    ok: failed.length === 0,
    failed,
    pending: scope === 'account' && failed.length > 0,
  };
}
