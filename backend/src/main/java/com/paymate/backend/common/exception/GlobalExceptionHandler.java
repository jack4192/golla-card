package com.paymate.backend.common.exception;

import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 모든 오류를 앱이 읽는 {code, message} 형식으로 돌려준다 (2026-11-24 점검 문제 5: Spring 기본 형식·500 대신).
 * /api/ai 의 AI 호출 오류는 AiExceptionHandler 가 먼저 받는다.
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusiness(BusinessException e) {
        ErrorCode ec = e.getErrorCode();
        return ResponseEntity.status(ec.getStatus()).body(ErrorResponse.of(ec));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(fe -> fe.getDefaultMessage())
                .orElse(CommonErrorCode.INVALID_REQUEST.getMessage());
        return badRequest(message);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleNotReadable(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(ErrorResponse.of(CommonErrorCode.INVALID_REQUEST));
    }

    /** 경로·쿼리 값의 형식이 틀림 (예: 날짜가 yyyy-MM-dd 가 아님, 숫자 자리에 글자). */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return badRequest("요청 값의 형식이 올바르지 않습니다: " + e.getName());
    }

    /** 꼭 필요한 쿼리 값이 빠짐. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParam(MissingServletRequestParameterException e) {
        return badRequest("필요한 값이 빠졌습니다: " + e.getParameterName());
    }

    /** @RequestParam·@PathVariable 의 검사(@Email, @Pattern 등)에 걸림. */
    @ExceptionHandler({HandlerMethodValidationException.class, ConstraintViolationException.class})
    public ResponseEntity<ErrorResponse> handleParamValidation(Exception e) {
        return badRequest("요청 값이 올바르지 않습니다.");
    }

    /** 동시에 같은 값을 저장하는 등 DB 제약(유니크 등)에 걸림. */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ErrorResponse> handleIntegrity(DataIntegrityViolationException e) {
        log.warn("DB 제약에 걸렸습니다: {}", e.getMostSpecificCause().getClass().getSimpleName());
        return ResponseEntity.status(CommonErrorCode.CONFLICT.getStatus()).body(ErrorResponse.of(CommonErrorCode.CONFLICT));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity.status(CommonErrorCode.NOT_FOUND.getStatus()).body(ErrorResponse.of(CommonErrorCode.NOT_FOUND));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethod(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(CommonErrorCode.METHOD_NOT_ALLOWED.getStatus())
                .body(ErrorResponse.of(CommonErrorCode.METHOD_NOT_ALLOWED));
    }

    /** 예상하지 못한 오류: 내부 정보는 로그에만 남기고 공통 문구로 답한다. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        log.error("처리하지 못한 오류", e);
        return ResponseEntity.status(CommonErrorCode.INTERNAL_ERROR.getStatus())
                .body(ErrorResponse.of(CommonErrorCode.INTERNAL_ERROR));
    }

    private static ResponseEntity<ErrorResponse> badRequest(String message) {
        return ResponseEntity.badRequest().body(new ErrorResponse(CommonErrorCode.INVALID_REQUEST.getCode(), message));
    }
}
