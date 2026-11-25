// 가로 스크롤 줄을 웹에서 마우스로 잡고 끌어 넘길 수 있게 하는 ScrollView (2026-11-25 팀 피드백: 챗봇 빠른 질문 줄).
// - 마우스로 누른 채 좌우로 끌면 넘어가고, 끈 뒤에는 버튼이 눌리지 않게 클릭을 한 번 막는다.
// - 마우스 휠(위아래)도 옆으로 넘긴다. 폰(터치)은 원래 손가락으로 밀면 되므로 그대로 둔다.
import React, { useEffect, useRef } from 'react';
import { Platform, ScrollView } from 'react-native';

const DRAG_THRESHOLD = 5;

export default function DragScrollView({ style, children, ...props }) {
  const ref = useRef(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const node = ref.current?.getScrollableNode?.() || ref.current;
    if (!node || !node.addEventListener) return undefined;
    let down = false, moved = false, startX = 0, startLeft = 0;
    const onDown = event => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      down = true; moved = false; startX = event.clientX; startLeft = node.scrollLeft;
    };
    const onMove = event => {
      if (!down) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) > DRAG_THRESHOLD) { moved = true; node.style.cursor = 'grabbing'; node.style.userSelect = 'none'; }
      if (moved) { node.scrollLeft = startLeft - dx; event.preventDefault(); }
    };
    const onUp = () => {
      if (!down) return;
      down = false; node.style.cursor = 'grab'; node.style.userSelect = '';
    };
    const onClick = event => {
      if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
    };
    const onWheel = event => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      if (node.scrollWidth <= node.clientWidth) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.style.cursor = 'grab';
    node.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    node.addEventListener('click', onClick, true);
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('wheel', onWheel);
    };
  }, []);
  return <ScrollView ref={ref} horizontal style={style} {...props}>{children}</ScrollView>;
}
