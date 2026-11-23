package com.paymate.backend.ai;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/** AI 엔진 호출이 실패했을 때. status·code·message 가 그대로 앱에 가는 오류 응답이 된다. */
@Getter
public class AiException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public AiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public AiException(HttpStatus status, String code, String message, Throwable cause) {
        super(message, cause);
        this.status = status;
        this.code = code;
    }
}
