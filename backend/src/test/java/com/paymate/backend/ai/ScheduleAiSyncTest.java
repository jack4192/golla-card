package com.paymate.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.event.ScheduleChangedEvent;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class ScheduleAiSyncTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 11, 5);
    private static final LocalDate DAY = LocalDate.of(2026, 11, 6);

    private AiScheduleRepository schedules;
    private AiService ai;
    private ScheduleAiSync sync;

    @BeforeEach
    void setUp() {
        schedules = mock(AiScheduleRepository.class);
        ai = mock(AiService.class);
        when(ai.today()).thenReturn(TODAY);
        sync = new ScheduleAiSync(schedules, ai);
    }

    private static Schedule place(String category, String start, String end) {
        return new Schedule(7L, DAY, "PLACE", null, category, null, start, end, null);
    }

    private static Schedule situation(String types) {
        return new Schedule(7L, DAY, "SITUATION", types, null, null, null, null, null);
    }

    private void stored(Schedule... items) {
        when(schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(7L, DAY)).thenReturn(List.of(items));
    }

    @Test
    @DisplayName("장소 일정만 넘긴다. 상황 일정과 직접 입력(OTHER)은 넘기지 않는다")
    void onlyPlaceSchedules() {
        stored(situation("회식"), place("CAFE", "12:00", "13:00"), place("OTHER", "15:00", "16:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).containsExactly(Map.of("start", "12:00", "end", "13:00", "category", "CAFE", "amount", 5600));
    }

    @Test
    @DisplayName("금액: 내 결제 중앙값 → 전체 사용자 중앙값 → 10,000원 순서로 채운다")
    void amount() {
        stored(place("CAFE", "09:00", "10:00"), place("GAS", "11:00", "12:00"), place("HOSPITAL", "14:00", "15:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(schedules.medianAmountOfUser(7L, "GAS")).thenReturn(null);
        when(schedules.medianAmount("GAS")).thenReturn(52000);
        when(schedules.medianAmountOfUser(7L, "HOSPITAL")).thenReturn(null);
        when(schedules.medianAmount("HOSPITAL")).thenReturn(null);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).extracting(i -> i.get("amount")).containsExactly(5600, 52000, 10000);
    }

    @Test
    @DisplayName("끝 24:00 은 23:59 로 바꾸고, 시간이 없거나 끝이 시작보다 빠른 일정은 뺀다")
    void times() {
        stored(place("CAFE", "22:00", "24:00"), place("MART", "13:00", "12:00"), place("GAS", null, null));
        when(schedules.medianAmountOfUser(any(), any())).thenReturn(1000);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).hasSize(1);
        assertThat(items.get(0)).containsEntry("start", "22:00").containsEntry("end", "23:59");
    }

    @Test
    @DisplayName("하루에 10개까지만 넘긴다 (AI 엔진 제한)")
    void atMostTen() {
        List<Schedule> many = new ArrayList<>();
        for (int hour = 8; hour < 20; hour++) {
            many.add(place("CAFE", String.format("%02d:00", hour), String.format("%02d:30", hour)));
        }
        when(schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(7L, DAY)).thenReturn(many);
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).hasSize(10);
        assertThat(items.get(9)).containsEntry("start", "17:00");
    }

    @Test
    @DisplayName("일정이 바뀌면 그 날짜의 일정을 통째로 AI 에 넘긴다. 남은 일정이 없으면 빈 목록")
    void onChange() {
        stored(place("CAFE", "12:00", "13:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        LocalDate emptyDay = LocalDate.of(2026, 11, 7);
        when(schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(7L, emptyDay)).thenReturn(List.of());

        sync.on(new ScheduleChangedEvent(7L, Set.of(DAY, emptyDay)));

        verify(ai).putSchedule(7L, DAY,
                List.of(Map.of("start", "12:00", "end", "13:00", "category", "CAFE", "amount", 5600)));
        verify(ai).putSchedule(7L, emptyDay, List.of());
    }

    @Test
    @DisplayName("지난 날의 일정은 AI 가 받지 않으므로 넘기지 않는다")
    void pastDay() {
        sync.on(new ScheduleChangedEvent(7L, Set.of(LocalDate.of(2026, 11, 4))));

        verify(ai, never()).putSchedule(any(), any(), any());
    }

    @Test
    @DisplayName("AI 에 넘기지 못해도 일정 저장은 성공해야 하므로 예외를 내지 않는다")
    void failureIsSwallowedOnChange() {
        stored(place("CAFE", "12:00", "13:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.putSchedule(eq(7L), eq(DAY), any()))
                .thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));

        assertThatCode(() -> sync.on(new ScheduleChangedEvent(7L, Set.of(DAY)))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("다시 넘기기 API 는 실패를 그대로 알리고, 성공하면 AI 의 답을 돌려준다")
    void manualSync() {
        stored(place("CAFE", "12:00", "13:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.putSchedule(eq(7L), eq(DAY), any())).thenReturn("{\"day\":\"2026-11-06\"}");

        assertThat(sync.sync(7L, DAY)).isEqualTo("{\"day\":\"2026-11-06\"}");

        when(ai.putSchedule(eq(7L), eq(DAY), any()))
                .thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));
        assertThatThrownBy(() -> sync.sync(7L, DAY)).isInstanceOf(AiException.class);
    }
}
