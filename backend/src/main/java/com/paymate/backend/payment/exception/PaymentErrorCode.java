package com.paymate.backend.payment.exception;

import com.paymate.backend.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum PaymentErrorCode implements ErrorCode {
    PAYMENT_TOKEN_NOT_FOUND(HttpStatus.NOT_FOUND, "결제 코드를 찾을 수 없습니다."),
    PAYMENT_TOKEN_ALREADY_USED(HttpStatus.CONFLICT, "이미 결제에 사용된 코드는 취소할 수 없습니다."),
    INVALID_TERMINAL(HttpStatus.UNAUTHORIZED, "등록되지 않은 단말기입니다."),
    MERCHANT_NOT_FOUND(HttpStatus.NOT_FOUND, "가맹점을 찾을 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
