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
import org.mockito.Mockito;
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

    private static Schedule direct(String title, String start, String end) {
        return new Schedule(7L, DAY, "PLACE", null, "OTHER", title, start, end, null);
    }

    /** 일정 추가 창(팀원 PR #5)의 직접 입력: 상황 일정, 종류 other + 이름 (+ 시간). */
    private static Schedule typed(String types, String title, String start, String end) {
        return new Schedule(7L, DAY, "SITUATION", types, null, title, start, end, null);
    }

    // ---------- 맞춤 추천 전에 일정 맞추기 (2026-11-23) ----------

    @Test
    @DisplayName("AI 의 그날 일정이 서버 일정과 같으면 다시 넘기지 않는다 (브랜드 없음은 null 로 와도 같다)")
    void ensureSyncedSkipsWhenSame() {
        stored(place("CAFE", "12:00", "13:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.schedule(7L, DAY)).thenReturn("{\"day\":\"2026-11-06\",\"items\":[{\"start\":\"12:00\",\"end\":\"13:00\","
                + "\"category\":\"CAFE\",\"amount\":5600,\"brand\":null}]}");

        sync.ensureSynced(7L, DAY);

        verify(ai, never()).putSchedule(any(), any(), any());
    }

    @Test
    @DisplayName("AI 에 그날 일정이 없거나 다르면(옛 백엔드·AI 꺼짐 때 저장) 서버 일정으로 다시 넘긴다")
    void ensureSyncedPutsWhenDifferent() {
        stored(place("CAFE", "12:00", "13:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.schedule(7L, DAY)).thenReturn("{\"day\":\"2026-11-06\",\"items\":[]}");

        sync.ensureSynced(7L, DAY);

        verify(ai).putSchedule(7L, DAY, List.of(Map.of("start", "12:00", "end", "13:00", "category", "CAFE", "amount", 5600)));
    }

    @Test
    @DisplayName("직접 입력 분류가 이번에 실패하면 AI 의 일정을 바꾸지 않는다 (맞는 일정을 지우지 않게, 2026-11-23 리뷰)")
    void ensureSyncedKeepsAiScheduleWhenClassificationFails() {
        stored(direct("동네 영화관", "19:00", "21:00"));
        when(ai.classifyPlace("동네 영화관"))
                .thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));
        when(ai.schedule(7L, DAY)).thenReturn("{\"day\":\"2026-11-06\",\"items\":[{\"start\":\"19:00\",\"end\":\"21:00\","
                + "\"category\":\"MOVIE\",\"amount\":13200,\"brand\":null}]}");

        sync.ensureSynced(7L, DAY);

        verify(ai, never()).putSchedule(any(), any(), any());
    }

    @Test
    @DisplayName("일정 맞추기가 실패해도 예외를 내지 않는다 (맞춤 추천은 그대로 부른다)")
    void ensureSyncedSwallowsErrors() {
        stored(place("CAFE", "12:00", "13:00"));
        when(ai.schedule(7L, DAY)).thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));

        assertThatCode(() -> sync.ensureSynced(7L, DAY)).doesNotThrowAnyException();
        verify(ai, never()).putSchedule(any(), any(), any());
    }

    @Test
    @DisplayName("장소 일정만 넘긴다. 상황 일정과 이름 없는 직접 입력(OTHER)은 넘기지 않는다")
    void onlyPlaceSchedules() {
        stored(situation("회식"), place("CAFE", "12:00", "13:00"), place("OTHER", "15:00", "16:00"));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).containsExactly(Map.of("start", "12:00", "end", "13:00", "category", "CAFE", "amount", 5600));
        verify(ai, never()).classifyPlace(any());
    }

    @Test
    @DisplayName("직접 입력은 이름을 AI 분류기에 물어, 나온 업종·가맹점과 그 업종의 금액으로 넘긴다")
    void directInputIsClassified() {
        stored(direct(" 스타벅스 ", "09:00", "10:00"), direct("동네 헬스", "19:00", "20:00"));
        when(ai.classifyPlace("스타벅스")).thenReturn("{\"category\":\"CAFE\",\"brand\":\"STARBUCKS\",\"source\":\"search\"}");
        when(ai.classifyPlace("동네 헬스")).thenReturn("{\"category\":\"FITNESS\",\"brand\":null,\"source\":\"llm\"}");
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(schedules.medianAmountOfUser(7L, "FITNESS")).thenReturn(null);
        when(schedules.medianAmount("FITNESS")).thenReturn(70000);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).containsExactly(
                Map.of("start", "09:00", "end", "10:00", "category", "CAFE", "amount", 5600, "brand", "STARBUCKS"),
                Map.of("start", "19:00", "end", "20:00", "category", "FITNESS", "amount", 70000));
    }

    @Test
    @DisplayName("일정 추가 창의 직접 입력(상황 일정, 종류 other + 이름 + 시간)도 이름을 분류해 넘긴다. 다른 상황 일정·시간 없는 것은 넘기지 않는다")
    void typedDirectInputIsClassified() {
        stored(typed("other", "영화관", "12:00", "13:00"), typed("other", "하루 종일 일정", null, null),
                typed("회식", "팀 회식", "18:00", "20:00"), typed("other", "골프", "16:00", "20:00"));
        when(ai.classifyPlace("영화관")).thenReturn("{\"category\":\"MOVIE\",\"brand\":null,\"source\":\"llm\"}");
        when(ai.classifyPlace("골프")).thenReturn("{\"category\":\"GOLF\",\"brand\":null,\"source\":\"search\"}");
        when(schedules.medianAmountOfUser(7L, "MOVIE")).thenReturn(14000);
        when(schedules.medianAmountOfUser(7L, "GOLF")).thenReturn(150000);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).containsExactly(
                Map.of("start", "12:00", "end", "13:00", "category", "MOVIE", "amount", 14000),
                Map.of("start", "16:00", "end", "20:00", "category", "GOLF", "amount", 150000));
        verify(ai, never()).classifyPlace("팀 회식");
        verify(ai, never()).classifyPlace("하루 종일 일정");
    }

    @Test
    @DisplayName("업종을 못 찾았거나(null·OTHER) 분류에 실패한 직접 입력은 넘기지 않고, 예외도 내지 않는다")
    void unclassifiedDirectInputIsSkipped() {
        stored(direct("친구 만나기", "10:00", "11:00"), direct("GS", "12:00", "13:00"),
                direct("아무거나", "14:00", "15:00"), place("CAFE", "16:00", "17:00"));
        when(ai.classifyPlace("친구 만나기")).thenReturn("{\"category\":null,\"brand\":null,\"source\":\"none\"}");
        when(ai.classifyPlace("GS")).thenReturn("{\"category\":\"OTHER\"}");
        when(ai.classifyPlace("아무거나"))
                .thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).extracting(i -> i.get("category")).containsExactly("CAFE");
    }

    @Test
    @DisplayName("같은 이름은 한 번만 묻는다")
    void sameTitleAskedOnce() {
        stored(direct("스타벅스", "09:00", "10:00"), direct("스타벅스", "15:00", "16:00"));
        when(ai.classifyPlace("스타벅스")).thenReturn("{\"category\":\"CAFE\",\"brand\":\"STARBUCKS\"}");
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        assertThat(sync.itemsFor(7L, DAY)).hasSize(2);
        verify(ai).classifyPlace("스타벅스");   // 한 번만
    }

    @Test
    @DisplayName("분류에 4초를 다 쓰면 남은 직접 입력은 묻지 않고 넘기지 않는다 (일정 저장 응답을 붙잡지 않게)")
    void classifyBudget() {
        long[] now = {0};
        sync = new ScheduleAiSync(schedules, ai, () -> now[0]);
        stored(direct("스타벅스", "09:00", "10:00"), direct("올리브영", "12:00", "13:00"), place("CAFE", "16:00", "17:00"));
        when(ai.classifyPlace("스타벅스")).thenAnswer(call -> {
            now[0] += 4_000_000_000L;           // 이 분류가 4초 걸렸다
            return "{\"category\":\"CAFE\",\"brand\":\"STARBUCKS\"}";
        });
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        List<Map<String, Object>> items = sync.itemsFor(7L, DAY);

        assertThat(items).extracting(i -> i.get("start")).containsExactly("09:00", "16:00");
        verify(ai, never()).classifyPlace("올리브영");
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
    @DisplayName("같은 업종의 금액 중앙값은 일정이 여러 개거나 다시 넘겨도 한 번만 계산한다 (일정 저장 속도, 2026-11-24)")
    void medianOnce() {
        stored(place("GAS", "09:00", "10:00"), place("GAS", "11:00", "12:00"), place("GAS", "14:00", "15:00"));
        when(schedules.medianAmountOfUser(7L, "GAS")).thenReturn(null);
        when(schedules.medianAmount("GAS")).thenReturn(52000);

        sync.itemsFor(7L, DAY);
        List<Map<String, Object>> again = sync.itemsFor(7L, DAY);

        assertThat(again).extracting(i -> i.get("amount")).containsExactly(52000, 52000, 52000);
        verify(schedules, Mockito.times(1)).medianAmountOfUser(7L, "GAS");
        verify(schedules, Mockito.times(1)).medianAmount("GAS");
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
    @DisplayName("저장 때 직접 입력 분류가 늦거나 실패하면, 그 일정은 AI 에 이미 있던 값을 그대로 두고 나머지만 바꾼다 "
            + "(빈 목록으로 덮어써 표시줄에서 일정이 사라지던 문제, 2026-11-24)")
    void onChangeKeepsKnownItemsWhenClassificationFails() {
        stored(direct("영화관", "12:00", "13:00"), place("CAFE", "15:00", "16:00"), typed("other", "영화관", "20:00", "21:00"));
        when(ai.classifyPlace("영화관"))
                .thenThrow(new AiException(HttpStatus.GATEWAY_TIMEOUT, "AI_TIMEOUT", "AI 응답 시간이 지났습니다."));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.schedule(7L, DAY)).thenReturn("{\"day\":\"2026-11-06\",\"items\":[{\"start\":\"12:00\",\"end\":\"13:00\","
                + "\"category\":\"MOVIE\",\"amount\":10500,\"brand\":null},{\"start\":\"18:00\",\"end\":\"19:00\","
                + "\"category\":\"MART\",\"amount\":30000,\"brand\":null}]}");

        sync.on(new ScheduleChangedEvent(7L, Set.of(DAY)));

        // 12:00 영화관은 AI 에 있던 그대로, 15:00 카페는 새로, 지운 18:00 마트는 빠지고, 아직 분류 못 한 20:00 은 다음에
        verify(ai).putSchedule(7L, DAY, List.of(
                Map.of("start", "12:00", "end", "13:00", "category", "MOVIE", "amount", 10500),
                Map.of("start", "15:00", "end", "16:00", "category", "CAFE", "amount", 5600)));
    }

    @Test
    @DisplayName("분류에 실패했는데 AI 의 일정도 읽지 못하면 아무것도 넘기지 않는다 (맞는 일정을 지우지 않게)")
    void onChangeSkipsWhenClassificationFailsAndAiUnreadable() {
        stored(typed("other", "영화관", "20:00", "21:00"));
        when(ai.classifyPlace("영화관"))
                .thenThrow(new AiException(HttpStatus.GATEWAY_TIMEOUT, "AI_TIMEOUT", "AI 응답 시간이 지났습니다."));
        when(ai.schedule(7L, DAY)).thenThrow(new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다."));

        assertThatCode(() -> sync.on(new ScheduleChangedEvent(7L, Set.of(DAY)))).doesNotThrowAnyException();
        verify(ai, never()).putSchedule(any(), any(), any());
    }

    @Test
    @DisplayName("맞춤 추천·하루 배치 전 맞추기도 분류 못 한 일정은 AI 값을 두고, 나머지가 다르면 다시 넘긴다")
    void ensureSyncedMergesKnownItems() {
        stored(direct("동네 영화관", "19:00", "21:00"), place("CAFE", "09:00", "10:00"));
        when(ai.classifyPlace("동네 영화관"))
                .thenThrow(new AiException(HttpStatus.GATEWAY_TIMEOUT, "AI_TIMEOUT", "AI 응답 시간이 지났습니다."));
        when(schedules.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(ai.schedule(7L, DAY)).thenReturn("{\"day\":\"2026-11-06\",\"items\":[{\"start\":\"19:00\",\"end\":\"21:00\","
                + "\"category\":\"MOVIE\",\"amount\":13200,\"brand\":null}]}");

        sync.ensureSynced(7L, DAY);

        verify(ai).putSchedule(7L, DAY, List.of(
                Map.of("start", "09:00", "end", "10:00", "category", "CAFE", "amount", 5600),
                Map.of("start", "19:00", "end", "21:00", "category", "MOVIE", "amount", 13200)));
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
