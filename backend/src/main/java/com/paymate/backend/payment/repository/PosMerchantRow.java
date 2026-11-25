package com.paymate.backend.payment.repository;

/** 가상 POS 화면에서 고를 수 있는 가맹점 (단말기가 있는 가맹점, 2026-11-25). */
public interface PosMerchantRow {

    Long getMerchantId();

    String getMerchantName();

    String getBranchName();

    String getCategory();        // 업종 코드 (categories.category)

    String getCategoryName();
}
