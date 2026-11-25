package com.paymate.backend.push;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import javax.crypto.Cipher;
import javax.crypto.KeyAgreement;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** VAPID 서명과 보내기: 맥 안에 가짜 푸시 서버를 띄워 받은 요청을 풀어 본다. */
class WebPushSenderTest {

    private HttpServer server;
    private final AtomicInteger status = new AtomicInteger(201);
    private final AtomicInteger hits = new AtomicInteger();
    private final AtomicReference<byte[]> body = new AtomicReference<>();
    private final Map<String, String> headers = new ConcurrentHashMap<>();

    private final KeyPair vapid = WebPushCrypto.newKeyPair();
    private final KeyPair ua = WebPushCrypto.newKeyPair();
    private final byte[] auth = WebPushCrypto.b64("BTBZMqHH6r4Tts7J_aSIgg");

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/push/abc", exchange -> {
            hits.incrementAndGet();
            exchange.getRequestHeaders().forEach((name, values) -> headers.put(name.toLowerCase(), String.join(",", values)));
            headers.put(":method", exchange.getRequestMethod());
            body.set(exchange.getRequestBody().readAllBytes());
            exchange.sendResponseHeaders(status.get(), -1);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String endpoint() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/push/abc";
    }

    private WebPushSender sender() {
        byte[] d = ((java.security.interfaces.ECPrivateKey) vapid.getPrivate()).getS().toByteArray();
        byte[] d32 = new byte[32];
        System.arraycopy(d, Math.max(0, d.length - 32), d32, Math.max(0, 32 - d.length), Math.min(32, d.length));
        return new WebPushSender(WebPushCrypto.b64(WebPushCrypto.uncompressed((ECPublicKey) vapid.getPublic())),
                WebPushCrypto.b64(d32), "https://paymate.example", HttpClient.newHttpClient());
    }

    private PushSubscription subscription() {
        return new PushSubscription(1L, 7L, endpoint(),
                WebPushCrypto.b64(WebPushCrypto.uncompressed((ECPublicKey) ua.getPublic())), WebPushCrypto.b64(auth));
    }

    @Test
    void sendsEncryptedPayload() throws Exception {
        String payload = "{\"title\":\"좋은 아침이에요! 오늘은 어디 가세요?\"}";

        PushResult result = sender().send(subscription(), payload);

        assertThat(result).isEqualTo(PushResult.SENT);
        assertThat(headers.get(":method")).isEqualTo("POST");
        assertThat(headers.get("content-encoding")).isEqualTo("aes128gcm");
        assertThat(headers.get("ttl")).isNotBlank();
        String authorization = headers.get("authorization");
        assertThat(authorization).startsWith("vapid t=");
        assertThat(authorization).contains("k=" + WebPushCrypto.b64(WebPushCrypto.uncompressed((ECPublicKey) vapid.getPublic())));
        assertThat(new String(decrypt(body.get()), StandardCharsets.UTF_8)).isEqualTo(payload);
    }

    @Test
    void vapidJwtClaims() {
        Instant now = Instant.now();
        String authorization = sender().authorization(endpoint(), now);
        String jwt = authorization.substring("vapid t=".length(), authorization.indexOf(','));

        Claims claims = Jwts.parser().verifyWith(vapid.getPublic()).build().parseSignedClaims(jwt).getPayload();

        assertThat(claims.getAudience()).containsExactly("http://127.0.0.1:" + server.getAddress().getPort());
        assertThat(claims.getSubject()).isEqualTo("https://paymate.example");
        assertThat(claims.getExpiration().toInstant()).isAfter(now).isBefore(now.plusSeconds(24 * 3600));
    }

    @Test
    void audienceIsPlainStringForApple() {
        // 애플(web.push.apple.com)은 aud 가 목록(["..."])이면 403 BadJwtToken 으로 거절한다 (2026-11-25 실기기에서 확인)
        String authorization = sender().authorization(endpoint(), Instant.now());
        String jwt = authorization.substring("vapid t=".length(), authorization.indexOf(','));
        String payload = new String(java.util.Base64.getUrlDecoder().decode(jwt.split("\\.")[1]), StandardCharsets.UTF_8);

        assertThat(payload).contains("\"aud\":\"http://127.0.0.1:" + server.getAddress().getPort() + "\"");
        assertThat(payload).doesNotContain("\"aud\":[");
    }

    @Test
    void goneOn410And404() {
        for (int code : List.of(410, 404)) {
            status.set(code);
            assertThat(sender().send(subscription(), "{}")).as("status " + code).isEqualTo(PushResult.GONE);
        }
        status.set(500);
        assertThat(sender().send(subscription(), "{}")).isEqualTo(PushResult.FAILED);
    }

    @Test
    void disabledWithoutKeys() {
        WebPushSender empty = new WebPushSender("", "", "https://paymate.example", HttpClient.newHttpClient());

        assertThat(empty.enabled()).isFalse();
        assertThat(empty.publicKey()).isNull();
        assertThat(empty.send(subscription(), "{}")).isEqualTo(PushResult.FAILED);
        assertThat(hits.get()).isZero();
    }

    /** RFC 8291 을 거꾸로: 받는 기기(UA) 개인 키와 auth 로 푼다. */
    private byte[] decrypt(byte[] message) throws Exception {
        byte[] salt = Arrays.copyOfRange(message, 0, 16);
        int idLength = message[20] & 0xff;
        byte[] asPublic = Arrays.copyOfRange(message, 21, 21 + idLength);
        byte[] cipherText = Arrays.copyOfRange(message, 21 + idLength, message.length);
        assertThat(ByteBuffer.wrap(message, 16, 4).getInt()).isEqualTo(4096);

        KeyAgreement agreement = KeyAgreement.getInstance("ECDH");
        agreement.init(ua.getPrivate());
        agreement.doPhase(WebPushCrypto.publicKey(asPublic), true);
        byte[] ecdh = agreement.generateSecret();
        byte[] uaPublic = WebPushCrypto.uncompressed((ECPublicKey) ua.getPublic());
        byte[] keyInfo = join("WebPush: info\0".getBytes(StandardCharsets.US_ASCII), uaPublic, asPublic, new byte[] {1});
        byte[] ikm = Arrays.copyOf(hmac(hmac(auth, ecdh), keyInfo), 32);
        byte[] prk = hmac(salt, ikm);
        byte[] cek = Arrays.copyOf(hmac(prk, join("Content-Encoding: aes128gcm\0".getBytes(StandardCharsets.US_ASCII), new byte[] {1})), 16);
        byte[] nonce = Arrays.copyOf(hmac(prk, join("Content-Encoding: nonce\0".getBytes(StandardCharsets.US_ASCII), new byte[] {1})), 12);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(cek, "AES"), new GCMParameterSpec(128, nonce));
        byte[] padded = cipher.doFinal(cipherText);
        int end = padded.length - 1;
        while (end >= 0 && padded[end] == 0) {
            end--;
        }
        assertThat(padded[end]).isEqualTo((byte) 2);
        return Arrays.copyOf(padded, end);
    }

    private static byte[] hmac(byte[] key, byte[] data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static byte[] join(byte[]... parts) {
        int length = 0;
        for (byte[] part : parts) {
            length += part.length;
        }
        ByteBuffer out = ByteBuffer.allocate(length);
        for (byte[] part : parts) {
            out.put(part);
        }
        return out.array();
    }
}
