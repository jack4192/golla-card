package com.paymate.backend.card.exception;

import com.paymate.backend.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum CardErrorCode implements ErrorCode {
    CARD_NOT_FOUND(HttpStatus.NOT_FOUND, "카드 상품을 찾을 수 없습니다."),
    USER_CARD_NOT_FOUND(HttpStatus.NOT_FOUND, "보유 카드를 찾을 수 없습니다."),
    ALREADY_REGISTERED_CARD(HttpStatus.CONFLICT, "이미 등록된 카드입니다."),
    CARD_IN_USE(HttpStatus.CONFLICT, "이 카드에 연결된 기록이 있어 지금은 뺄 수 없습니다.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
