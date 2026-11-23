package com.paymate.backend.ai;

import java.net.http.HttpClient;
import java.net.http.HttpConnectTimeoutException;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 엔진(solpay-ai, FastAPI)을 HTTP 로 부른다. 답은 JSON 글자 그대로 돌려준다.
 *
 * <p>카드 배치는 결제 화면을 막으면 안 되므로 짧은 제한 시간(기본 0.8초)을 쓰는 {@link #postFast} 로 부르고,
 * 챗봇·리포트처럼 OpenAI 를 거치는 호출은 긴 제한 시간(기본 20초)을 쓴다.
 * 실패는 모두 {@link AiException} 으로 바꾼다.
 */
@Slf4j
@Component
public class AiClient {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String TOKEN_HEADER = "X-Internal-Token";

    private final RestClient fast;
    private final RestClient normal;

    public AiClient(@Value("${ai.base-url}") String baseUrl,
                    @Value("${ai.internal-token:}") String internalToken,
                    @Value("${ai.rank-timeout-ms:800}") long rankTimeoutMs,
                    @Value("${ai.timeout-ms:20000}") long timeoutMs) {
        this.fast = build(baseUrl, internalToken, Math.min(rankTimeoutMs, 500), rankTimeoutMs);
        this.normal = build(baseUrl, internalToken, 2000, timeoutMs);
    }

    private static RestClient build(String baseUrl, String token, long connectMs, long readMs) {
        HttpClient http = HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofMillis(connectMs))
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofMillis(readMs));
        RestClient.Builder builder = RestClient.builder().baseUrl(baseUrl).requestFactory(factory);
        if (token != null && !token.isBlank()) {
            builder.defaultHeader(TOKEN_HEADER, token.trim());
        }
        return builder.build();
    }

    public String get(String path, Map<String, Object> query) {
        return call(normal, HttpMethod.GET, path, query, null);
    }

    public String post(String path, Map<String, Object> query, Object body) {
        return call(normal, HttpMethod.POST, path, query, body);
    }

    public String put(String path, Map<String, Object> query, Object body) {
        return call(normal, HttpMethod.PUT, path, query, body);
    }

    /** 짧은 제한 시간으로 부른다 (카드 배치). */
    public String postFast(String path, Object body) {
        return call(fast, HttpMethod.POST, path, null, body);
    }

    private String call(RestClient client, HttpMethod method, String path, Map<String, Object> query, Object body) {
        try {
            RestClient.RequestBodySpec spec = client.method(method).uri(builder -> {
                builder.path(path);
                if (query != null) {
                    query.forEach((name, value) -> {
                        if (value != null) {
                            builder.queryParam(name, value);
                        }
                    });
                }
                return builder.build();
            });
            if (body != null) {
                spec.contentType(MediaType.APPLICATION_JSON).body(body);
            }
            byte[] bytes = spec.retrieve()
                    .onStatus(HttpStatusCode::isError, (request, response) -> {
                        throw rejected(method, path, response.getStatusCode().value(), response.getBody().readAllBytes());
                    })
                    .body(byte[].class);
            // FastAPI 는 charset 없이 application/json 을 주므로 UTF-8 로 직접 읽는다
            return bytes == null ? "" : new String(bytes, StandardCharsets.UTF_8);
        } catch (AiException e) {
            throw e;
        } catch (ResourceAccessException e) {
            if (isReadTimeout(e)) {
                log.warn("AI 응답 시간 초과: {} {}", method, path);
                throw new AiException(HttpStatus.GATEWAY_TIMEOUT, "AI_TIMEOUT", "AI 서버 응답이 늦어지고 있습니다.", e);
            }
            log.warn("AI 서버 연결 실패: {} {} ({})", method, path, e.getMessage());
            throw new AiException(HttpStatus.SERVICE_UNAVAILABLE, "AI_UNAVAILABLE", "AI 서버에 연결할 수 없습니다.", e);
        } catch (RestClientException e) {
            log.warn("AI 호출 오류: {} {} ({})", method, path, e.getMessage());
            throw new AiException(HttpStatus.BAD_GATEWAY, "AI_ERROR", "AI 서버에서 오류가 발생했습니다.", e);
        }
    }

    /** AI 가 오류 상태로 답했을 때. 앱이 고칠 수 있는 것(404·409·400·422)만 설명과 함께 전하고 나머지는 502 로 묶는다. */
    private static AiException rejected(HttpMethod method, String path, int status, byte[] body) {
        String detail = detailOf(body);
        log.warn("AI 가 {} 로 답함: {} {} ({})", status, method, path, detail);
        return switch (status) {
            case 404 -> new AiException(HttpStatus.NOT_FOUND, "AI_NOT_FOUND",
                    detail != null ? detail : "AI 서버에서 대상을 찾지 못했습니다.");
            case 409 -> new AiException(HttpStatus.CONFLICT, "AI_CONFLICT",
                    detail != null ? detail : "AI 서버가 요청을 받아들이지 않았습니다.");
            case 400, 422 -> new AiException(HttpStatus.BAD_REQUEST, "AI_INVALID_REQUEST",
                    detail != null ? detail : "AI 서버가 요청을 받아들이지 않았습니다.");
            // 401(내부 토큰 불일치)을 그대로 주면 앱이 로그인 만료로 오해한다. 서버 쪽 문제는 모두 502.
            default -> new AiException(HttpStatus.BAD_GATEWAY, "AI_ERROR", "AI 서버에서 오류가 발생했습니다.");
        };
    }

    /** FastAPI 오류 본문 {"detail": "..."} 의 설명. 글자가 아니거나(입력 검사 목록) JSON 이 아니면 null. */
    private static String detailOf(byte[] body) {
        try {
            JsonNode detail = JSON.readTree(body).path("detail");
            return detail.isString() ? detail.asString() : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static boolean isReadTimeout(Throwable e) {
        for (Throwable cause = e; cause != null; cause = cause.getCause()) {
            if (cause instanceof HttpConnectTimeoutException) {
                return false;                       // 연결조차 못 한 것은 '꺼져 있음'으로 본다
            }
            if (cause instanceof HttpTimeoutException || cause instanceof java.net.SocketTimeoutException) {
                return true;
            }
        }
        return false;
    }
}
