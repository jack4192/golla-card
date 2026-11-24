package com.paymate.backend.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.paymate.backend.payment.benefit.BenefitCalculator;
import com.paymate.backend.payment.benefit.BenefitResult;
import com.paymate.backend.payment.repository.BenefitCandidateRow;
import com.paymate.backend.payment.repository.BenefitRuleRepository;
import com.paymate.backend.payment.repository.BenefitUsageRow;
import com.paymate.backend.payment.repository.MonthStatusRow;
import com.paymate.backend.payment.repository.PromotionRow;
import com.paymate.backend.payment.repository.TierRow;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 결제 한 건의 혜택 계산 (PR #6, 2026-11-24). 저장소는 가짜로 두고 계산 규칙만 본다. */
class BenefitCalculatorTest {

    private static final long USER_CARD = 3L;
    private static final long CARD = 10L;
    private static final long MERCHANT = 77L;
    // 2026-11-24 (화) 12:30
    private static final LocalDateTime AT = LocalDateTime.of(2026, 11, 24, 12, 30);

    record Tier(Long tierId, Integer tierNo, Integer minAmount, Integer totalLimit) implements TierRow {
        public Long getTierId() { return tierId; }
        public Integer getTierNo() { return tierNo; }
        public Integer getMinAmount() { return minAmount; }
        public Integer getTotalLimit() { return totalLimit; }
    }

    record Month(Integer prevPerf, Long tierId) implements MonthStatusRow {
        public Integer getPrevPerf() { return prevPerf; }
        public Long getTierId() { return tierId; }
    }

    record Usage(Long benefitId, Long groupId, Long cnt, Long usageAmount, Long benefitAmount) implements BenefitUsageRow {
        public Long getBenefitId() { return benefitId; }
        public Long getGroupId() { return groupId; }
        public Long getCnt() { return cnt; }
        public Long getUsageAmount() { return usageAmount; }
        public Long getBenefitAmount() { return benefitAmount; }
    }

    record Promo(Long promotionId, String name, String valueType, BigDecimal value, Integer maxAmount) implements PromotionRow {
        public Long getPromotionId() { return promotionId; }
        public String getName() { return name; }
        public String getValueType() { return valueType; }
        public BigDecimal getValue() { return value; }
        public Integer getMaxAmount() { return maxAmount; }
    }

    /** 후보 혜택. 기본은 조건 없는 RATE 혜택이고, with... 로 바꾼다. */
    static final class Candidate implements BenefitCandidateRow {
        Long benefitId;
        String name;
        String valueType = "RATE";
        String limitBasis = "BENEFIT";
        String payType;
        Integer minPayAmount;
        String timeFrom;
        String timeTo;
        String days;
        Integer dailyCount;
        Long groupId;
        BigDecimal value;
        Integer monthlyLimit;
        Integer monthlyCount;
        Integer perPaymentLimit;
        Integer groupMonthlyLimit;

        Candidate(long benefitId, String name, String value) {
            this.benefitId = benefitId;
            this.name = name;
            this.value = new BigDecimal(value);
        }

        public Long getBenefitId() { return benefitId; }
        public String getName() { return name; }
        public String getValueType() { return valueType; }
        public String getLimitBasis() { return limitBasis; }
        public String getPayType() { return payType; }
        public Integer getMinPayAmount() { return minPayAmount; }
        public String getTimeFrom() { return timeFrom; }
        public String getTimeTo() { return timeTo; }
        public String getDays() { return days; }
        public Integer getDailyCount() { return dailyCount; }
        public Long getGroupId() { return groupId; }
        public BigDecimal getValue() { return value; }
        public Integer getMonthlyLimit() { return monthlyLimit; }
        public Integer getMonthlyCount() { return monthlyCount; }
        public Integer getPerPaymentLimit() { return perPaymentLimit; }
        public Integer getGroupMonthlyLimit() { return groupMonthlyLimit; }
    }

    private BenefitRuleRepository rules;
    private BenefitCalculator calculator;

    @BeforeEach
    void setUp() {
        rules = mock(BenefitRuleRepository.class);
        calculator = new BenefitCalculator(rules);
        // 구간: 0원 이상 1구간(통합 한도 없음), 30만 원 이상 2구간(통합 한도 20,000원)
        when(rules.findTiers(CARD)).thenReturn(List.of(new Tier(101L, 1, 0, null), new Tier(102L, 2, 300_000, 20_000)));
        when(rules.findMonthStatus(USER_CARD, "2026-11")).thenReturn(List.of(new Month(350_000, 102L)));
        when(rules.findUsage(eq(USER_CARD), any(), any())).thenReturn(List.of());
        when(rules.findPromotions(anyLong(), anyLong(), anyString(), anyString(), any(), anyInt())).thenReturn(List.of());
    }

    private void candidates(Candidate... list) {
        when(rules.findCandidates(eq(CARD), any(), eq("CAFE"), eq("스타벅스"))).thenReturn(List.of(list));
    }

    private BenefitResult pay(int amount) {
        return calculator.calculate(USER_CARD, CARD, MERCHANT, "CAFE", "스타벅스", amount, AT);
    }

    @Test
    @DisplayName("후보 중 가장 큰 혜택 1개만, 10원 단위로 내린다")
    void bestCandidateRoundedDown() {
        candidates(new Candidate(1, "카페 5%", "5"), new Candidate(2, "카페 7%", "7"));

        BenefitResult r = pay(12_345);          // 7% = 864.15 → 860

        assertThat(r.benefitId()).isEqualTo(2L);
        assertThat(r.benefitName()).isEqualTo("카페 7%");
        assertThat(r.benefitAmount()).isEqualTo(860);
        assertThat(r.prevPerf()).isEqualTo(350_000);
        assertThat(r.tierId()).isEqualTo(102L);
    }

    @Test
    @DisplayName("이번 달 기록이 없으면 지난달 이용금액으로 구간을 고른다")
    void tierFromLastMonth() {
        when(rules.findMonthStatus(USER_CARD, "2026-11")).thenReturn(List.of());
        when(rules.findPerf(USER_CARD, "2026-10")).thenReturn(120_000);
        candidates(new Candidate(1, "카페 10%", "10"));

        BenefitResult r = pay(5_000);

        assertThat(r.tierId()).isEqualTo(101L);
        assertThat(r.prevPerf()).isEqualTo(120_000);
        assertThat(r.benefitAmount()).isEqualTo(500);
    }

    @Test
    @DisplayName("월 한도·카드 통합 한도에서 이미 받은 만큼을 뺀다")
    void limits() {
        Candidate c = new Candidate(1, "카페 50%", "50");
        c.monthlyLimit = 5_000;
        candidates(c);
        when(rules.findUsage(eq(USER_CARD), eq(LocalDateTime.of(2026, 11, 1, 0, 0)), any()))
                .thenReturn(List.of(new Usage(1L, null, 3L, 30_000L, 4_200L)));

        assertThat(pay(10_000).benefitAmount()).isEqualTo(800);     // 월 한도 5,000 - 이미 4,200

        when(rules.findUsage(eq(USER_CARD), eq(LocalDateTime.of(2026, 11, 1, 0, 0)), any()))
                .thenReturn(List.of(new Usage(9L, null, 10L, 100_000L, 19_700L)));   // 다른 혜택으로 19,700 받음
        assertThat(pay(10_000).benefitAmount()).isEqualTo(300);     // 통합 한도 20,000 - 19,700
    }

    @Test
    @DisplayName("조건(시간대·최소 금액·하루 횟수)에 안 맞으면 혜택이 없다")
    void conditions() {
        Candidate morning = new Candidate(1, "아침 카페", "20");
        morning.timeFrom = "07:00";
        morning.timeTo = "10:00";
        Candidate big = new Candidate(2, "2만 원 이상", "20");
        big.minPayAmount = 20_000;
        Candidate once = new Candidate(3, "하루 1회", "20");
        once.dailyCount = 1;
        candidates(morning, big, once);
        when(rules.findUsage(eq(USER_CARD), eq(LocalDateTime.of(2026, 11, 24, 0, 0)), any()))
                .thenReturn(List.of(new Usage(3L, null, 1L, 5_000L, 1_000L)));   // 오늘 이미 1회

        BenefitResult r = pay(10_000);

        assertThat(r.benefitId()).isNull();
        assertThat(r.benefitAmount()).isZero();
    }

    @Test
    @DisplayName("프로모션은 카드 혜택과 따로 더하고, 최대 금액으로 자른다")
    void promotionAdded() {
        candidates(new Candidate(1, "카페 10%", "10"));
        when(rules.findPromotions(CARD, MERCHANT, "CAFE", "스타벅스", AT.toLocalDate(), 30_000))
                .thenReturn(List.of(new Promo(55L, "스벅 20%", "RATE", new BigDecimal("20"), 3_000),
                        new Promo(56L, "정액 1,000원", "FIXED", new BigDecimal("1000"), null)));

        BenefitResult r = pay(30_000);

        assertThat(r.benefitAmount()).isEqualTo(3_000);             // 10%
        assertThat(r.promotionId()).isEqualTo(55L);
        assertThat(r.promotionAmount()).isEqualTo(3_000);           // 20% = 6,000 → 최대 3,000
        assertThat(r.totalAmount()).isEqualTo(6_000);
    }
}
