package com.paymate.backend.payment.repository;

import com.paymate.backend.card.entity.Card;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 결제 내역 조회 (홈 시간 표시줄·최근 결제, 2026-11-23). 엔티티를 두지 않고 읽기만 해서 ddl-auto: validate 대상이 아니다.
 * payments 표에는 사용자 칸이 없어 user_cards 로 내 카드의 결제만 고른다.
 * 결제 번호는 가상 데이터를 만들 때 시간순으로 매겨서(export_db) 번호가 곧 시간 순서다 → 최근 결제 쪽 넘기기는 번호로 한다.
 */
public interface PaymentRepository extends Repository<Card, Long> {

    String COLUMNS = """
            SELECT p.payment_id                                        AS "paymentId",
                   to_char(p.paid_at, 'YYYY-MM-DD"T"HH24:MI:SS')       AS "paidAt",
                   p.merchant_name                                     AS "merchantName",
                   p.category                                          AS "category",
                   cat.category_name                                   AS "categoryName",
                   p.amount                                            AS "amount",
                   p.benefit_amount                                    AS "benefitAmount",
                   p.promotion_amount                                  AS "promotionAmount",
                   p.user_card_id                                      AS "userCardId",
                   c.card_name                                         AS "cardName"
              FROM payments p
              JOIN user_cards uc ON uc.user_card_id = p.user_card_id AND uc.user_id = :userId
              JOIN cards c ON c.card_id = uc.card_id
              LEFT JOIN categories cat ON cat.category = p.category
            """;

    /** from 이상 until 이하, 시간순. */
    @Query(value = COLUMNS + """
             WHERE p.paid_at >= :from AND p.paid_at <= :until
             ORDER BY p.paid_at, p.payment_id
            """, nativeQuery = true)
    List<PaymentRow> findBetween(@Param("userId") Long userId, @Param("from") LocalDateTime from,
                                 @Param("until") LocalDateTime until);

    /** until 까지의 결제를 최근순으로. beforeId 가 있으면 그 번호보다 앞(오래된) 것만. */
    @Query(value = COLUMNS + """
             WHERE p.paid_at <= :until AND (CAST(:beforeId AS BIGINT) IS NULL OR p.payment_id < :beforeId)
             ORDER BY p.payment_id DESC
             LIMIT :limit
            """, nativeQuery = true)
    List<PaymentRow> findRecent(@Param("userId") Long userId, @Param("until") LocalDateTime until,
                                @Param("beforeId") Long beforeId, @Param("limit") int limit);
}
