package com.paymate.backend.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.paymate.backend.common.DemoClock;
import com.paymate.backend.payment.dto.PaymentResponse;
import com.paymate.backend.payment.dto.YearSummaryResponse;
import com.paymate.backend.payment.repository.PaymentRepository;
import com.paymate.backend.payment.repository.PaymentRow;
import com.paymate.backend.payment.service.PaymentService;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PaymentServiceTest {

    record Row(Long paymentId, String paidAt, String merchantName, String category, String categoryName,
               Integer amount, Integer benefitAmount, Integer promotionAmount, Long userCardId, String cardName)
            implements PaymentRow {
        public Long getPaymentId() { return paymentId; }
        public String getPaidAt() { return paidAt; }
        public String getMerchantName() { return merchantName; }
        public String getCategory() { return category; }
        public String getCategoryName() { return categoryName; }
        public Integer getAmount() { return amount; }
        public Integer getBenefitAmount() { return benefitAmount; }
        public Integer getPromotionAmount() { return promotionAmount; }
        public Long getUserCardId() { return userCardId; }
        public String getCardName() { return cardName; }
    }

    /** 받은 인자를 기록하는 가짜 저장소. */
    static class FakeRepository implements PaymentRepository {
        final List<Object[]> between = new ArrayList<>();
        final List<Object[]> recent = new ArrayList<>();
        List<PaymentRow> rows = List.of(new Row(9L, "2026-11-04T08:12:00", "스타벅스", "CAFE", "카페",
                5400, 540, 0, 3L, "신한 모두의카드"));

        @Override
        public List<PaymentRow> findBetween(Long userId, LocalDateTime from, LocalDateTime until) {
            between.add(new Object[] {userId, from, until});
            return rows;
        }

        @Override
        public List<PaymentRow> findRecent(Long userId, LocalDateTime until, Long beforeId, int limit) {
            recent.add(new Object[] {userId, until, beforeId, limit});
            return rows;
        }
    }

    private final FakeRepository repository = new FakeRepository();

    private PaymentService service(String fixedAt) {
        return new PaymentService(repository, fixedAt);
    }

    @Test
    @DisplayName("그날 결제는 기준 시각까지만 (오늘)")
    void ofDayStopsAtNow() {
        List<PaymentResponse> rows = service("2026-11-04T12:00:00").ofDay(1L, LocalDate.of(2026, 11, 4));
        assertThat(repository.between.get(0)).containsExactly(1L, LocalDateTime.of(2026, 11, 4, 0, 0),
                LocalDateTime.of(2026, 11, 4, 12, 0));
        assertThat(rows).singleElement().satisfies(row -> {
            assertThat(row.paymentId()).isEqualTo(9L);
            assertThat(row.paidAt()).isEqualTo("2026-11-04T08:12:00");
            assertThat(row.cardName()).isEqualTo("신한 모두의카드");
            assertThat(row.benefitAmount()).isEqualTo(540);
        });
    }

    @Test
    @DisplayName("올해 결산: 1월 1일부터 기준 시각까지 읽는다")
    void yearSummaryRange() {
        YearSummaryResponse s = service("2026-03-05T10:15:30").yearSummary(1L);
        assertThat(repository.between.get(0)).containsExactly(1L, LocalDateTime.of(2026, 1, 1, 0, 0),
                LocalDateTime.of(2026, 3, 5, 10, 15, 30));
        assertThat(s.year()).isEqualTo(2026);
        assertThat(s.from()).isEqualTo("2026-01-01");
        assertThat(s.until()).isEqualTo("2026-03-05T10:15:30");
    }

    @Test
    @DisplayName("올해 결산: 합계, 빈 달은 0, 카드는 받은 혜택 큰 순, 빈 혜택은 0")
    void yearSummarySums() {
        repository.rows = List.of(
                new Row(1L, "2026-01-03T09:00:00", "스타벅스", "CAFE", "카페", 5400, 540, 0, 3L, "신한 모두의카드"),
                new Row(2L, "2026-01-20T12:00:00", "이마트", "MART", "마트", 50000, 1000, 500, 2L, "KB ALL 카드"),
                new Row(3L, "2026-03-01T08:00:00", "GS25", "CVS", "편의점", 3000, null, null, 3L, "신한 모두의카드"));
        YearSummaryResponse s = service("2026-03-05T10:15:30").yearSummary(1L);
        assertThat(s.count()).isEqualTo(3);
        assertThat(s.benefit()).isEqualTo(1540L);
        assertThat(s.promotion()).isEqualTo(500L);
        assertThat(s.total()).isEqualTo(2040L);
        assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::month).containsExactly("2026-01", "2026-02", "2026-03");
        assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::total).containsExactly(2040L, 0L, 0L);
        assertThat(s.months()).extracting(YearSummaryResponse.MonthSum::count).containsExactly(2, 0, 1);
        assertThat(s.cards()).extracting(YearSummaryResponse.CardSum::userCardId).containsExactly(2L, 3L);
        assertThat(s.cards()).extracting(YearSummaryResponse.CardSum::total).containsExactly(1500L, 540L);
        assertThat(s.cards().get(1).count()).isEqualTo(2);
    }

    @Test
    @DisplayName("지난 날은 그날 끝까지")
    void ofDayPastDayUsesDayEnd() {
        service("2026-11-04T12:00:00").ofDay(1L, LocalDate.of(2026, 11, 3));
        assertThat(repository.between.get(0)[2]).isEqualTo(LocalDateTime.of(2026, 11, 3, 23, 59, 59, 999_999_999));
    }

    @Test
    @DisplayName("미래 날짜는 조회 없이 빈 목록")
    void futureDayIsEmptyWithoutQuery() {
        assertThat(service("2026-11-04T12:00:00").ofDay(1L, LocalDate.of(2026, 11, 5))).isEmpty();
        assertThat(repository.between).isEmpty();
    }

    @Test
    @DisplayName("최근 결제: 개수는 기본 5, 1~50 으로 자르고, 기준 시각까지, beforeId 는 그대로")
    void recentLimitClamped() {
        PaymentService payments = service("2026-11-04T12:00:00");
        payments.recent(1L, null, null);
        payments.recent(1L, null, 0);
        payments.recent(1L, 77L, 500);
        assertThat(repository.recent).extracting(args -> args[3]).containsExactly(5, 1, 50);
        assertThat(repository.recent.get(2)[2]).isEqualTo(77L);
        assertThat(repository.recent.get(0)[1]).isEqualTo(LocalDateTime.of(2026, 11, 4, 12, 0));
    }

    @Test
    @DisplayName("기준 시각 형식: 시간대 없는 값·있는 값 모두, 틀리면 알린다")
    void demoClockFormats() {
        assertThat(DemoClock.of("2026-11-05T09:30:00").today()).isEqualTo(LocalDate.of(2026, 11, 5));
        assertThat(DemoClock.of("2026-11-05T09:30:00+09:00").today()).isEqualTo(LocalDate.of(2026, 11, 5));
        assertThat(DemoClock.of("2026-11-05T09:30:00").now()).isEqualTo(LocalDateTime.of(2026, 11, 5, 9, 30));
        assertThat(DemoClock.of("").fixedAt()).isNull();
        assertThatThrownBy(() -> DemoClock.of("oops")).isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ai.fixed-at");
    }
}
