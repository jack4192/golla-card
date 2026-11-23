package com.paymate.backend.schedule.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import lombok.Getter;
import lombok.NoArgsConstructor;


@Getter
@NoArgsConstructor
public class ScheduleRequest {

    @NotNull(message = "날짜를 입력해 주세요.")
    private LocalDate date;                 // "2026-11-25"

    private List<String> types;             // 상황 일정 종류들

    private String category;                // 장소 일정 업종 코드 (직접 입력은 OTHER)

    @Size(max = 40, message = "일정 이름은 40자 이내로 입력해 주세요.")
    private String title;

    @Pattern(regexp = "^$|^([01][0-9]|2[0-3]):[0-5][0-9]$", message = "시작 시간은 HH:mm 형식으로 입력해 주세요.")
    private String start;

    @Pattern(regexp = "^$|^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$", message = "종료 시간은 HH:mm 형식으로 입력해 주세요.")
    private String end;

    @Size(max = 80, message = "메모는 80자 이내로 입력해 주세요.")
    private String memo;
}
