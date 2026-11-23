package com.paymate.backend.payment.repository;

/** 결제 한 건 (홈 시간 표시줄의 결제 점·최근 결제). paidAt 은 'yyyy-MM-ddTHH:mm:ss' 글자 (서울 시간). */
public interface PaymentRow {

    Long getPaymentId();

    String getPaidAt();

    String getMerchantName();

    String getCategory();        // 업종 코드 (categories.category)

    String getCategoryName();

    Integer getAmount();

    Integer getBenefitAmount();  // 카드 혜택

    Integer getPromotionAmount(); // 행사 혜택

    Long getUserCardId();

    String getCardName();
}
