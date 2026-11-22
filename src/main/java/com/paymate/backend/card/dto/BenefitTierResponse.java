package com.paymate.backend.card.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

/*
 * 같은 혜택이라도 구간마다 할인율·한도가 달라서 구간별로 이 객체가 하나씩
 */
@Getter
@AllArgsConstructor
public class BenefitTierResponse {

    private final Integer tierNo;            // 구간 번호 (0=실적 미달)
    private final Integer minPrevSpend;      // 이 구간의 전월 이용금액 하한(원)
    private final Double rate;               // 정률 혜택이면 % 값, 아니면 null
    private final Long fixedAmount;          // 정액이면 원, 리터당이면 원/ℓ, 정률이면 null
    private final String displayValue;       // 화면에 그대로 쓸 문구: "10%", "5,000원", "리터당 60원"
    private final Integer monthlyCap;        // 이 구간의 월 한도. 없으면 null
    private final Integer monthlyCount;      // 월 이용 가능 횟수. 없으면 null
    private final Integer perPaymentLimit;   // 건당 한도. 없으면 null
    private final Integer groupMonthlyCap;   // 같은 그룹 혜택이 함께 쓰는 월 통합 한도. 없으면 null
}
