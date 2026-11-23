package com.paymate.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AiClientTest {

    private StubAi ai;
    private AiClient client;

    @BeforeEach
    void setUp() throws Exception {
        ai = new StubAi();
        client = new AiClient(ai.url(), "secret-token", 300, 2000);
    }

    @AfterEach
    void tearDown() {
        ai.close();
    }

    @Test
    @DisplayName("GET: 내부 토큰 헤더와 쿼리를 보내고 답을 그대로 돌려준다")
    void get() {
        ai.reply("/internal/users/7/cards", 200, "[{\"card\":\"신한 딥드림\"}]");
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("at", "2026-11-05T09:30:00");
        query.put("days", null);                       // null 은 보내지 않는다

        String body = client.get("/internal/users/7/cards", query);

        assertThat(body).isEqualTo("[{\"card\":\"신한 딥드림\"}]");   // 한글이 깨지지 않는다
        assertThat(ai.last().method()).isEqualTo("GET");
        assertThat(ai.last().token()).isEqualTo("secret-token");
        assertThat(ai.last().query()).isEqualTo("at=2026-11-05T09:30:00");
    }

    @Test
    @DisplayName("POST: 본문을 JSON 으로 보낸다")
    void post() {
        client.post("/internal/chat", null, Map.of("user_id", 7, "message", "이 카드 왜 추천했어?"));

        assertThat(ai.last().method()).isEqualTo("POST");
        assertThat(ai.last().body()).contains("\"user_id\":7").contains("이 카드 왜 추천했어?");
    }

    @Test
    @DisplayName("토큰이 비어 있으면 헤더를 보내지 않는다")
    void noToken() {
        client = new AiClient(ai.url(), "", 300, 2000);

        client.get("/health", null);

        assertThat(ai.last().token()).isNull();
    }

    @Test
    @DisplayName("AI 가 404 를 주면 404 와 AI 의 설명을 담은 예외")
    void notFound() {
        ai.reply("/internal/users/9", 404, "{\"detail\":\"없는 사용자입니다\"}");

        AiException e = catchThrowableOfType(AiException.class, () -> client.get("/internal/users/9", null));

        assertThat(e.getStatus().value()).isEqualTo(404);
        assertThat(e.getCode()).isEqualTo("AI_NOT_FOUND");
        assertThat(e.getMessage()).isEqualTo("없는 사용자입니다");
    }

    @Test
    @DisplayName("AI 가 422 를 주면 400. 설명이 글자가 아니면 정해진 문구")
    void invalid() {
        ai.reply("/internal/chat", 422, "{\"detail\":[{\"loc\":[\"body\",\"message\"],\"msg\":\"Field required\"}]}");

        AiException e = catchThrowableOfType(AiException.class,
                () -> client.post("/internal/chat", null, Map.of("user_id", 7)));

        assertThat(e.getStatus().value()).isEqualTo(400);
        assertThat(e.getCode()).isEqualTo("AI_INVALID_REQUEST");
        assertThat(e.getMessage()).isEqualTo("AI 서버가 요청을 받아들이지 않았습니다.");
    }

    @Test
    @DisplayName("AI 가 401(내부 토큰 불일치)·500 을 주면 앱에는 502 로 알린다")
    void serverSideProblems() {
        ai.reply("/internal/a", 401, "{\"detail\":\"내부 호출 토큰이 맞지 않습니다\"}");
        ai.reply("/internal/b", 500, "Internal Server Error");

        AiException unauthorized = catchThrowableOfType(AiException.class, () -> client.get("/internal/a", null));
        AiException broken = catchThrowableOfType(AiException.class, () -> client.get("/internal/b", null));

        assertThat(unauthorized.getStatus().value()).isEqualTo(502);   // 401 을 그대로 주면 앱이 로그아웃으로 오해한다
        assertThat(unauthorized.getCode()).isEqualTo("AI_ERROR");
        assertThat(broken.getStatus().value()).isEqualTo(502);
    }

    @Test
    @DisplayName("AI 서버가 꺼져 있으면 503")
    void down() {
        String url = ai.url();
        ai.close();
        client = new AiClient(url, "", 300, 2000);

        AiException e = catchThrowableOfType(AiException.class, () -> client.get("/health", null));

        assertThat(e.getStatus().value()).isEqualTo(503);
        assertThat(e.getCode()).isEqualTo("AI_UNAVAILABLE");
    }

    @Test
    @DisplayName("빠른 호출(카드 배치)은 짧은 제한 시간을 넘기면 504")
    void fastTimeout() {
        ai.slow("/internal/rank", 1500);

        long start = System.nanoTime();
        AiException e = catchThrowableOfType(AiException.class,
                () -> client.postFast("/internal/rank", Map.of("user_id", 7)));
        long ms = (System.nanoTime() - start) / 1_000_000;

        assertThat(e.getStatus().value()).isEqualTo(504);
        assertThat(e.getCode()).isEqualTo("AI_TIMEOUT");
        assertThat(ms).isLessThan(1200);
    }

    @Test
    @DisplayName("보통 호출은 같은 지연에서도 답을 받는다")
    void normalWaits() {
        ai.slow("/internal/chat", 600);

        String body = client.post("/internal/chat", null, Map.of("user_id", 7, "message", "안녕"));

        assertThat(body).isEqualTo("{}");
    }
}
