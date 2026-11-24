package com.paymate.backend.schedule;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;

/** 일정 날짜 범위(기준 시각 1년 전~1년 뒤)·하루 10개 제한 (2026-11-24 점검 문제 5). 기준 시각은 2026-11-24 10시로 고정. */
class ScheduleLimitTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 24);
    private final ScheduleRepository repository = mock(ScheduleRepository.class);
    private final ScheduleService service =
            new ScheduleService(repository, mock(ApplicationEventPublisher.class), "2026-11-24T10:00:00");

    private static ScheduleRequest cafe(LocalDate date) throws Exception {
        ScheduleRequest req = new ScheduleRequest();
        set(req, "date", date);
        set(req, "category", "CAFE");
        set(req, "start", "12:00");
        set(req, "end", "13:00");
        return req;
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private void rejects(ScheduleRequest req, ScheduleErrorCode code) {
        assertThatThrownBy(() -> service.create(7L, req))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(code);
    }

    @Test
    @DisplayName("일정 날짜는 기준 시각의 1년 전부터 1년 뒤까지")
    void dateRange() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        when(repository.save(any())).thenAnswer(call -> call.getArgument(0));
        rejects(cafe(TODAY.minusYears(1).minusDays(1)), ScheduleErrorCode.DATE_OUT_OF_RANGE);
        rejects(cafe(TODAY.plusYears(1).plusDays(1)), ScheduleErrorCode.DATE_OUT_OF_RANGE);
        service.create(7L, cafe(TODAY.minusYears(1)));
        service.create(7L, cafe(TODAY.plusYears(1)));
        verify(repository, times(2)).save(any(Schedule.class));
    }

    @Test
    @DisplayName("하루 일정은 10개까지 (AI 가 하루 10개까지만 받는다)")
    void perDayLimit() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        when(repository.countByUserIdAndScheduleDate(7L, TODAY)).thenReturn(10L);
        rejects(cafe(TODAY), ScheduleErrorCode.TOO_MANY_SCHEDULES);
        verify(repository, never()).save(any());
    }

    @Test
    @DisplayName("수정: 같은 날 안에서 고치면 개수를 세지 않고, 꽉 찬 다른 날로 옮기면 막는다")
    void updateLimit() throws Exception {
        when(repository.existsCategory("CAFE")).thenReturn(true);
        Schedule existing = new Schedule(7L, TODAY, "PLACE", null, "CAFE", null, "12:00", "13:00", null);
        when(repository.findByIdAndUserId(5L, 7L)).thenReturn(Optional.of(existing));
        when(repository.countByUserIdAndScheduleDate(7L, TODAY)).thenReturn(10L);
        when(repository.countByUserIdAndScheduleDate(7L, TODAY.plusDays(1))).thenReturn(10L);

        service.update(7L, 5L, cafe(TODAY));
        assertThatThrownBy(() -> service.update(7L, 5L, cafe(TODAY.plusDays(1))))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(ScheduleErrorCode.TOO_MANY_SCHEDULES);
    }
}
