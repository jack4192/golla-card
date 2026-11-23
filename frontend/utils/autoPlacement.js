// 카드 자동 배치 ON/OFF 상태 (2026-11-24 수정사항 설계서 app-change-requests).
// 이 기기의 앱 저장소에 둔다(서버에는 두지 않는다). 홈 '내 지갑' 스위치·'내 카드' 자동 배치 적용 버튼·결제 화면이 같은 값을 본다.
// 웹은 앱 저장소가 탭 세션 기준이라 새 탭에서는 기본값(ON)으로 시작한다.
import { useEffect, useState } from 'react';
import * as Store from './demoStore';
import { AUTO_PLACEMENT_KEY, parseAutoPlacement, serializeAutoPlacement } from './autoPlacementCore';

let current = true;          // 기본 ON
let loaded = false;
let loading = null;
const listeners = new Set();

const notify = () => listeners.forEach(listener => listener(current));

function load() {
  if (loaded) return Promise.resolve(current);
  if (!loading) {
    loading = Store.getItemAsync(AUTO_PLACEMENT_KEY)
      .then(raw => { current = parseAutoPlacement(raw); })
      .catch(() => {})            // 읽지 못하면 기본 ON
      .then(() => {
        loaded = true;
        notify();
        return current;
      });
  }
  return loading;
}

export async function setAutoPlacement(on) {
  current = Boolean(on);
  loaded = true;
  notify();
  try {
    await Store.setItemAsync(AUTO_PLACEMENT_KEY, serializeAutoPlacement(current));
  } catch {
    // 저장에 실패해도 이번 실행 동안은 바꾼 값을 쓴다
  }
}

// { on, ready, setOn }
export function useAutoPlacement() {
  const [on, setOnState] = useState(current);
  const [ready, setReady] = useState(loaded);
  useEffect(() => {
    const listener = value => {
      setOnState(value);
      setReady(true);
    };
    listeners.add(listener);
    load().then(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return { on, ready, setOn: setAutoPlacement };
}
