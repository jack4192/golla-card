package com.paymate.backend.payment.service;

import com.paymate.backend.common.DemoClock;
import com.paymate.backend.payment.dto.PaymentResponse;
import com.paymate.backend.payment.dto.YearSummaryResponse;
import com.paymate.backend.payment.repository.PaymentRepository;
import com.paymate.backend.payment.repository.PaymentRow;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 결제 내역 (홈 시간 표시줄의 결제 점·최근 결제, 2026-11-23). 기준 시각(ai.fixed-at 이 있으면 그 시각, 없으면 서울 현재)
 * 이후 결제는 돌려주지 않는다: 가상 결제 데이터는 앞으로의 날짜(2026-11-26 까지)까지 들어 있기 때문이다.
 */
@Service
public class PaymentService {

    private static final int DEFAULT_LIMIT = 5;
    private static final int MAX_LIMIT = 50;

    private final PaymentRepository payments;
    private final DemoClock clock;

    public PaymentService(PaymentRepository payments, @Value("${ai.fixed-at:}") String fixedAt) {
        this.payments = payments;
        this.clock = DemoClock.of(fixedAt);
    }

    /** 그날 결제, 시간순. 오늘이면 기준 시각까지, 미래 날짜면 빈 목록. */
    public List<PaymentResponse> ofDay(Long userId, LocalDate day) {
        LocalDateTime now = clock.now();
        if (day.isAfter(now.toLocalDate())) {
            return List.of();
        }
        LocalDateTime dayEnd = day.atTime(LocalTime.MAX);
        LocalDateTime until = dayEnd.isAfter(now) ? now : dayEnd;
        return payments.findBetween(userId, day.atStartOfDay(), until).stream().map(PaymentResponse::from).toList();
    }

    /**
     * 연말 결산의 받은 혜택 (2026-11-24): 기준 시각이 속한 해의 1월 1일부터 기준 시각까지, 홈과 같은 결제 읽기(findBetween)로
     * 읽어 달별·카드별로 더한다. 혜택·행사가 비어 있는 결제는 0으로 센다.
     */
    public YearSummaryResponse yearSummary(Long userId) {
        LocalDateTime now = clock.now().truncatedTo(ChronoUnit.SECONDS);
        LocalDate from = LocalDate.of(now.getYear(), 1, 1);
        List<PaymentRow> rows = payments.findBetween(userId, from.atStartOfDay(), now);

        Map<String, Sum> byMonth = new LinkedHashMap<>();
        for (int m = 1; m <= now.getMonthValue(); m++) {
            byMonth.put(String.format("%d-%02d", now.getYear(), m), new Sum());
        }
        Map<Long, Sum> byCard = new LinkedHashMap<>();
        Map<Long, String> cardNames = new HashMap<>();
        Sum all = new Sum();
        for (PaymentRow row : rows) {
            int benefit = orZero(row.getBenefitAmount());
            int promotion = orZero(row.getPromotionAmount());
            all.add(benefit, promotion);
            byMonth.computeIfAbsent(row.getPaidAt().substring(0, 7), k -> new Sum()).add(benefit, promotion);
            byCard.computeIfAbsent(row.getUserCardId(), k -> new Sum()).add(benefit, promotion);
            cardNames.putIfAbsent(row.getUserCardId(), row.getCardName());
        }

        List<YearSummaryResponse.MonthSum> months = byMonth.entrySet().stream()
                .map(e -> new YearSummaryResponse.MonthSum(e.getKey(), e.getValue().count, e.getValue().benefit,
                        e.getValue().promotion, e.getValue().total()))
                .toList();
        List<YearSummaryResponse.CardSum> cards = byCard.entrySet().stream()
                .map(e -> new YearSummaryResponse.CardSum(e.getKey(), cardNames.get(e.getKey()), e.getValue().count,
                        e.getValue().benefit, e.getValue().promotion, e.getValue().total()))
                .sorted(Comparator.comparingLong(YearSummaryResponse.CardSum::total).reversed()
                        .thenComparing(YearSummaryResponse.CardSum::userCardId))
                .toList();
        return new YearSummaryResponse(now.getYear(), from.toString(), now.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME),
                all.count, all.benefit, all.promotion, all.total(), months, cards);
    }

    private static int orZero(Integer value) {
        return value == null ? 0 : value;
    }

    /** 건수·카드 혜택·가맹점 행사 합. */
    private static final class Sum {
        int count;
        long benefit;
        long promotion;

        void add(int benefitAmount, int promotionAmount) {
            count++;
            benefit += benefitAmount;
            promotion += promotionAmount;
        }

        long total() {
            return benefit + promotion;
        }
    }

    /** 최근순. limit 은 기본 5, 1~50. beforeId 가 있으면 그 번호보다 오래된 것 (다음 쪽). */
    public List<PaymentResponse> recent(Long userId, Long beforeId, Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, limit));
        return payments.findRecent(userId, clock.now(), beforeId, size).stream().map(PaymentResponse::from).toList();
    }
}
