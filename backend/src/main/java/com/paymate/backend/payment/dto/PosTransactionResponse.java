package com.paymate.backend.payment.dto;

import java.time.OffsetDateTime;

/** 가상 POS 화면의 최근 거래 한 건 (2026-11-25). 사람 이름·카드 번호는 넣지 않는다. */
public record PosTransactionResponse(Long txnId, OffsetDateTime requestedAt, boolean approved, String declineReason,
                                     String approvalNo, String merchantName, String branchName, String categoryName,
                                     int amount, String cardName, int totalDiscount) {
}
