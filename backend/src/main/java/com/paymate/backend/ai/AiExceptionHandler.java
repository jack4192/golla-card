package com.paymate.backend.ai;

import com.paymate.backend.common.exception.CommonErrorCode;
import com.paymate.backend.common.exception.ErrorResponse;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** /api/ai 의 오류를 다른 API 와 같은 형식({code, message})으로 돌려준다. */
@RestControllerAdvice(basePackageClasses = AiController.class)
public class AiExceptionHandler {

    /** AI 엔진 호출 실패. */
    @ExceptionHandler(AiException.class)
    public ResponseEntity<ErrorResponse> handleAi(AiException e) {
        return ResponseEntity.status(e.getStatus()).body(new ErrorResponse(e.getCode(), e.getMessage()));
    }

    /** 경로·쿼리 값의 형식이 틀림 (예: 날짜가 yyyy-MM-dd 가 아님). */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return ResponseEntity.badRequest().body(ErrorResponse.of(CommonErrorCode.INVALID_REQUEST));
    }
}
