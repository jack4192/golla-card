package com.paymate.backend.card.dto;

import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class BenefitResponse {

    private final Long benefitId;
    private final String name;             // 혜택명
    private final String type;             // DISCOUNT(할인) / POINT(적립) / CASHBACK(캐시백)
    private final String valueType;        // RATE(퍼센트) / FIXED(정액, 원) / PER_LITER(리터당 원)
    private final String limitBasis;       // 한도 기준: BENEFIT(혜택금액) / USAGE(이용금액)
    private final String groupName;        // 한도를 함께 쓰는 혜택 그룹 (없으면 null)
    private final List<String> categories; // 적용 업종 (비어 있으면 국내 전 업종)
    private final List<String> merchants;  // 적용 가맹점 (비어 있으면 업종 전체)
    private final String note;             // 시간·요일·결제수단·횟수 조건과 유의사항 (없으면 null)
    private final List<BenefitTierResponse> tiers;   // 전월실적 구간별 내용 (tierNo 오름차순)
}
