// 직접 제공받은 추천만 등록합니다. 현재 제공된 목록은 없습니다.
// 공통 필드: id, providerName, title, description, sourceUrl(https)
// 카드사 추천 필수: cardCode (cardCatalogCsv의 실제 상품 코드)
// 가맹점 추천 필수: merchantName / cardCode는 선택
export const PROVIDER_RECOMMENDATIONS = {
  issuer: [],
  merchant: [],
};
