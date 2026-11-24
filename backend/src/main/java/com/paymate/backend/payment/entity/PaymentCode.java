package com.paymate.backend.payment.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@Entity
@Table(name = "payment_codes")
public class PaymentCode {

    public static final String ISSUED = "ISSUED";   // 발급됨(아직 안 쓰임)
    public static final String USED = "USED";       // 결제에 사용됨
    public static final String VOID = "VOID";       // 취소됨

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "code_id")
    private Long id;

    @Column(name = "user_card_id", nullable = false)
    private Long userCardId;

    @Column(name = "code_hash", nullable = false, length = 64)
    private String codeHash;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    @Column(name = "status", nullable = false, length = 10)
    private String status;

    @Column(name = "payment_id")
    private Long paymentId;

    public PaymentCode(Long userCardId, String codeHash, LocalDateTime expiresAt) {
        this.userCardId = userCardId;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
        this.status = ISSUED;
    }

    public void cancel() {
        this.status = VOID;
    }

    public void markUsed(Long paymentId) {
        this.status = USED;
        this.paymentId = paymentId;
    }
}
