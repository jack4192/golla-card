package com.paymate.backend.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import org.junit.jupiter.api.Test;

/** 구독 저장 규칙 (시험용 가짜 저장소가 실제 SQL 과 같은 규칙을 따른다). */
class PushSubscriptionStoreRulesTest {

    @Test
    void sameDeviceMovesToNewUser() {
        InMemoryPushSubscriptionStore store = new InMemoryPushSubscriptionStore(Set.of(1L, 2L));
        store.upsert(1L, "https://push.example/a", "p1", "a1");

        store.upsert(2L, "https://push.example/a", "p2", "a2");   // 같은 아이폰에서 다른 계정으로 켬

        assertThat(store.forUser(1L)).isEmpty();
        assertThat(store.forUser(2L)).singleElement().satisfies(s -> {
            assertThat(s.endpoint()).isEqualTo("https://push.example/a");
            assertThat(s.p256dh()).isEqualTo("p2");
        });
    }

    @Test
    void morningOnlyAgreedUsers() {
        InMemoryPushSubscriptionStore store = new InMemoryPushSubscriptionStore(Set.of(1L));   // 1번만 동의
        store.upsert(1L, "https://push.example/a", "p", "a");
        store.upsert(2L, "https://push.example/b", "p", "a");

        assertThat(store.forMorning()).extracting(PushSubscription::userId).containsExactly(1L);
    }

    @Test
    void deleteOnlyOwnDevice() {
        InMemoryPushSubscriptionStore store = new InMemoryPushSubscriptionStore(Set.of(1L, 2L));
        store.upsert(1L, "https://push.example/a", "p", "a");

        assertThat(store.delete(2L, "https://push.example/a")).isZero();
        assertThat(store.delete(1L, "https://push.example/a")).isEqualTo(1);
        assertThat(store.forUser(1L)).isEmpty();
    }
}
