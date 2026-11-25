package com.paymate.backend.push;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * push_subscriptions 표 (backend/shared-db/add_push_subscriptions.sql). JPA 엔티티로 만들지 않아,
 * 표가 없는 DB 에서도 백엔드는 켜지고(ddl-auto: validate 영향 없음) 알림 기능만 오류를 낸다 (2026-11-25).
 */
@Repository
public class JdbcPushSubscriptionStore implements PushSubscriptionStore {

    private static final String COLUMNS = "s.push_subscription_id AS id, s.user_id, s.endpoint, s.p256dh, s.auth";

    private final JdbcClient jdbc;

    public JdbcPushSubscriptionStore(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void upsert(long userId, String endpoint, String p256dh, String auth) {
        jdbc.sql("""
                INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
                VALUES (:userId, :endpoint, :p256dh, :auth)
                ON CONFLICT (endpoint) DO UPDATE
                   SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
                """)
                .param("userId", userId).param("endpoint", endpoint).param("p256dh", p256dh).param("auth", auth)
                .update();
    }

    @Override
    public int delete(long userId, String endpoint) {
        return jdbc.sql("DELETE FROM push_subscriptions WHERE user_id = :userId AND endpoint = :endpoint")
                .param("userId", userId).param("endpoint", endpoint).update();
    }

    @Override
    public void deleteEndpoint(String endpoint) {
        jdbc.sql("DELETE FROM push_subscriptions WHERE endpoint = :endpoint").param("endpoint", endpoint).update();
    }

    @Override
    public List<PushSubscription> forUser(long userId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM push_subscriptions s WHERE s.user_id = :userId ORDER BY s.push_subscription_id")
                .param("userId", userId).query(PushSubscription.class).list();
    }

    @Override
    public List<PushSubscription> forMorning() {
        return jdbc.sql("SELECT " + COLUMNS + " FROM push_subscriptions s JOIN users u ON u.user_id = s.user_id"
                        + " WHERE u.notification_agreed = true ORDER BY s.push_subscription_id")
                .query(PushSubscription.class).list();
    }

    @Override
    public void markSent(long id) {
        jdbc.sql("UPDATE push_subscriptions SET last_sent_at = now() WHERE push_subscription_id = :id").param("id", id).update();
    }
}
