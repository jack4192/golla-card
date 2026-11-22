package com.paymate.backend.card.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Getter;


@Getter
@AllArgsConstructor
public class CardProductDetailResponse {

    private final String cardCode;
    private final String name;
    private final String issuer;
    private final int annualFee;               // 국내전용 연회비(원)
    private final List<BenefitResponse> benefits;
    private final String officialUrl;          // 카드사 상품 페이지. DB에 컬럼이 없어 지금은 항상 null

    // 추가 필드
    private final String type;
    private final int annualFeeOverseas;
    private final String description;
    private final String imageUrl;
    private final List<PerkResponse> perks;    // 부가 서비스(라운지, 영화 할인 등)
}
