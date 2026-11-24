package com.paymate.backend.payment.repository;

import com.paymate.backend.card.entity.Card;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;


public interface PosRepository extends Repository<Card, Long> {

    @Query(value = """
            SELECT t.terminal_id AS "terminalId", m.merchant_id AS "merchantId",
                   m.merchant_name AS "merchantName", m.category AS "category"
              FROM terminals t
              JOIN merchants m ON m.merchant_id = t.merchant_id
             WHERE t.key_hash = :keyHash
            """, nativeQuery = true)
    List<TerminalRow> findTerminal(@Param("keyHash") String keyHash);

    @Query(value = """
            SELECT t.terminal_id AS "terminalId", m.merchant_id AS "merchantId",
                   m.merchant_name AS "merchantName", m.category AS "category"
              FROM terminals t
              JOIN merchants m ON m.merchant_id = t.merchant_id
             WHERE m.merchant_id = :merchantId
             ORDER BY t.terminal_id
             LIMIT 1
            """, nativeQuery = true)
    List<TerminalRow> findTerminalByMerchant(@Param("merchantId") Long merchantId);

    @Query(value = """
            SELECT t.terminal_id AS "terminalId", m.merchant_id AS "merchantId",
                   m.merchant_name AS "merchantName", m.category AS "category"
              FROM terminals t
              JOIN merchants m ON m.merchant_id = t.merchant_id
             ORDER BY random()
             LIMIT 1
            """, nativeQuery = true)
    List<TerminalRow> findRandomTerminal();

    /** 이 업종의 가맹점 단말기 중 무작위 하나 (앱 시연 결제에서 일정 업종을 따를 때, 2026-11-24). */
    @Query(value = """
            SELECT t.terminal_id AS "terminalId", m.merchant_id AS "merchantId",
                   m.merchant_name AS "merchantName", m.category AS "category"
              FROM terminals t
              JOIN merchants m ON m.merchant_id = t.merchant_id
             WHERE m.category = :category
             ORDER BY random()
             LIMIT 1
            """, nativeQuery = true)
    List<TerminalRow> findRandomTerminalInCategory(@Param("category") String category);

    @Query(value = "SELECT 'A' || LPAD(CAST(nextval('approval_no_seq') AS VARCHAR), 7, '0')", nativeQuery = true)
    String nextApprovalNo();

    @Modifying
    @Query(value = """
            INSERT INTO payment_details
                   (payment_id, channel, card_select_mode, source, synced_at, source_merchant_id, is_placement, is_scenario)
            VALUES (:paymentId, 'offline_qr', 'app_selected', :source, :syncedAt, :merchantId, TRUE, FALSE)
            """, nativeQuery = true)
    void insertPaymentDetail(@Param("paymentId") Long paymentId,
                             @Param("source") String source,
                             @Param("syncedAt") LocalDateTime syncedAt,
                             @Param("merchantId") Long merchantId);

    @Modifying
    @Query(value = """
            INSERT INTO pos_transactions (terminal_id, code_hash, amount, requested_at, payment_id)
            VALUES (:terminalId, :codeHash, :amount, :requestedAt, :paymentId)
            """, nativeQuery = true)
    void insertApproved(@Param("terminalId") Long terminalId,
                        @Param("codeHash") String codeHash,
                        @Param("amount") int amount,
                        @Param("requestedAt") LocalDateTime requestedAt,
                        @Param("paymentId") Long paymentId);

    @Modifying
    @Query(value = """
            INSERT INTO pos_transactions (terminal_id, code_hash, amount, requested_at, decline_reason)
            VALUES (:terminalId, :codeHash, :amount, :requestedAt, :reason)
            """, nativeQuery = true)
    void insertDeclined(@Param("terminalId") Long terminalId,
                        @Param("codeHash") String codeHash,
                        @Param("amount") int amount,
                        @Param("requestedAt") LocalDateTime requestedAt,
                        @Param("reason") String reason);

    @Modifying
    @Query(value = """
            INSERT INTO card_month_status
                   (user_card_id, year_month, prev_perf, perf, tier_id, benefit_amount, promotion_amount, txn_count)
            VALUES (:userCardId, :yearMonth, :prevPerf, :amount, :tierId, :benefit, :promotion, 1)
            ON CONFLICT (user_card_id, year_month) DO UPDATE
               SET perf           = card_month_status.perf + :amount,
                   benefit_amount = card_month_status.benefit_amount + :benefit,
                   promotion_amount = card_month_status.promotion_amount + :promotion,
                   txn_count      = card_month_status.txn_count + 1
            """, nativeQuery = true)
    void addToMonthStatus(@Param("userCardId") Long userCardId,
                          @Param("yearMonth") String yearMonth,
                          @Param("prevPerf") int prevPerf,
                          @Param("tierId") Long tierId,
                          @Param("amount") int amount,
                          @Param("benefit") int benefit,
                          @Param("promotion") int promotion);
}
