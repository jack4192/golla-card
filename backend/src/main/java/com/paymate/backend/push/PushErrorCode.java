package com.paymate.backend.push;

import com.paymate.backend.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum PushErrorCode implements ErrorCode {
    INVALID_SUBSCRIPTION(HttpStatus.BAD_REQUEST, "알림 구독 정보가 올바르지 않습니다."),
    // VAPID 키가 없는 서버(팀원 로컬 등): 알림 기능만 꺼져 있다
    PUSH_DISABLED(HttpStatus.SERVICE_UNAVAILABLE, "알림 서버가 준비되지 않았습니다."),
    NO_SUBSCRIPTION(HttpStatus.CONFLICT, "알림을 받을 기기가 없습니다. 먼저 폰 알림 받기를 켜 주세요.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
