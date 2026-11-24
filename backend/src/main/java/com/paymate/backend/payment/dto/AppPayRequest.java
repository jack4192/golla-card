package com.paymate.backend.payment.dto;

import jakarta.validation.constraints.Min;
import lombok.Getter;
import lombok.NoArgsConstructor;


@Getter
@NoArgsConstructor
public class AppPayRequest {

    private Long merchantId;        // 결제할 가맹점 (생략하면 무작위)

    @Min(100)
    private Integer amount;         // 결제 금액 (생략하면 업종에 맞게 서버가 무작위로 정함)
}
