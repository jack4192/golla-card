package com.paymate.backend.schedule.dto;

import java.time.LocalDate;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class ScheduleResponse {

    private final Long scheduleId;
    private final LocalDate date;
    private final String kind;            // SITUATION / PLACE
    private final List<String> types;     // 상황 일정 종류들. 장소 일정은 빈 목록
    private final String category;        // 장소 일정 업종 코드. 상황 일정은 null
    private final String categoryName;    // 업종 한글 이름 (예: "카페/커피전문점"). 상황 일정은 null
    private final String title;
    private final String start;           // "HH:mm". 하루 종일이면 null
    private final String end;
    private final String memo;
}
