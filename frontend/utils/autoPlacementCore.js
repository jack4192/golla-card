// 카드 자동 배치 ON/OFF 와 카드 상세 '카드 신청'의 순수 함수들 (2026-11-24 수정사항 설계서 app-change-requests).
// 저장·화면 연결은 autoPlacement.js 와 각 화면이 한다.
// 테스트: node --test utils/__tests__/autoPlacementCore.test.mjs

export const AUTO_PLACEMENT_KEY = 'solpay_auto_placement_v1';

// 저장값 → 켜짐 여부. 'off' 만 꺼짐이고 처음(값 없음)·알 수 없는 값은 켜짐(기본)이다.
export const parseAutoPlacement = raw => raw !== 'off';

export const serializeAutoPlacement = on => (on ? 'on' : 'off');

// 카드사 신청 페이지 주소 (카드 상품의 sourcePage). https 카드사 페이지가 아니면 null → '카드 신청'을 숨긴다.
export function applyUrl(product) {
  const url = product?.sourcePage;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

// 내 카드 목록의 '맨 위 카드 = 결제 카드' 동기화에서 할 일.
//   자동 배치 중이고 AI 순서가 있으면 언제나 AI 1순위를 결제 카드로 한다
//   (다른 곳에서 고른 카드는 그 결제에만 쓰고, 홈에 오면 AI 1순위로 돌아온다).
//   그 밖은 지금 동작: 결제 카드가 다른 곳에서 바뀌었으면 그 카드를 맨 위로, 아니면 맨 위 카드를 결제 카드로.
export function syncAction({ autoOn, usingAi, firstId, selectedId, lastSelectedId, selectedIndex }) {
  if (firstId == null || firstId === selectedId) return 'none';
  if (autoOn && usingAi) return 'selectTop';
  if (selectedId !== lastSelectedId && selectedIndex > 0) return 'moveSelectedToTop';
  return 'selectTop';
}

// 홈 '내 카드' 오른쪽 위 버튼 (2026-11-24 수정사항2: '자동 배치 적용' → '순서 변경', 그 버튼을 눌러야만 순서를 바꾼다).
//   편집 중이면 '완료'(finish). 아니면 '순서 변경': 자동 배치가 켜져 있으면 먼저 묻고(confirm, 바꾸면 자동 배치를 끈다),
//   꺼져 있으면 바로 편집(edit).
export function orderButton({ editing, autoOn }) {
  if (editing) return { label: '완료', action: 'finish' };
  return { label: '순서 변경', action: autoOn ? 'confirm' : 'edit' };
}

// 홈 '내 카드' 제목 아래 안내 한 줄
export function orderHint({ editing, autoOn }) {
  if (editing) return "☰를 끌어 순서를 바꾸고 '완료'를 눌러요.";
  return autoOn ? '자동 배치 중이에요. 시간과 일정에 맞춰 순서가 바뀌어요.' : "맨 위 카드로 결제해요. 순서는 '순서 변경'을 눌러 바꿔요.";
}
