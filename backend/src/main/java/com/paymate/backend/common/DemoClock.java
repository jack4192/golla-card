package com.paymate.backend.common;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;

/**
 * 서버가 보는 '지금' (서울 시간). 시연용 기준 시각(ai.fixed-at, AI_FIXED_AT)이 있으면 그 시각에 멈춰 있다.
 * AI 기능(AiService)과 결제 내역(PaymentService)이 같은 '지금'을 쓰게 한다 (2026-11-23 홈 시간 표시줄).
 */
public final class DemoClock {

    public static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final String fixedAt;
    private final LocalDateTime fixed;

    private DemoClock(String fixedAt, LocalDateTime fixed) {
        this.fixedAt = fixedAt;
        this.fixed = fixed;
    }

    /** 값이 비어 있으면 현재 시각을 따르고, 형식이 틀리면 IllegalArgumentException. */
    public static DemoClock of(String value) {
        if (value == null || value.isBlank()) {
            return new DemoClock(null, null);
        }
        String trimmed = value.trim();
        return new DemoClock(trimmed, parse(trimmed));
    }

    private static LocalDateTime parse(String value) {
        try {
            return LocalDateTime.parse(value);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(value).atZoneSameInstant(SEOUL).toLocalDateTime();
            } catch (DateTimeParseException e2) {
                throw new IllegalArgumentException(
                        "ai.fixed-at(AI_FIXED_AT) 형식이 올바르지 않습니다. 예: 2026-11-05T09:30:00 (값: " + value + ")");
            }
        }
    }

    public LocalDateTime now() {
        return fixed != null ? fixed : LocalDateTime.now(SEOUL);
    }

    public LocalDate today() {
        return now().toLocalDate();
    }

    /** 설정한 기준 시각 글자 그대로. 없으면 null. */
    public String fixedAt() {
        return fixedAt;
    }
}
