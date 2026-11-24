package com.paymate.backend.schedule.exception;

import com.paymate.backend.common.exception.ErrorCode;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;

@Getter
@RequiredArgsConstructor
public enum ScheduleErrorCode implements ErrorCode {
    SCHEDULE_NOT_FOUND(HttpStatus.NOT_FOUND, "일정을 찾을 수 없습니다."),
    INVALID_SCHEDULE_KIND(HttpStatus.BAD_REQUEST, "상황 일정은 types, 장소 일정은 category 중 하나만 보내 주세요."),
    INVALID_SCHEDULE_TYPE(HttpStatus.BAD_REQUEST, "일정 종류 값이 올바르지 않습니다."),
    INVALID_CATEGORY(HttpStatus.BAD_REQUEST, "존재하지 않는 업종입니다."),
    TIME_PAIR_REQUIRED(HttpStatus.BAD_REQUEST, "시작 시간과 종료 시간은 함께 보내 주세요."),
    TIME_REQUIRED(HttpStatus.BAD_REQUEST, "장소 일정은 시작·종료 시간이 필요합니다."),
    TITLE_REQUIRED(HttpStatus.BAD_REQUEST, "직접 입력한 일정은 이름이 필요합니다."),
    MEMO_REQUIRED(HttpStatus.BAD_REQUEST, "기타 일정은 메모가 필요합니다."),
    INVALID_TIME_RANGE(HttpStatus.BAD_REQUEST, "종료 시간은 시작 시간보다 늦어야 합니다. (하루 안, 최대 24:00)"),
    DATE_OUT_OF_RANGE(HttpStatus.BAD_REQUEST, "일정은 오늘 기준 1년 전부터 1년 뒤까지만 등록할 수 있어요."),
    TOO_MANY_SCHEDULES(HttpStatus.BAD_REQUEST, "하루 일정은 10개까지 등록할 수 있어요.");

    private final HttpStatus status;
    private final String message;

    @Override
    public String getCode() {
        return name();
    }
}
