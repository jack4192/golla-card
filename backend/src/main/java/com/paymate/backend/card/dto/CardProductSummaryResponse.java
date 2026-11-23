package com.paymate.backend.card.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Getter;


@Getter
@AllArgsConstructor
public class CardProductSummaryResponse {

    private final String cardCode;
    private final String name;
    private final String issuer;
    private final String type;             // CREDIT / CHECK
    private final int annualFee;           // 국내전용 연회비(원)
    private final List<String> tags;       // 혜택이 많은 업종 최대 3개
    private final String imageUrl;

    // 추가 필드
    private final int annualFeeOverseas;   // 해외겸용 연회비(원)
    private final String description;      // 한 줄 소개
}
