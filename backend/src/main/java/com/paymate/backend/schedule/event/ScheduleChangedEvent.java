package com.paymate.backend.schedule.event;

import java.time.LocalDate;
import java.util.Set;

/** 일정이 등록·수정·삭제되어 그 날짜들의 일정이 달라졌음을 알린다 (AI 엔진에 다시 넘기는 데 쓴다). */
public record ScheduleChangedEvent(Long userId, Set<LocalDate> dates) {
}
