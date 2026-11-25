package com.paymate.backend.push;

import com.paymate.backend.common.exception.BusinessException;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * 바탕화면 웹앱 아침 일정 알림 (2026-11-25 사용자 결정: 매일 7시 + '지금 알림 받기', 문구는 짧은 질문형).
 * 아이폰이 웹앱 알림에 'from Pay·Mate' 줄을 자동으로 붙인다(끌 수 없음).
 * 7시 예약은 PUSH_MORNING_ENABLED=on 인 서버(EC2)에서만 보낸다 — 팀원 로컬 백엔드가 같은 RDS 를 봐도 여러 번 가지 않게.
 */
@Slf4j
@Service
public class PushService {

    static final String MORNING_TITLE = "오늘 어디 가세요?";
    static final String MORNING_BODY = "일정을 알려 주면 카드를 골라 드려요";
    public static final String MORNING_PAYLOAD = "{\"title\":\"" + MORNING_TITLE + "\",\"body\":\"" + MORNING_BODY
            + "\",\"url\":\"/?open=schedule\",\"tag\":\"morning-schedule\"}";
    static final Duration TEST_DELAY = Duration.ofSeconds(5);   // 누르고 홈 화면으로 나갈 시간

    private final PushSender sender;
    private final PushSubscriptionStore store;
    private final TaskScheduler scheduler;
    private final boolean morningEnabled;

    public PushService(PushSender sender, PushSubscriptionStore store, TaskScheduler scheduler,
                       @Value("${app.push.morning-enabled:off}") String morningEnabled) {
        this.sender = sender;
        this.store = store;
        this.scheduler = scheduler;
        this.morningEnabled = "on".equalsIgnoreCase(String.valueOf(morningEnabled).trim())
                || "true".equalsIgnoreCase(String.valueOf(morningEnabled).trim());
    }

    public record PublicKeyResponse(boolean enabled, String publicKey) {
    }

    public PublicKeyResponse publicKey() {
        return new PublicKeyResponse(sender.enabled(), sender.publicKey());
    }

    public void subscribe(long userId, PushSubscribeRequest request) {
        validate(request);
        requireEnabled();
        store.upsert(userId, request.endpoint().trim(), request.keys().p256dh().trim(), request.keys().auth().trim());
    }

    public void unsubscribe(long userId, String endpoint) {
        if (endpoint != null && !endpoint.isBlank()) {
            store.delete(userId, endpoint.trim());
        }
    }

    /** '지금 알림 받기': 내 기기들에 5초 뒤 아침 알림. 돌려주는 값은 기다리는 초. */
    public int sendTestSoon(long userId) {
        requireEnabled();
        if (store.forUser(userId).isEmpty()) {
            throw new BusinessException(PushErrorCode.NO_SUBSCRIPTION);
        }
        scheduler.schedule(() -> sendTo(store.forUser(userId)), Instant.now().plus(TEST_DELAY));
        return (int) TEST_DELAY.toSeconds();
    }

    @Scheduled(cron = "0 0 7 * * *", zone = "Asia/Seoul")
    public void sendMorning() {
        if (!morningEnabled || !sender.enabled()) {
            return;
        }
        try {
            int sent = sendTo(store.forMorning());
            log.info("아침 일정 알림 {}건 보냄", sent);
        } catch (RuntimeException e) {
            log.warn("아침 일정 알림을 보내지 못했습니다: {}", e.getMessage());
        }
    }

    int sendTo(List<PushSubscription> subscriptions) {
        int sent = 0;
        for (PushSubscription subscription : subscriptions) {
            PushResult result = sender.send(subscription, MORNING_PAYLOAD);
            if (result == PushResult.SENT) {
                store.markSent(subscription.id());
                sent++;
            } else if (result == PushResult.GONE) {
                store.deleteEndpoint(subscription.endpoint());   // 만료된 기기는 다시 보내지 않는다
            }
        }
        return sent;
    }

    private void requireEnabled() {
        if (!sender.enabled()) {
            throw new BusinessException(PushErrorCode.PUSH_DISABLED);
        }
    }

    private static void validate(PushSubscribeRequest request) {
        if (request == null || request.keys() == null || request.endpoint() == null
                || !request.endpoint().trim().startsWith("https://") || request.endpoint().length() > 2048
                || !keyLength(request.keys().p256dh(), 65) || !keyLength(request.keys().auth(), 16)) {
            throw new BusinessException(PushErrorCode.INVALID_SUBSCRIPTION);
        }
        if (!knownPushService(request.endpoint().trim())) {
            throw new BusinessException(PushErrorCode.INVALID_SUBSCRIPTION);
        }
        try {
            WebPushCrypto.publicKey(WebPushCrypto.b64(request.keys().p256dh()));
        } catch (RuntimeException e) {
            throw new BusinessException(PushErrorCode.INVALID_SUBSCRIPTION);
        }
    }

    /**
     * 브라우저 푸시 서비스 주소만 받는다 — 아무 https 주소나 등록해 서버가 엉뚱한 곳(내부 주소 등)에 요청을 보내지 않게 (2026-11-25 검토).
     * 아이폰·맥 사파리 = web.push.apple.com, 크롬·안드로이드 = fcm.googleapis.com, 파이어폭스 = *.push.services.mozilla.com, 엣지 = *.notify.windows.com
     */
    static boolean knownPushService(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equals(uri.getScheme()) || uri.getPort() != -1 && uri.getPort() != 443) {
                return false;
            }
            return host.equals("web.push.apple.com") || host.endsWith(".push.apple.com")
                    || host.equals("fcm.googleapis.com") || host.equals("android.googleapis.com")
                    || host.equals("push.services.mozilla.com") || host.endsWith(".push.services.mozilla.com")
                    || host.endsWith(".notify.windows.com");
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static boolean keyLength(String base64url, int bytes) {
        if (base64url == null || base64url.isBlank()) {
            return false;
        }
        try {
            return Base64.getUrlDecoder().decode(base64url.trim()).length == bytes;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
