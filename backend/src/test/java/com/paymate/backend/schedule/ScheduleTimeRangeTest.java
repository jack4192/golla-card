package com.paymate.backend.schedule;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.schedule.dto.ScheduleRequest;
import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.exception.ScheduleErrorCode;
import com.paymate.backend.schedule.repository.ScheduleRepository;
import com.paymate.backend.schedule.service.ScheduleService;
import java.lang.reflect.Field;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

/** 일정 시간 순서 검사 (2026-11-24 팀 결정: 시작=끝, 끝이 시작보다 빠른 일정(밤샘)은 400. 끝 최대 24:00). */
class ScheduleTimeRangeTest {

    private final ScheduleRepository repository = mock(ScheduleRepository.class);
    private final ScheduleService service = new ScheduleService(repository, mock(ApplicationEventPublisher.class), "2026-11-24T10:00:00");

    private static ScheduleRequest place(String start, String end) throws Exception {
        ScheduleRequest req = new ScheduleRequest();
        set(req, "date", LocalDate.of(2026, 11, 24));
        set(req, "category", "CAFE");
        set(req, "start", start);
        set(req, "end", end);
        return req;
    }

    private static ScheduleRequest situation(String start, String end) throws Exception {
        ScheduleRequest req = new ScheduleRequest();
        set(req, "date", LocalDate.of(2026, 11, 24));
        set(req, "types", List.of("반차"));
        set(req, "start", start);
        set(req, "end", end);
        return req;
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private void rejects(ScheduleRequest req) {
        assertThatThrownBy(() -> service.create(7L, req))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ScheduleErrorCode.INVALID_TIME_RANGE);
    }

    @Test
    @DisplayName("시작=끝, 끝이 시작보다 빠른 일정은 장소·상황 일정 모두 저장하지 않는다")
    void rejectsBadRange() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        rejects(place("12:00", "12:00"));
        rejects(place("18:00", "09:00"));
        rejects(situation("15:00", "14:59"));
        verify(repository, never()).save(any());
    }

    @Test
    @DisplayName("끝 24:00 과 정상 순서는 저장한다")
    void acceptsGoodRange() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
        service.create(7L, place("23:00", "24:00"));
        service.create(7L, place("12:00", "12:10"));
        service.create(7L, situation("09:00", "18:00"));
        verify(repository, org.mockito.Mockito.times(3)).save(any(Schedule.class));
    }

    @Test
    @DisplayName("수정도 같은 검사를 한다")
    void updateRejectsBadRange() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        Schedule existing = new Schedule(7L, LocalDate.of(2026, 11, 24), "PLACE", null, "CAFE", null, "12:00", "13:00", null);
        when(repository.findByIdAndUserId(5L, 7L)).thenReturn(Optional.of(existing));
        assertThatThrownBy(() -> service.update(7L, 5L, place("13:00", "12:00")))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ScheduleErrorCode.INVALID_TIME_RANGE);
        assertThat(existing.getStartTime()).isEqualTo("12:00");
    }
}
