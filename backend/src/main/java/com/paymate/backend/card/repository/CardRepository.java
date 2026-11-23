package com.paymate.backend.card.repository;

import com.paymate.backend.card.entity.Card;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CardRepository extends JpaRepository<Card, Long> {

    // 카드명, 카드사, 혜택 업종명, 혜택 가맹점에 키워드가 들어있으면 반환(대소문자 무시)
    @Query(value = """
            SELECT c.card_id             AS "cardId",
                   c.card_name           AS "cardName",
                   c.issuer              AS "issuer",
                   c.card_type           AS "cardType",
                   c.annual_fee_domestic AS "annualFeeDomestic",
                   c.annual_fee_overseas AS "annualFeeOverseas",
                   c.description         AS "description",
                   c.image_url           AS "imageUrl"
              FROM cards c
             WHERE (:keyword = ''
                    OR POSITION(LOWER(:keyword) IN LOWER(c.card_name)) > 0
                    OR POSITION(LOWER(:keyword) IN LOWER(c.issuer)) > 0
                    OR EXISTS (SELECT 1
                                 FROM benefits b
                                 JOIN benefit_targets bt ON bt.benefit_id = b.benefit_id
                                 JOIN categories cat ON cat.category = bt.category
                                WHERE b.card_id = c.card_id
                                  AND (POSITION(LOWER(:keyword) IN LOWER(cat.category_name)) > 0
                                       OR POSITION(LOWER(:keyword) IN LOWER(COALESCE(bt.merchant_name, ''))) > 0)))
             ORDER BY c.card_id
            """, nativeQuery = true)
    List<CardProductRow> searchProducts(@Param("keyword") String keyword);

   // 카드별 혜택 업종(태그)을 혜택이 많은 업종 순으로
    @Query(value = """
            SELECT b.card_id AS "cardId", cat.category_name AS "categoryName"
              FROM benefits b
              JOIN benefit_targets bt ON bt.benefit_id = b.benefit_id
              JOIN categories cat ON cat.category = bt.category
             WHERE b.card_id IN (:cardIds)
             GROUP BY b.card_id, cat.category_name
             ORDER BY b.card_id, COUNT(*) DESC, cat.category_name
            """, nativeQuery = true)
    List<CardTagRow> findTags(@Param("cardIds") Collection<Long> cardIds);

    // 카드의 혜택을 전월실적 구간별로
    @Query(value = """
            SELECT b.benefit_id                  AS "benefitId",
                   b.benefit_name                AS "name",
                   b.benefit_kind                AS "kind",
                   b.value_type                  AS "valueType",
                   bt.value                      AS "benefitValue",
                   t.tier_no                     AS "tierNo",
                   t.min_amount                  AS "minPrevSpend",
                   bt.monthly_limit              AS "monthlyLimit",
                   bt.monthly_count              AS "monthlyCount",
                   bt.per_payment_limit          AS "perPaymentLimit",
                   b.limit_basis                 AS "limitBasis",
                   b.pay_type                    AS "payType",
                   b.min_pay_amount              AS "minPayAmount",
                   SUBSTRING(CAST(b.time_from AS VARCHAR), 1, 5) AS "timeFrom",
                   SUBSTRING(CAST(b.time_to AS VARCHAR), 1, 5)   AS "timeTo",
                   b.days                        AS "days",
                   b.daily_count                 AS "dailyCount",
                   b.description                 AS "description",
                   g.group_name                  AS "groupName",
                   bgt.monthly_limit             AS "groupMonthlyLimit"
              FROM benefits b
              JOIN benefit_tiers bt ON bt.benefit_id = b.benefit_id
              JOIN card_tiers t ON t.tier_id = bt.tier_id
              LEFT JOIN benefit_groups g ON g.group_id = b.group_id
              LEFT JOIN benefit_group_tiers bgt ON bgt.group_id = b.group_id AND bgt.tier_id = bt.tier_id
             WHERE b.card_id = :cardId
             ORDER BY b.benefit_id, t.tier_no
            """, nativeQuery = true)
    List<BenefitRow> findBenefitRows(@Param("cardId") Long cardId);

    // 카드의 모든 혜택이 적용되는 업종/가맹점
    @Query(value = """
            SELECT bt.benefit_id AS "benefitId", cat.category_name AS "categoryName", bt.merchant_name AS "merchantName"
              FROM benefit_targets bt
              JOIN categories cat ON cat.category = bt.category
             WHERE bt.benefit_id IN (SELECT benefit_id FROM benefits WHERE card_id = :cardId)
             ORDER BY bt.benefit_id, bt.target_id
            """, nativeQuery = true)
    List<BenefitTargetRow> findBenefitTargets(@Param("cardId") Long cardId);

    // 부가 서비스
    @Query(value = """
            SELECT perk_name AS "perkName", description AS "description"
              FROM card_perks
             WHERE card_id = :cardId
             ORDER BY perk_id
            """, nativeQuery = true)
    List<CardPerkRow> findPerks(@Param("cardId") Long cardId);
}
