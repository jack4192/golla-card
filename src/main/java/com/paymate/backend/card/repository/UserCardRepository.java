package com.paymate.backend.card.repository;

import com.paymate.backend.card.entity.UserCard;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserCardRepository extends JpaRepository<UserCard, Long> {

    boolean existsByUserIdAndCardId(Long userId, Long cardId);

    Optional<UserCard> findByIdAndUserId(Long id, Long userId);

    @Query(value = """
        SELECT uc.user_card_id AS "userCardId",
               c.card_id       AS "cardId",
               c.issuer        AS "issuer",
               c.card_name     AS "cardName",
               c.card_type     AS "cardType",
               c.image_url     AS "imageUrl",
               uc.card_last4   AS "cardLast4"
          FROM user_cards uc
          JOIN cards c ON c.card_id = uc.card_id
          LEFT JOIN user_card_details d ON d.user_card_id = uc.user_card_id
         WHERE uc.user_id = :userId
         ORDER BY d.display_order NULLS LAST, uc.user_card_id
        """, nativeQuery = true)
    List<UserCardSummaryRow> findSummaries(@Param("userId") Long userId);


    @Modifying
    @Query(value = """
        INSERT INTO user_card_details (user_card_id, registered_via, display_order, issued_at)
        SELECT CAST(:userCardId AS BIGINT),
               CASE WHEN (SELECT c.issuer
                            FROM user_cards x
                            JOIN cards c ON c.card_id = x.card_id
                           WHERE x.user_card_id = CAST(:userCardId AS BIGINT)) = '신한'
                    THEN 'own_issuer'   -- 신한 카드는 자사 카드
                    ELSE 'openpay'      -- 다른 카드사는 오픈페이 등록
               END,
               COALESCE((SELECT MAX(d.display_order)
                           FROM user_card_details d
                           JOIN user_cards u ON u.user_card_id = d.user_card_id
                          WHERE u.user_id = :userId), 0) + 1,
               CAST(:issuedAt AS DATE)
        """, nativeQuery = true)
    void insertDetail(@Param("userCardId") Long userCardId,
                      @Param("userId") Long userId,
                      @Param("issuedAt") LocalDate issuedAt);

    // 카드 번호 순서대로
    @Query(value = """
        SELECT uc.user_card_id
          FROM user_cards uc
          LEFT JOIN user_card_details d ON d.user_card_id = uc.user_card_id
         WHERE uc.user_id = :userId
         ORDER BY d.display_order NULLS LAST, uc.user_card_id
        """, nativeQuery = true)
    List<Long> findOrderedIds(@Param("userId") Long userId);

    // 하나만 변경
    @Modifying
    @Query(value = """
        UPDATE user_card_details
           SET display_order = :displayOrder
         WHERE user_card_id = :userCardId
        """, nativeQuery = true)
    int updateDisplayOrder(@Param("userCardId") Long userCardId,
                           @Param("displayOrder") int displayOrder);
}
