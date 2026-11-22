package com.paymate.backend.card.repository;

import java.math.BigDecimal;

public interface BenefitRow {

    Long getBenefitId();

    String getName();

    String getKind();              // DISCOUNT / POINT / CASHBACK

    String getValueType();         // RATE / FIXED / PER_LITER

    BigDecimal getBenefitValue();  // RATE 는 %, FIXED 는 원, PER_LITER 는 원/l

    Integer getTierNo();

    Integer getMinPrevSpend();     // 이 구간의 전월 이용금액 하한(원)

    Integer getMonthlyLimit();     // 영역 월 한도

    Integer getMonthlyCount();

    Integer getPerPaymentLimit();

    String getLimitBasis();        // BENEFIT(혜택금액) / USAGE(이용금액)

    String getPayType();

    Integer getMinPayAmount();

    String getTimeFrom();          // "07:00"

    String getTimeTo();

    String getDays();              // "SAT,SUN"

    Integer getDailyCount();

    String getDescription();

    String getGroupName();

    Integer getGroupMonthlyLimit();
}
