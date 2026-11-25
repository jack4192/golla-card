// 카드 탭 상품 상세의 '내 카드로 추가'·'내 카드에서 빼기' (2026-11-24 사용자 결정). 순수 함수만 둔다.
// 테스트: node --test utils/__tests__/catalogCardCore.test.mjs

// 상품(catalogCode)에 해당하는 내 지갑 카드. 지갑 카드는 앱 22장 코드와 40장 코드가 섞여 있어
// catalogCodeOf(card)(→ 상품 목록 코드)로 이어서 비교한다. 없으면 null.
export function walletCardForCatalog(walletCards, catalogCode, catalogCodeOf) {
  if (!catalogCode || !Array.isArray(walletCards)) return null;
  return walletCards.find(card => catalogCodeOf(card) === catalogCode) || null;
}

// 상세 창에 보일 버튼. 미보유면 '내 카드로 추가'(+신청 주소가 있으면 '카드 신청'), 보유면 '내 카드에서 빼기'.
// 처리기(canAdd·canRemove)가 없는 화면(미리보기 등)에서는 그 버튼을 숨긴다.
export function catalogActionState({ owned, canAdd, canRemove, applyUrl }) {
  return {
    add: !owned && Boolean(canAdd),
    remove: Boolean(owned) && Boolean(canRemove),
    apply: !owned && Boolean(applyUrl),
  };
}

export const removeConfirmText = name =>
  `${name}을(를) 내 카드에서 뺄까요?`;
