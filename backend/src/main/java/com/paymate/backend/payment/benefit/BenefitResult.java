package com.paymate.backend.payment.benefit;

/**
 * 혜택 계산 결과.
 * benefitId 가 null 이면 이번 결제에 적용되는 카드 혜택이 없다는 뜻입니다 (benefitAmount = 0).
 * promotionId 가 null 이면 적용되는 프로모션이 없다는 뜻입니다 (promotionAmount = 0).
 * 카드 혜택과 프로모션은 중복 적용됩니다. (합계는 totalAmount())
 * prevPerf, tierId 는 계산에 쓴 전월 실적과 구간이며, 결제를 저장할 때 월 현황을 갱신하는 데 씁니다.
 */
public record BenefitResult(Long benefitId, String benefitName, int benefitAmount,
                            Long promotionId, String promotionName, int promotionAmount,
                            int prevPerf, Long tierId) {

    public static BenefitResult none(int prevPerf, Long tierId) {
        return new BenefitResult(null, null, 0, null, null, 0, prevPerf, tierId);
    }

    public int totalAmount() {
        return benefitAmount + promotionAmount;
    }
}
