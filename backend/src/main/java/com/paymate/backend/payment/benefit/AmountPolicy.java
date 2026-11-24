package com.paymate.backend.payment.benefit;

import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.stereotype.Component;

/**
 * 가상 POS 결제 금액을 업종별 범위 안에서 무작위로 정합니다.
 * 범위는 시드 결제 데이터의 업종별 10~90% 구간을 참고했습니다. 100원 단위로 맞춥니다.
 */
@Component
public class AmountPolicy {

    private record Range(int min, int max) {
    }

    private static final Range DEFAULT = new Range(5_000, 30_000);

    private static final Map<String, Range> RANGES = Map.ofEntries(
            Map.entry("CAFE", new Range(3_000, 12_000)),
            Map.entry("CONVENIENCE", new Range(1_500, 12_000)),
            Map.entry("RESTAURANT", new Range(6_000, 50_000)),
            Map.entry("FAST_FOOD", new Range(3_000, 14_000)),
            Map.entry("SUPERMARKET", new Range(9_000, 60_000)),
            Map.entry("BAKERY", new Range(2_500, 15_000)),
            Map.entry("MART", new Range(20_000, 150_000)),
            Map.entry("HOSPITAL", new Range(8_000, 50_000)),
            Map.entry("BOOKSTORE", new Range(6_000, 45_000)),
            Map.entry("TAXI", new Range(4_000, 22_000)),
            Map.entry("MOVIE", new Range(5_000, 25_000)),
            Map.entry("DEPARTMENT_STORE", new Range(26_000, 300_000)),
            Map.entry("HNB", new Range(6_000, 40_000)),
            Map.entry("HEALTHY_FOOD", new Range(3_000, 15_000)),
            Map.entry("FUEL", new Range(20_000, 70_000))
    );

    public int randomAmount(String category) {
        Range r = RANGES.getOrDefault(category, DEFAULT);
        int steps = (r.max() - r.min()) / 100;
        return r.min() + ThreadLocalRandom.current().nextInt(steps + 1) * 100;
    }
}
