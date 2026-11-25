package com.paymate.backend.payment.repository;

/**
 * 가상 POS 거래 한 건 (pos_transactions, 2026-11-25). requestedAt 은 'yyyy-MM-ddTHH:mm:ss' 글자 (서울 시간, 결제 시각과 같은 시연 시각).
 * paymentId 가 있으면 승인, 없으면 거절(declineReason). 승인번호·카드 이름·혜택은 승인일 때만 있다.
 */
public interface PosTransactionRow {

    Long getTxnId();

    String getRequestedAt();

    Long getPaymentId();

    String getDeclineReason();

    String getApprovalNo();

    String getMerchantName();

    String getBranchName();

    String getCategoryName();

    Integer getAmount();

    String getCardName();

    Integer getTotalDiscount();  // 카드 혜택 + 행사 혜택
}
