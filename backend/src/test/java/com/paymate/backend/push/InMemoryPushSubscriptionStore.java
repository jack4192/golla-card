package com.paymate.backend.push;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 시험용 가짜 저장소: JdbcPushSubscriptionStore 의 SQL 과 같은 규칙 (endpoint 고유, upsert 시 사용자 바뀜). */
class InMemoryPushSubscriptionStore implements PushSubscriptionStore {

    private final Map<String, PushSubscription> byEndpoint = new LinkedHashMap<>();
    private final Set<Long> agreedUsers;
    final List<Long> sent = new ArrayList<>();
    private long nextId = 1;

    InMemoryPushSubscriptionStore(Set<Long> agreedUsers) {
        this.agreedUsers = agreedUsers;
    }

    @Override
    public void upsert(long userId, String endpoint, String p256dh, String auth) {
        PushSubscription old = byEndpoint.get(endpoint);
        long id = old == null ? nextId++ : old.id();
        byEndpoint.put(endpoint, new PushSubscription(id, userId, endpoint, p256dh, auth));
    }

    @Override
    public int delete(long userId, String endpoint) {
        PushSubscription old = byEndpoint.get(endpoint);
        if (old == null || old.userId() != userId) {
            return 0;
        }
        byEndpoint.remove(endpoint);
        return 1;
    }

    @Override
    public void deleteEndpoint(String endpoint) {
        byEndpoint.remove(endpoint);
    }

    @Override
    public List<PushSubscription> forUser(long userId) {
        return byEndpoint.values().stream().filter(s -> s.userId() == userId).toList();
    }

    @Override
    public List<PushSubscription> forMorning() {
        return byEndpoint.values().stream().filter(s -> agreedUsers.contains(s.userId())).toList();
    }

    @Override
    public void markSent(long id) {
        sent.add(id);
    }
}
