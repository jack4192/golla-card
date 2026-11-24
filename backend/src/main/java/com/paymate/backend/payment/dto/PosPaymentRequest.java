package com.paymate.backend.payment.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class PosPaymentRequest {

    @NotBlank(message = "단말기 키를 입력해 주세요.")
    private String terminalKey;

    @NotBlank(message = "결제 코드를 입력해 주세요.")
    private String code;            // 바코드 숫자 18자리 (QR 문자열 "PAYMATE:..." 도 허용)

    @Min(value = 100, message = "결제 금액은 100원 이상이어야 합니다.")
    private Integer amount;         // 비우면 서버가 가맹점 업종에 맞는 금액을 무작위로 정함
}
