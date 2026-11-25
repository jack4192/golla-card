// QR·바코드 결제창(QuickPaySheet)의 끌어 닫기·캡처 보호 판단. 순수 함수만 둔다.
// 테스트: node --test utils/__tests__/paySheetCore.test.mjs

const CLOSE_DISTANCE = 80;
const FLICK_DISTANCE = 24;
const FLICK_VELOCITY = 1;   // px/ms

// 아래로 끄는 몸짓인지: 6px 넘게, 옆보다 아래로 더 움직였을 때
export function isDownwardDrag(dx, dy) {
  return dy > 6 && dy > Math.abs(dx);
}

// 손을 뗐을 때 닫을지: 충분히(80px) 끌었거나, 조금(24px) 이라도 빠르게 끌었을 때
export function shouldCloseSheet(distance, velocity) {
  return distance >= CLOSE_DISTANCE || (distance >= FLICK_DISTANCE && velocity > FLICK_VELOCITY);
}

// 끄는 중 한 걸음: 아래로 끌기가 한 번 시작되면 옆으로 틀어도 시트가 제자리로 튀지 않게 따라간다
export function dragStep(wasDragging, dx, dy) {
  const dragging = wasDragging || isDownwardDrag(dx, dy);
  return { dragging, offset: dragging ? Math.max(0, dy) : 0 };
}

export const CAPTURE_WARNING = '화면 캡처 보호를 켜지 못했어요. 결제 코드를 남에게 보여 주지 마세요.';

// 캡처 보호 상태 → 창을 띄울지, 코드를 보여 줄지, 경고를 보일지.
//   pending: 설정 중(안드로이드는 창을 띄우기 전에 켜야 해서 아직 안 띄움), ready: 켜짐(웹은 늘 ready),
//   unavailable: 켜지 못함 → 결제가 막히지 않게 경고와 함께 코드는 보여 준다
export function captureView(state) {
  if (state === 'pending') return { open: false, codes: false, warning: false };
  return { open: true, codes: true, warning: state === 'unavailable' };
}
