package com.paymate.backend.payment.service;

import com.paymate.backend.common.DemoClock;
import com.paymate.backend.payment.dto.PaymentResponse;
import com.paymate.backend.payment.repository.PaymentRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
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

    /** 최근순. limit 은 기본 5, 1~50. beforeId 가 있으면 그 번호보다 오래된 것 (다음 쪽). */
    public List<PaymentResponse> recent(Long userId, Long beforeId, Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, limit));
        return payments.findRecent(userId, clock.now(), beforeId, size).stream().map(PaymentResponse::from).toList();
    }
}
