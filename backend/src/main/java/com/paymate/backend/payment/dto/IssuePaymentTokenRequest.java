package com.paymate.backend.payment.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class IssuePaymentTokenRequest {

    @NotNull(message = "결제할 카드를 선택해 주세요.")
    private Long userCardId;
}
