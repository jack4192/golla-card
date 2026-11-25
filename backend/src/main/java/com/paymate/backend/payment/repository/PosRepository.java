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

    // ---------- 백엔드 가상 POS 화면 (/pos, 2026-11-25) ----------

    /** 단말기가 있는 가맹점 (화면의 가맹점 고르기). 업종 이름·가맹점 이름·지점 순. */
    @Query(value = """
            SELECT m.merchant_id AS "merchantId", m.merchant_name AS "merchantName", m.branch_name AS "branchName",
                   m.category AS "category", COALESCE(c.category_name, m.category) AS "categoryName"
              FROM merchants m
              LEFT JOIN categories c ON c.category = m.category
             WHERE EXISTS (SELECT 1 FROM terminals t WHERE t.merchant_id = m.merchant_id)
             ORDER BY "categoryName", m.merchant_name, m.branch_name, m.merchant_id
            """, nativeQuery = true)
    List<PosMerchantRow> findDemoMerchants();

    /** 가상 POS 거래 최근 limit 건 (들어온 순서의 역순). 거절은 결제·카드가 없다. */
    @Query(value = """
            SELECT p.txn_id AS "txnId", to_char(p.requested_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS "requestedAt",
                   p.payment_id AS "paymentId", p.decline_reason AS "declineReason", pay.approval_no AS "approvalNo",
                   m.merchant_name AS "merchantName", m.branch_name AS "branchName",
                   COALESCE(c.category_name, m.category) AS "categoryName", p.amount AS "amount",
                   cd.card_name AS "cardName",
                   COALESCE(pay.benefit_amount, 0) + COALESCE(pay.promotion_amount, 0) AS "totalDiscount"
              FROM pos_transactions p
              JOIN terminals t ON t.terminal_id = p.terminal_id
              JOIN merchants m ON m.merchant_id = t.merchant_id
              LEFT JOIN categories c ON c.category = m.category
              LEFT JOIN payments pay ON pay.payment_id = p.payment_id
              LEFT JOIN user_cards uc ON uc.user_card_id = pay.user_card_id
              LEFT JOIN cards cd ON cd.card_id = uc.card_id
             ORDER BY p.txn_id DESC
             LIMIT :limit
            """, nativeQuery = true)
    List<PosTransactionRow> findRecentTransactions(@Param("limit") int limit);
}
