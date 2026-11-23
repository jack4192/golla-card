package com.paymate.backend.promotion.repository;

import com.paymate.backend.card.entity.Card;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * 행사(카드사 이벤트·마이샵) 목록 조회. 엔티티를 두지 않고 읽기만 해서 ddl-auto: validate 대상이 아니다
 * (그래서 공용 DB 에 화면용 칸을 넣기 전에도 백엔드는 켜진다. 칸이 없으면 이 조회만 실패한다).
 * 값의 원본은 AI 저장소의 data/config/promotions.yml 이고, AI 챗봇·추천도 같은 표를 읽는다 (2026-11-23).
 */
public interface PromotionRepository extends Repository<Card, Long> {

    @Query(value = """
            SELECT p.promotion_id                    AS "promotionId",
                   p.kind                            AS "kind",
                   p.display_name                    AS "displayName",
                   p.merchant_name                   AS "merchantName",
                   p.promo_name                      AS "promoName",
                   p.benefit_type                    AS "benefitType",
                   p.benefit_text                    AS "benefitText",
                   p.min_amount                      AS "minAmount",
                   p.max_amount                      AS "maxAmount",
                   CAST(p.display_start AS VARCHAR)  AS "displayStart",
                   CAST(p.display_end AS VARCHAR)    AS "displayEnd",
                   CAST(p.start_date AS VARCHAR)     AS "startDate",
                   CAST(p.end_date AS VARCHAR)       AS "endDate",
                   p.payout                          AS "payout",
                   p.pay_method                      AS "payMethod",
                   p.note                            AS "note",
                   p.needs_check                     AS "needsCheck",
                   p.logo_url                        AS "logoUrl"
              FROM promotions p
             ORDER BY p.promotion_id
            """, nativeQuery = true)
    List<PromotionRow> findAllForList();
}
