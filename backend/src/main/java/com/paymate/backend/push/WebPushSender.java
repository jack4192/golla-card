package com.paymate.backend.push;

import io.jsonwebtoken.Jwts;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.interfaces.ECPrivateKey;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;

/**
 * 웹 푸시 보내기 (RFC 8030 + VAPID RFC 8292). 내용은 {@link WebPushCrypto} 로 잠그고, VAPID 서명은 기존 jjwt(ES256)로 한다.
 * 키(VAPID_PUBLIC_KEY·VAPID_PRIVATE_KEY)가 없으면 꺼진다 — 팀원 로컬 백엔드는 키가 없어 알림을 보내지 않는다 (2026-11-25).
 */
@Slf4j
public class WebPushSender implements PushSender {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final String TTL_SECONDS = "86400";

    private final String publicKey;      // base64url 65바이트
    private final ECPrivateKey privateKey;
    private final String subject;
    private final HttpClient http;

    public WebPushSender(String publicKeyB64, String privateKeyB64, String subject, HttpClient http) {
        String pub = publicKeyB64 == null ? "" : publicKeyB64.trim();
        String priv = privateKeyB64 == null ? "" : privateKeyB64.trim();
        ECPrivateKey key = null;
        if (!pub.isEmpty() && !priv.isEmpty()) {
            try {
                WebPushCrypto.publicKey(WebPushCrypto.b64(pub));
                key = WebPushCrypto.privateKey(WebPushCrypto.b64(priv));
            } catch (RuntimeException e) {
                log.warn("VAPID 키를 읽지 못해 웹 푸시를 끕니다: {}", e.getMessage());
            }
        }
        this.privateKey = key;
        this.publicKey = key == null ? null : pub;
        this.subject = subject == null || subject.isBlank() ? "https://paymate.duckdns.org" : subject.trim();
        this.http = http;
    }

    @Override
    public boolean enabled() {
        return privateKey != null;
    }

    @Override
    public String publicKey() {
        return publicKey;
    }

    @Override
    public PushResult send(PushSubscription subscription, String payloadJson) {
        if (!enabled()) {
            return PushResult.FAILED;
        }
        try {
            byte[] body = WebPushCrypto.encrypt(payloadJson.getBytes(StandardCharsets.UTF_8),
                    WebPushCrypto.b64(subscription.p256dh()), WebPushCrypto.b64(subscription.auth()));
            HttpRequest request = HttpRequest.newBuilder(URI.create(subscription.endpoint()))
                    .timeout(TIMEOUT)
                    .header("TTL", TTL_SECONDS)
                    .header("Urgency", "high")
                    .header("Content-Encoding", "aes128gcm")
                    .header("Content-Type", "application/octet-stream")
                    .header("Authorization", authorization(subscription.endpoint(), Instant.now()))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            int status = response.statusCode();
            if (status == 404 || status == 410) {
                return PushResult.GONE;
            }
            if (status >= 200 && status < 300) {
                return PushResult.SENT;
            }
            // 푸시 서비스가 알려 주는 이유(예: 애플 {"reason":"BadJwtToken"})를 같이 남긴다
            String reason = response.body() == null ? "" : response.body().substring(0, Math.min(200, response.body().length()));
            log.warn("웹 푸시 응답 {} (구독 {}) {}", status, subscription.id(), reason);
            return PushResult.FAILED;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return PushResult.FAILED;
        } catch (Exception e) {
            log.warn("웹 푸시를 보내지 못했습니다 (구독 {}): {}", subscription.id(), e.getMessage());
            return PushResult.FAILED;
        }
    }

    /** VAPID Authorization 헤더: aud = 푸시 서비스 출처, exp = 12시간 뒤 (24시간 안), sub = 웹앱 주소. */
    public String authorization(String endpoint, Instant now) {
        URI uri = URI.create(endpoint);
        String audience = uri.getScheme() + "://" + uri.getHost() + (uri.getPort() == -1 ? "" : ":" + uri.getPort());
        String jwt = Jwts.builder()
                .header().add("typ", "JWT").and()
                // 글자 하나로 (목록 ["..."] 이면 애플이 403 BadJwtToken, 2026-11-25 실기기에서 확인)
                .audience().single(audience)
                .subject(subject)
                .expiration(Date.from(now.plus(Duration.ofHours(12))))
                .signWith(privateKey, Jwts.SIG.ES256)
                .compact();
        return "vapid t=" + jwt + ", k=" + publicKey;
    }
}
