package com.paymate.backend.card.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 카드 상품 (cards 테이블). 조회 전용이라 저장 코드는 없습니다. */
@Getter
@NoArgsConstructor
@Entity
@Table(name = "cards")
public class Card {

    @Id
    @Column(name = "card_id")
    private Long id;

    @Column(name = "issuer", nullable = false)
    private String issuer;

    @Column(name = "card_name", nullable = false)
    private String cardName;

    @Column(name = "card_type", nullable = false)
    private String cardType;   // CREDIT / CHECK

    @Column(name = "annual_fee_domestic", nullable = false)
    private Integer annualFeeDomestic;

    @Column(name = "annual_fee_overseas", nullable = false)
    private Integer annualFeeOverseas;

    @Column(name = "description")
    private String description;

    @Column(name = "image_url", columnDefinition = "TEXT")
    private String imageUrl;
}
