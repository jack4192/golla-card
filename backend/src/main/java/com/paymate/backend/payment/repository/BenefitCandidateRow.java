package com.paymate.backend.payment.repository;

import java.math.BigDecimal;

public interface BenefitCandidateRow {

    Long getBenefitId();

    String getName();

    String getValueType();          // RATE / FIXED / PER_LITER

    String getLimitBasis();         // BENEFIT / USAGE

    String getPayType();

    Integer getMinPayAmount();

    String getTimeFrom();           // "07:00"

    String getTimeTo();

    String getDays();               // "SAT,SUN"

    Integer getDailyCount();

    Long getGroupId();

    BigDecimal getValue();          // RATE 는 %, FIXED 는 원, PER_LITER 는 원/ℓ

    Integer getMonthlyLimit();

    Integer getMonthlyCount();

    Integer getPerPaymentLimit();

    Integer getGroupMonthlyLimit();
}
