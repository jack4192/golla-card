package com.paymate.backend.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.paymate.backend.common.exception.BusinessException;
import java.security.interfaces.ECPublicKey;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ConcurrentTaskScheduler;

class PushServiceTest {

    private static final String UA_KEY = WebPushCrypto.b64(WebPushCrypto.uncompressed((ECPublicKey) WebPushCrypto.newKeyPair().getPublic()));
    private static final String AUTH = "BTBZMqHH6r4Tts7J_aSIgg";

    /** 보낸 것을 기록하고, endpoint 별로 정한 결과를 돌려준다. */
    static class RecordingSender implements PushSender {
        boolean enabled = true;
        final List<PushSubscription> sent = new ArrayList<>();
        final List<String> payloads = new ArrayList<>();
        final Map<String, PushResult> results = new HashMap<>();

        public boolean enabled() { return enabled; }
        public String publicKey() { return enabled ? "PUBLIC" : null; }
        public PushResult send(PushSubscription s, String payload) {
            sent.add(s);
            payloads.add(payload);
            return results.getOrDefault(s.endpoint(), PushResult.SENT);
        }
    }

    /** 예약한 일과 시각을 기록만 하고 바로 실행하지 않는다. */
    static class RecordingScheduler extends ConcurrentTaskScheduler {
        Runnable task;
        Instant at;

        @Override
        public ScheduledFuture<?> schedule(Runnable task, Instant startTime) {
            this.task = task;
            this.at = startTime;
            return null;
        }
    }

    private final InMemoryPushSubscriptionStore store = new InMemoryPushSubscriptionStore(Set.of(1L));   // 1번만 알림 동의
    private final RecordingSender sender = new RecordingSender();
    private final RecordingScheduler scheduler = new RecordingScheduler();

    private PushService service(String morning) {
        return new PushService(sender, store, scheduler, morning);
    }

    private static PushSubscribeRequest request(String endpoint, String p256dh, String auth) {
        return new PushSubscribeRequest(endpoint, new PushSubscribeRequest.Keys(p256dh, auth));
    }

    @Test
    void morningSendsToAgreedOnly() {
        store.upsert(1L, "https://web.push.apple.com/QA1", UA_KEY, AUTH);
        store.upsert(2L, "https://fcm.googleapis.com/fcm/send/QA2", UA_KEY, AUTH);   // 동의 안 함

        service("on").sendMorning();

        assertThat(sender.sent).extracting(PushSubscription::userId).containsExactly(1L);
        assertThat(sender.payloads).containsExactly(PushService.MORNING_PAYLOAD);
        assertThat(PushService.MORNING_PAYLOAD)
                .contains("\"title\":\"오늘 일정 있으세요?\"")
                .contains("\"body\":\"알려 주시면 맞는 카드를 골라 드려요\"")
                .contains("\"url\":\"/?open=schedule\"")
                .contains("\"tag\":\"morning-schedule\"");
        assertThat(store.sent).hasSize(1);
    }

    @Test
    void morningSkippedWhenDisabled() {
        store.upsert(1L, "https://web.push.apple.com/QA1", UA_KEY, AUTH);

        service("off").sendMorning();
        sender.enabled = false;
        service("on").sendMorning();

        assertThat(sender.sent).isEmpty();
    }

    @Test
    void goneSubscriptionIsDeleted() {
        store.upsert(1L, "https://web.push.apple.com/OLD", UA_KEY, AUTH);
        sender.results.put("https://web.push.apple.com/OLD", PushResult.GONE);

        service("on").sendMorning();

        assertThat(store.forUser(1L)).isEmpty();
    }

    @Test
    void testPushScheduledAfterFiveSeconds() {
        store.upsert(1L, "https://web.push.apple.com/QA1", UA_KEY, AUTH);
        store.upsert(2L, "https://fcm.googleapis.com/fcm/send/QA2", UA_KEY, AUTH);
        Instant before = Instant.now();

        int delay = service("off").sendTestSoon(2L);   // 7시 예약이 꺼져 있어도 '지금 받기'는 된다

        assertThat(delay).isEqualTo(5);
        assertThat(sender.sent).isEmpty();
        assertThat(Duration.between(before, scheduler.at).toMillis()).isBetween(4500L, 6500L);
        scheduler.task.run();
        assertThat(sender.sent).extracting(PushSubscription::userId).containsExactly(2L);
        assertThat(sender.payloads).containsExactly(PushService.MORNING_PAYLOAD);
    }

    @Test
    void testPushWithoutDeviceIs409() {
        assertThatThrownBy(() -> service("on").sendTestSoon(1L))
                .isInstanceOf(BusinessException.class)
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(PushErrorCode.NO_SUBSCRIPTION));
    }

    @Test
    void disabledSenderIs503() {
        sender.enabled = false;
        PushService service = service("on");

        assertThat(service.publicKey().enabled()).isFalse();
        assertThat(service.publicKey().publicKey()).isNull();
        assertThatThrownBy(() -> service.subscribe(1L, request("https://web.push.apple.com/QA1", UA_KEY, AUTH)))
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(PushErrorCode.PUSH_DISABLED));
        assertThatThrownBy(() -> service.sendTestSoon(1L))
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(PushErrorCode.PUSH_DISABLED));
    }

    @Test
    void invalidSubscriptionIs400() {
        PushService service = service("on");
        for (PushSubscribeRequest bad : List.of(
                request("http://push.example/1", UA_KEY, AUTH),      // https 아님
                request("https://web.push.apple.com/QA1", "", AUTH),         // 키 없음
                request("https://web.push.apple.com/QA1", "AQID", AUTH),     // 65바이트 공개 키 아님
                request("https://web.push.apple.com/QA1", UA_KEY, "AQID"),   // 16바이트 auth 아님
                request(" ", UA_KEY, AUTH),
                request("https://evil.example/collect", UA_KEY, AUTH),          // 푸시 서비스가 아닌 주소 (서버가 엉뚱한 곳에 요청하지 않게)
                request("https://web.push.apple.com.evil.example/x", UA_KEY, AUTH),
                request("https://localhost:8080/api", UA_KEY, AUTH))) {
            assertThatThrownBy(() -> service.subscribe(1L, bad)).as(bad.toString())
                    .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(PushErrorCode.INVALID_SUBSCRIPTION));
        }
        assertThatThrownBy(() -> service.subscribe(1L, new PushSubscribeRequest("https://web.push.apple.com/QA1", null)))
                .satisfies(e -> assertThat(((BusinessException) e).getErrorCode()).isEqualTo(PushErrorCode.INVALID_SUBSCRIPTION));
        assertThat(store.forUser(1L)).isEmpty();
    }

    @Test
    void knownPushServicesAccepted() {
        PushService service = service("on");
        for (String endpoint : List.of("https://web.push.apple.com/QAbc", "https://fcm.googleapis.com/fcm/send/abc",
                "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc")) {
            service.subscribe(1L, request(endpoint, UA_KEY, AUTH));
        }
        assertThat(store.forUser(1L)).hasSize(4);
    }

    @Test
    void subscribeThenUnsubscribeRemovesDevice() {
        PushService service = service("on");
        service.subscribe(1L, request("https://web.push.apple.com/QA1", UA_KEY, AUTH));
        assertThat(store.forMorning()).hasSize(1);

        service.unsubscribe(1L, "https://web.push.apple.com/QA1");

        assertThat(store.forMorning()).isEmpty();
    }
}
