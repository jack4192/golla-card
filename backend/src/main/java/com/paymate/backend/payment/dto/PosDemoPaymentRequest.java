package com.paymate.backend.payment.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 백엔드 가상 POS 화면의 시연 결제 요청 (2026-11-25). 단말기 키는 받지 않는다 (서버의 만능 키로 결제). */
@Getter
@NoArgsConstructor
public class PosDemoPaymentRequest {

    @NotBlank(message = "결제 코드를 입력해 주세요.")
    private String code;            // 바코드 숫자 18자리 (QR 문자열 "PAYMATE:..." 도 허용)

    @NotNull(message = "결제 금액을 입력해 주세요.")
    @Min(value = 100, message = "결제 금액은 100원 이상이어야 합니다.")
    @Max(value = 10_000_000, message = "결제 금액은 1,000만 원 이하여야 합니다.")
    private Integer amount;

    @NotNull(message = "가맹점을 골라 주세요.")
    private Long merchantId;
}
