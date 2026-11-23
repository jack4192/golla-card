package com.paymate.backend.promotion.dto;

/**
 * 혜택 탭 행사 한 건. start·end 는 실제 행사 기간('yyyy-MM-dd'), minAmount 는 조건이 없으면 null.
 * logoUrl 은 서버 기준 경로(/brand-logos/...)라 앱이 서버 주소를 붙인다.
 */
public record PromotionResponse(Long promotionId, String kind, String name, String benefitType, String benefitText,
                                Integer minAmount, Integer maxAmount, String start, String end, String payout,
                                String method, String note, boolean needsCheck, String logoUrl) {
}
