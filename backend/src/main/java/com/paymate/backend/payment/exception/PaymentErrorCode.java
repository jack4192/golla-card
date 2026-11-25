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
    // 401 은 앱이 '로그인 만료'로 보고 자동 로그아웃하므로, 단말기 키가 틀린 것은 403 으로 알린다
    INVALID_TERMINAL(HttpStatus.FORBIDDEN, "등록되지 않은 단말기입니다."),
    MERCHANT_NOT_FOUND(HttpStatus.NOT_FOUND, "가맹점을 찾을 수 없습니다."),
    // 백엔드 가상 POS 화면(/pos)의 시연 API: 만능 키(POS_DEMO_TERMINAL_KEY)가 없으면 없는 주소처럼 404 (2026-11-25)
    POS_DEMO_DISABLED(HttpStatus.NOT_FOUND, "시연용 POS 가 꺼져 있습니다.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
