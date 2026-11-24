package com.paymate.backend.payment.repository;

import java.math.BigDecimal;

public interface PromotionRow {

    Long getPromotionId();

    String getName();

    String getValueType();      // RATE / FIXED

    BigDecimal getValue();

    Integer getMaxAmount();     // 프로모션 1회 최대 금액 (없으면 null)
}
