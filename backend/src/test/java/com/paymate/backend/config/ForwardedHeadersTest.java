package com.paymate.backend.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 프록시(Caddy) 뒤에서 자기 주소로 보낸 POST 를 CORS 로 막지 않는다 (2026-11-25 배포 /pos 결제 403 'Invalid CORS request').
 * 브라우저는 같은 주소 POST 에도 Origin 을 붙이는데, 백엔드가 http://localhost:8080 으로 받으면 https://paymate.duckdns.org 를
 * 다른 사이트로 본다. 프록시가 알려 주는 원래 주소(X-Forwarded-Proto·Host)를 믿어야 같은 주소로 본다.
 * 실제 서버(Tomcat)로 띄워 보낸다 (로컬 DB 필요, DB 에 쓰지 않는 요청: 없는 가맹점이라 결제 전에 404).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "app.pos.demo-terminal-key=test-demo-key-0123456789")
class ForwardedHeadersTest {

    private static final String BODY = "{\"code\":\"123456789012345678\",\"amount\":13000,\"merchantId\":99999999}";

    @LocalServerPort
    private int port;

    private HttpResponse<String> postFrom(String origin) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/v1/pos/demo/payments"))
                .header("Content-Type", "application/json")
                .header("Origin", origin)
                .header("X-Forwarded-Proto", "https")          // Caddy 가 붙이는 원래 주소
                .header("X-Forwarded-Host", "paymate.duckdns.org")
                .POST(HttpRequest.BodyPublishers.ofString(BODY))
                .build();
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    @DisplayName("프록시 뒤 자기 주소(https://paymate.duckdns.org)에서 보낸 POST 는 CORS 에 막히지 않고 처리된다")
    void sameSiteBehindProxy() throws Exception {
        HttpResponse<String> res = postFrom("https://paymate.duckdns.org");

        assertThat(res.statusCode()).isEqualTo(404);
        assertThat(res.body()).contains("MERCHANT_NOT_FOUND");
    }

    @Test
    @DisplayName("허용하지 않은 다른 사이트에서 보낸 POST 는 그대로 403 으로 막는다")
    void otherSiteStillBlocked() throws Exception {
        HttpResponse<String> res = postFrom("https://evil.example");

        assertThat(res.statusCode()).isEqualTo(403);
    }
}
