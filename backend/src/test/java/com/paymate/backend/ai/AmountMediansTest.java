package com.paymate.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AmountMediansTest {

    private static final long HOUR = 3_600_000_000_000L;

    private AiScheduleRepository repo;
    private long[] now;
    private AmountMedians medians;

    @BeforeEach
    void setUp() {
        repo = mock(AiScheduleRepository.class);
        now = new long[]{0};
        medians = new AmountMedians(repo, () -> now[0], 1000);
    }

    @Test
    @DisplayName("금액: 내 결제 중앙값 → 전체 사용자 중앙값 → 10,000원 순서")
    void order() {
        when(repo.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(repo.medianAmountOfUser(7L, "GAS")).thenReturn(null);
        when(repo.medianAmount("GAS")).thenReturn(52000);
        when(repo.medianAmountOfUser(7L, "HOSPITAL")).thenReturn(0);
        when(repo.medianAmount("HOSPITAL")).thenReturn(null);

        assertThat(medians.amountOf(7L, "CAFE")).isEqualTo(5600);
        assertThat(medians.amountOf(7L, "GAS")).isEqualTo(52000);
        assertThat(medians.amountOf(7L, "HOSPITAL")).isEqualTo(10000);
    }

    @Test
    @DisplayName("한 번 계산한 중앙값은 1시간 동안 다시 계산하지 않는다 (일정 저장마다 113만 건을 훑지 않게, 2026-11-24)")
    void remembersForAnHour() {
        when(repo.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);

        medians.amountOf(7L, "CAFE");
        now[0] += HOUR - 1;
        assertThat(medians.amountOf(7L, "CAFE")).isEqualTo(5600);

        verify(repo, times(1)).medianAmountOfUser(7L, "CAFE");
    }

    @Test
    @DisplayName("1시간이 지나면 다시 계산한다")
    void recalculatesAfterAnHour() {
        when(repo.medianAmountOfUser(7L, "CAFE")).thenReturn(5600, 6100);

        medians.amountOf(7L, "CAFE");
        now[0] += HOUR;

        assertThat(medians.amountOf(7L, "CAFE")).isEqualTo(6100);
        verify(repo, times(2)).medianAmountOfUser(7L, "CAFE");
    }

    @Test
    @DisplayName("'내 결제 없음'도 기억하고, 전체 사용자 중앙값은 사용자끼리 같이 쓴다")
    void remembersEmptyAndSharesEveryone() {
        when(repo.medianAmountOfUser(7L, "GAS")).thenReturn(null);
        when(repo.medianAmountOfUser(8L, "GAS")).thenReturn(null);
        when(repo.medianAmount("GAS")).thenReturn(52000);

        medians.amountOf(7L, "GAS");
        medians.amountOf(7L, "GAS");
        assertThat(medians.amountOf(8L, "GAS")).isEqualTo(52000);

        verify(repo, times(1)).medianAmountOfUser(7L, "GAS");
        verify(repo, times(1)).medianAmount("GAS");
    }

    @Test
    @DisplayName("기억한 것이 너무 많아지면 비우고 새로 기억한다 (메모리가 끝없이 늘지 않게)")
    void clearsWhenFull() {
        medians = new AmountMedians(repo, () -> now[0], 2);
        when(repo.medianAmountOfUser(7L, "CAFE")).thenReturn(5600);
        when(repo.medianAmountOfUser(8L, "CAFE")).thenReturn(4800);
        when(repo.medianAmountOfUser(9L, "CAFE")).thenReturn(4500);

        medians.amountOf(7L, "CAFE");
        medians.amountOf(8L, "CAFE");
        medians.amountOf(9L, "CAFE");   // 세 번째에서 가득 차 비운다
        medians.amountOf(7L, "CAFE");   // 비워졌으니 다시 계산

        verify(repo, times(2)).medianAmountOfUser(7L, "CAFE");
    }
}
