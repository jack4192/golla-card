package com.paymate.backend.payment.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class CardRecommendationResponse {

    private final Long userCardId;
    private final String name;          // 카드 이름
    private final String benefit;       // 적용될 카드 혜택 이름 (없으면 null)
    private final int reward;           // 예상 카드 혜택 금액(원)
    private final String promotion;     // 적용될 프로모션 이름 (없으면 null)
    private final int promotionReward;  // 예상 프로모션 금액(원)
    private final int totalReward;      // 혜택 + 프로모션 합계(원). 추천 순서는 이 값 기준
}
