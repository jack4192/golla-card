// 행사 목록 읽기: 서버 모드에서 백엔드 /api/promotions 를 한 번 읽어 앱을 다시 열 때까지 기억한다 (카드 상품 serverCatalog.js 와 같은 방식).
// 데모 모드(서버 주소 없음)에는 행사가 없다 (2026-11-23 결정: 앱에 행사 사본을 두지 않는다).
import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, SERVER_MODE, api } from './api';
import { toBenefitRows } from './promotionsCore';

let cached = null;   // 읽은 행 (실패하면 기억하지 않는다)

export async function loadPromotions() {
  if (cached) return cached;
  const rows = toBenefitRows(await api.promotions(), API_BASE_URL);
  cached = rows;
  return rows;
}

// { rows, status: 'off' | 'loading' | 'ready' | 'failed', reload }
export function usePromotions() {
  const [state, setState] = useState(() => (!SERVER_MODE ? { rows: [], status: 'off' }
    : cached ? { rows: cached, status: 'ready' } : { rows: [], status: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!SERVER_MODE) return undefined;
    let stopped = false;
    if (!cached) setState(current => ({ ...current, status: 'loading' }));
    loadPromotions()
      .then(rows => { if (!stopped) setState({ rows, status: 'ready' }); })
      .catch(() => { if (!stopped) setState({ rows: [], status: 'failed' }); });
    return () => { stopped = true; };
  }, [attempt]);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  return { ...state, reload };
}
