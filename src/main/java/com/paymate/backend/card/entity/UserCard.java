package com.paymate.backend.card.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 사용자가 보유한 카드 (user_cards 테이블) */
@Getter
@NoArgsConstructor
@Entity
@Table(name = "user_cards")
public class UserCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "user_card_id")
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "card_id", nullable = false)
    private Long cardId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "card_last4", nullable = false, length = 4)
    private String cardLast4;

    @Column(name = "target_tier_id")
    private Long targetTierId;   // 사용자가 채우려는 목표 구간 (없으면 null)

    public UserCard(Long userId, Long cardId, String cardLast4) {
        this.userId = userId;
        this.cardId = cardId;
        this.cardLast4 = cardLast4;
    }
}
