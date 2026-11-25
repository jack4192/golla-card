package com.paymate.backend.payment.dto;

/** 가상 POS 화면의 가맹점 하나 (2026-11-25). */
public record PosMerchantResponse(Long merchantId, String merchantName, String branchName,
                                  String category, String categoryName) {
}
