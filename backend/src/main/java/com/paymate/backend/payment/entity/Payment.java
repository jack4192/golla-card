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
@Table(name = "payments")
public class Payment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "payment_id")
    private Long id;

    @Column(name = "user_card_id", nullable = false)
    private Long userCardId;

    @Column(name = "merchant_name", nullable = false, length = 100)
    private String merchantName;

    @Column(name = "category", nullable = false, length = 30)
    private String category;

    @Column(name = "amount", nullable = false)
    private Integer amount;

    @Column(name = "paid_at", nullable = false)
    private LocalDateTime paidAt;

    @Column(name = "benefit_id")
    private Long benefitId;               // 적용된 혜택 (없으면 null)

    @Column(name = "benefit_amount", nullable = false)
    private Integer benefitAmount;

    @Column(name = "promotion_id")
    private Long promotionId;             // 적용된 프로모션 (없으면 null)

    @Column(name = "promotion_amount", nullable = false)
    private Integer promotionAmount;

    @Column(name = "approval_no", length = 10)
    private String approvalNo;

    public Payment(Long userCardId, String merchantName, String category, Integer amount, LocalDateTime paidAt,
                   Long benefitId, Integer benefitAmount, Long promotionId, Integer promotionAmount,
                   String approvalNo) {
        this.userCardId = userCardId;
        this.merchantName = merchantName;
        this.category = category;
        this.amount = amount;
        this.paidAt = paidAt;
        this.benefitId = benefitId;
        this.benefitAmount = benefitAmount;
        this.promotionId = promotionId;
        this.promotionAmount = promotionAmount;
        this.approvalNo = approvalNo;
    }
}
