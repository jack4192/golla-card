package com.paymate.backend.payment.dto;

import java.time.OffsetDateTime;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class PosPaymentResponse {

    private final boolean approved;
    private final String declineReason;     // 거절일 때만: INVALID_FORMAT / NOT_ISSUED / ALREADY_USED / VOIDED / EXPIRED
    private final Long paymentId;           // 승인일 때만
    private final String approvalNo;
    private final String merchantName;
    private final int amount;               // 결제 금액(원)
    private final String benefitName;       // 적용된 혜택 이름 (없으면 null)
    private final int benefitAmount;        // 받은 카드 혜택 금액(원)
    private final String promotionName;     // 적용된 프로모션 이름 (없으면 null)
    private final int promotionAmount;      // 받은 프로모션 금액(원)
    private final int totalDiscount;        // 혜택 + 프로모션 합계(원)
    private final OffsetDateTime paidAt;
}
