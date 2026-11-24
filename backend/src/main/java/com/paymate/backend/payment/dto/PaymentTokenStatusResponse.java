package com.paymate.backend.payment.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class PaymentTokenStatusResponse {

    private final String status;      // ISSUED / COMPLETED / EXPIRED / CANCELED
    private final Long paymentId;     // 결제가 끝났을 때(COMPLETED)만 값이 있고, 아니면 null
}
