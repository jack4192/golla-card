package com.paymate.backend.payment.repository;

import com.paymate.backend.card.entity.Card;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;


public interface BenefitRuleRepository extends Repository<Card, Long> {

    @Query(value = """
            SELECT tier_id AS "tierId", tier_no AS "tierNo", min_amount AS "minAmount", total_limit AS "totalLimit"
              FROM card_tiers
             WHERE card_id = :cardId
             ORDER BY tier_no
            """, nativeQuery = true)
    List<TierRow> findTiers(@Param("cardId") Long cardId);

    @Query(value = """
            SELECT prev_perf AS "prevPerf", tier_id AS "tierId"
              FROM card_month_status
             WHERE user_card_id = :userCardId AND year_month = :yearMonth
            """, nativeQuery = true)
    List<MonthStatusRow> findMonthStatus(@Param("userCardId") Long userCardId, @Param("yearMonth") String yearMonth);

    @Query(value = """
            SELECT perf FROM card_month_status
             WHERE user_card_id = :userCardId AND year_month = :yearMonth
            """, nativeQuery = true)
    Integer findPerf(@Param("userCardId") Long userCardId, @Param("yearMonth") String yearMonth);

    @Query(value = """
            SELECT b.benefit_id        AS "benefitId",
                   b.benefit_name      AS "name",
                   b.value_type        AS "valueType",
                   b.limit_basis       AS "limitBasis",
                   b.pay_type          AS "payType",
                   b.min_pay_amount    AS "minPayAmount",
                   SUBSTRING(CAST(b.time_from AS VARCHAR), 1, 5) AS "timeFrom",
                   SUBSTRING(CAST(b.time_to AS VARCHAR), 1, 5)   AS "timeTo",
                   b.days              AS "days",
                   b.daily_count       AS "dailyCount",
                   b.group_id          AS "groupId",
                   bt.value            AS "value",
                   bt.monthly_limit    AS "monthlyLimit",
                   bt.monthly_count    AS "monthlyCount",
                   bt.per_payment_limit AS "perPaymentLimit",
                   bgt.monthly_limit   AS "groupMonthlyLimit"
              FROM benefits b
              JOIN benefit_tiers bt ON bt.benefit_id = b.benefit_id AND bt.tier_id = :tierId
              LEFT JOIN benefit_group_tiers bgt ON bgt.group_id = b.group_id AND bgt.tier_id = bt.tier_id
             WHERE b.card_id = :cardId
               AND (NOT EXISTS (SELECT 1 FROM benefit_targets x WHERE x.benefit_id = b.benefit_id)
                    OR EXISTS (SELECT 1 FROM benefit_targets x
                                WHERE x.benefit_id = b.benefit_id
                                  AND x.category = :category
                                  AND (x.merchant_name IS NULL OR x.merchant_name = :merchantName)))
             ORDER BY b.benefit_id
            """, nativeQuery = true)
    List<BenefitCandidateRow> findCandidates(@Param("cardId") Long cardId,
                                             @Param("tierId") Long tierId,
                                             @Param("category") String category,
                                             @Param("merchantName") String merchantName);

    @Query(value = """
            SELECT p.benefit_id AS "benefitId",
                   b.group_id   AS "groupId",
                   COUNT(*)     AS "cnt",
                   COALESCE(SUM(p.amount), 0)         AS "usageAmount",
                   COALESCE(SUM(p.benefit_amount), 0) AS "benefitAmount"
              FROM payments p
              JOIN benefits b ON b.benefit_id = p.benefit_id
             WHERE p.user_card_id = :userCardId
               AND p.benefit_id IS NOT NULL
               AND p.paid_at >= :fromAt AND p.paid_at < :toAt
             GROUP BY p.benefit_id, b.group_id
            """, nativeQuery = true)
    List<BenefitUsageRow> findUsage(@Param("userCardId") Long userCardId,
                                    @Param("fromAt") LocalDateTime fromAt,
                                    @Param("toAt") LocalDateTime toAt);

    @Query(value = """
            SELECT p.promotion_id AS "promotionId", p.promo_name AS "name",
                   p.value_type AS "valueType", p.value AS "value", p.max_amount AS "maxAmount"
              FROM promotions p
              JOIN cards c ON c.card_id = :cardId
             WHERE c.issuer = '신한'
               AND (p.card_id IS NULL OR p.card_id = c.card_id)
               AND (p.issuer IS NULL OR p.issuer = c.issuer)
               AND (p.merchant_id IS NULL OR p.merchant_id = :merchantId)
               AND (p.category IS NULL OR p.category = :category)
               AND (p.merchant_name IS NULL OR p.merchant_name = :merchantName)
               AND :payDate BETWEEN p.start_date AND p.end_date
               AND p.min_amount <= :amount
            """, nativeQuery = true)
    List<PromotionRow> findPromotions(@Param("cardId") Long cardId,
                                      @Param("merchantId") Long merchantId,
                                      @Param("category") String category,
                                      @Param("merchantName") String merchantName,
                                      @Param("payDate") LocalDate payDate,
                                      @Param("amount") int amount);

    @Query(value = """
            SELECT merchant_id AS "merchantId", merchant_name AS "merchantName", category AS "category"
              FROM merchants
             WHERE merchant_id = :merchantId
            """, nativeQuery = true)
    List<MerchantRow> findMerchant(@Param("merchantId") Long merchantId);
}
