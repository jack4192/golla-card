package com.paymate.backend.payment.repository;

public interface TierRow {

    Long getTierId();

    Integer getTierNo();

    Integer getMinAmount();

    Integer getTotalLimit();    // 카드 월 통합 한도 (없으면 null)
}
