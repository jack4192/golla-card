package com.paymate.backend.payment.repository;

public interface BenefitUsageRow {

    Long getBenefitId();

    Long getGroupId();

    Long getCnt();            // 적용된 횟수

    Long getUsageAmount();    // 그 결제들의 이용금액 합

    Long getBenefitAmount();  // 받은 혜택금액 합
}
