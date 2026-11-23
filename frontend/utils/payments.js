// 내 결제 내역 불러오기 (서버 모드 전용, 2026-11-23). 서버가 기준 시각 이후 결제는 빼고 준다.
import { SERVER_MODE, api } from './api';

const list = value => (Array.isArray(value) ? value : []);

// 그날 결제 (시간순). day: 'YYYY-MM-DD'. 서버 모드가 아니면 빈 목록. 실패하면 예외.
export async function loadTodayPayments(day) {
  if (!SERVER_MODE) return [];
  return list(await api.paymentsOfDay(day));
}

// 최근 결제 (최근순). beforeId 를 주면 그보다 오래된 쪽.
export async function loadRecentPayments({ beforeId, limit = 5 } = {}) {
  if (!SERVER_MODE) return [];
  return list(await api.paymentsRecent({ beforeId, limit }));
}
