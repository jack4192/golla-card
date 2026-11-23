package com.paymate.backend.payment.dto;

import com.paymate.backend.payment.repository.PaymentRow;

/** 결제 한 건. paidAt 은 'yyyy-MM-ddTHH:mm:ss' (서울 시간), 금액은 원. */
public record PaymentResponse(Long paymentId, String paidAt, String merchantName, String category, String categoryName,
                              int amount, int benefitAmount, int promotionAmount, Long userCardId, String cardName) {

    public static PaymentResponse from(PaymentRow row) {
        return new PaymentResponse(row.getPaymentId(), row.getPaidAt(), row.getMerchantName(), row.getCategory(),
                row.getCategoryName(), orZero(row.getAmount()), orZero(row.getBenefitAmount()),
                orZero(row.getPromotionAmount()), row.getUserCardId(), row.getCardName());
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }
}
