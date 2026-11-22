package com.paymate.backend.card.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class MyCardResponse {

    private final Long userCardId;
    private final String cardCode;        // 카드 상품 코드 (= cards.card_id)
    private final String name;            // 카드명
    private final String issuer;          // 카드사
    private final String type;            // CREDIT / CHECK
    private final String imageUrl;        // 카드 이미지 (없으면 null)
    private final boolean representative; // 대표 카드 (표시 순서 1번)
    private final int order;              // 표시 순서 (1부터)
    private final String cardLast4;       // 끝 4자리
}
