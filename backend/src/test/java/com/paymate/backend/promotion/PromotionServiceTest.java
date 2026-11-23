package com.paymate.backend.promotion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.paymate.backend.promotion.dto.PromotionResponse;
import com.paymate.backend.promotion.repository.PromotionRepository;
import com.paymate.backend.promotion.repository.PromotionRow;
import com.paymate.backend.promotion.service.PromotionService;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class PromotionServiceTest {

    /** DB promotions 한 행 (화면용 칸이 비어 있으면 null). */
    record Row(Long promotionId, String kind, String displayName, String merchantName, String promoName,
               String benefitType, String benefitText, Integer minAmount, Integer maxAmount,
               String displayStart, String displayEnd, String startDate, String endDate,
               String payout, String payMethod, String note, Boolean needsCheck, String logoUrl) implements PromotionRow {
        public Long getPromotionId() { return promotionId; }
        public String getKind() { return kind; }
        public String getDisplayName() { return displayName; }
        public String getMerchantName() { return merchantName; }
        public String getPromoName() { return promoName; }
        public String getBenefitType() { return benefitType; }
        public String getBenefitText() { return benefitText; }
        public Integer getMinAmount() { return minAmount; }
        public Integer getMaxAmount() { return maxAmount; }
        public String getDisplayStart() { return displayStart; }
        public String getDisplayEnd() { return displayEnd; }
        public String getStartDate() { return startDate; }
        public String getEndDate() { return endDate; }
        public String getPayout() { return payout; }
        public String getPayMethod() { return payMethod; }
        public String getNote() { return note; }
        public Boolean getNeedsCheck() { return needsCheck; }
        public String getLogoUrl() { return logoUrl; }
    }

    private static List<PromotionResponse> listOf(Row... rows) {
        PromotionRepository repository = mock(PromotionRepository.class);
        when(repository.findAllForList()).thenReturn(List.of(rows));
        return new PromotionService(repository).list();
    }

    @Test
    @DisplayName("화면 이름·실제 기간이 있으면 그 값, 최소 결제 0 은 null")
    void screenValues() {
        PromotionResponse r = listOf(new Row(3L, "event", "온라인 다이소몰", "다이소몰", "다이소데이 페이팡팡 500P 추가 적립",
                "point", "500 마이신한포인트 추가 적립", 0, null, "2026-11-16", "2026-11-30", "2025-11-01", "2026-11-30",
                "2026-12-10", "신한 슈퍼SOL/SOL페이 결제", "다이소데이 11월 16일 오픈", false, "/brand-logos/daiso.png")).get(0);
        assertThat(r.name()).isEqualTo("온라인 다이소몰");
        assertThat(r.start()).isEqualTo("2026-11-16");
        assertThat(r.end()).isEqualTo("2026-11-30");
        assertThat(r.minAmount()).isNull();
        assertThat(r.method()).isEqualTo("신한 슈퍼SOL/SOL페이 결제");
        assertThat(r.logoUrl()).isEqualTo("/brand-logos/daiso.png");
        assertThat(r.needsCheck()).isFalse();
    }

    @Test
    @DisplayName("화면용 칸이 비어 있으면 가맹점 이름·점수 기간으로 대신한다 (마이그레이션 전 행)")
    void fallbacks() {
        PromotionResponse r = listOf(new Row(8L, "myshop", null, "11번가", "마이샵 혜택", null, null, 50000, null,
                null, null, "2025-11-01", "2026-11-30", null, null, null, null, null)).get(0);
        assertThat(r.name()).isEqualTo("11번가");
        assertThat(r.start()).isEqualTo("2025-11-01");
        assertThat(r.minAmount()).isEqualTo(50000);
        assertThat(r.needsCheck()).isFalse();
        assertThat(r.logoUrl()).isNull();
        PromotionResponse noMerchant = listOf(new Row(9L, "myshop", null, null, "마이샵 혜택", null, null, 0, null,
                null, null, "2025-11-01", "2026-11-15", null, null, null, null, null)).get(0);
        assertThat(noMerchant.name()).isEqualTo("마이샵 혜택");
    }

    @Test
    @DisplayName("이벤트가 마이샵보다 먼저, 같은 종류는 번호 순")
    void order() {
        Row myshop7 = new Row(7L, "myshop", "살롱드마샬", "살롱드마샬", "마이샵 혜택", "discount", "최대 20% 할인", 0, null,
                "2026-11-20", "2026-11-30", "2025-11-01", "2026-11-30", "결제일에 따라 다름", "마이샵 혜택 ON 설정 후 신한카드 결제", null, false, null);
        Row event2 = new Row(2L, "event", "온라인 다이소몰", "다이소몰", "다이소몰 결제 시 1,000포인트 적립", "point", "1,000 마이신한포인트 적립",
                30000, null, "2026-11-01", "2026-11-30", "2025-11-01", "2026-11-30", "2026-12-10", "신한 슈퍼SOL/SOL페이 결제", "3만 원 이상 결제", false, null);
        Row event1 = new Row(1L, "event", "메가MGC커피", "메가MGC커피", "메가", "point", "500 마이신한포인트 적립", 0, null,
                "2026-11-01", "2026-11-30", "2025-11-01", "2026-11-30", "2026-12-13", "바코드", null, false, "/brand-logos/mega.png");
        assertThat(listOf(myshop7, event2, event1)).extracting(PromotionResponse::promotionId).containsExactly(1L, 2L, 7L);
    }
}
