package com.paymate.backend.ai;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;
import java.util.function.Supplier;

/**
 * AI 엔진에 넘길 일정의 예상 금액: 내 결제 중앙값 → 전체 사용자 중앙값 → 10,000원.
 *
 * <p>중앙값은 결제 표(가상 데이터 113만 건)를 훑어 계산하므로 업종당 0.03~0.35초가 걸리고, 일정을 저장할 때마다
 * 그날 일정 전부를 다시 계산해 저장이 0.4~0.8초 걸렸다. 그래서 한 번 계산한 값은 1시간 동안 기억한다
 * (2026-11-24 팀 결정, 점검 보고서 문제 8). '결제 없음(null)'도 기억하고, 전체 사용자 중앙값은 사용자끼리 같이 쓴다.
 * 그 사이 생긴 결제는 다음 계산 때 반영된다.
 */
class AmountMedians {

    static final long TTL_NANOS = 3_600_000_000_000L;     // 1시간
    static final int MAX_ENTRIES = 50_000;                // 넘으면 비운다 (사용자 × 업종이 끝없이 쌓이지 않게)
    private static final int DEFAULT_AMOUNT = 10_000;
    private static final String EVERYONE = "*";

    /** 계산한 값(없으면 null)과 계산한 시각. */
    private record Entry(Integer value, long at) {
    }

    private final AiScheduleRepository repo;
    private final LongSupplier nanoClock;
    private final int maxEntries;
    private final Map<String, Entry> cache = new ConcurrentHashMap<>();

    AmountMedians(AiScheduleRepository repo) {
        this(repo, System::nanoTime, MAX_ENTRIES);
    }

    AmountMedians(AiScheduleRepository repo, LongSupplier nanoClock, int maxEntries) {
        this.repo = repo;
        this.nanoClock = nanoClock;
        this.maxEntries = maxEntries;
    }

    int amountOf(Long userId, String category) {
        Integer mine = remembered(userId + "|" + category, () -> repo.medianAmountOfUser(userId, category));
        if (mine != null && mine > 0) {
            return mine;
        }
        Integer everyone = remembered(EVERYONE + "|" + category, () -> repo.medianAmount(category));
        return everyone != null && everyone > 0 ? everyone : DEFAULT_AMOUNT;
    }

    private Integer remembered(String key, Supplier<Integer> compute) {
        long now = nanoClock.getAsLong();
        Entry known = cache.get(key);
        if (known != null && now - known.at() < TTL_NANOS) {
            return known.value();
        }
        Integer value = compute.get();
        if (known == null && cache.size() >= maxEntries) {
            cache.clear();
        }
        cache.put(key, new Entry(value, now));
        return value;
    }
}
