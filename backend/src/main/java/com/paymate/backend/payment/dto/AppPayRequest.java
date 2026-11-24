package com.paymate.backend.payment.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;


@Getter
@NoArgsConstructor
public class AppPayRequest {

    private Long merchantId;        // 결제할 가맹점 (생략하면 무작위)

    @Size(max = 30)
    private String category;        // 가맹점 업종 (예: CAFE). merchantId 가 없을 때 이 업종의 가맹점 중 무작위 (2026-11-24, 일정에서 연 결제)

    @Min(100)
    private Integer amount;         // 결제 금액 (생략하면 업종에 맞게 서버가 무작위로 정함)
}
