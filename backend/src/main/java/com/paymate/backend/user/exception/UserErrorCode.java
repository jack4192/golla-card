package com.paymate.backend.user.exception;

import com.paymate.backend.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum UserErrorCode implements ErrorCode {
    DUPLICATE_EMAIL(HttpStatus.CONFLICT, "이미 사용 중인 이메일입니다."),
    DUPLICATE_PHONE(HttpStatus.CONFLICT, "이미 가입된 휴대폰 번호입니다."),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "회원을 찾을 수 없습니다."),
    MYDATA_AGREEMENT_REQUIRED(HttpStatus.BAD_REQUEST, "마이데이터 이용 동의는 필수입니다. 철회할 수 없습니다."),
    EMPTY_CONSENT_REQUEST(HttpStatus.BAD_REQUEST, "변경할 동의 항목을 보내 주세요.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
