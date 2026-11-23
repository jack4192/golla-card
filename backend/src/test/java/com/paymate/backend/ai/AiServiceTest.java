package com.paymate.backend.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.paymate.backend.card.repository.UserCardRepository;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AiServiceTest {

    private StubAi ai;
    private UserCardRepository userCards;
    private AiService service;

    @BeforeEach
    void setUp() throws Exception {
        ai = new StubAi();
        userCards = mock(UserCardRepository.class);
        service = service("");
    }

    @AfterEach
    void tearDown() {
        ai.close();
    }

    private AiService service(String fixedAt) {
        return new AiService(new AiClient(ai.url(), "", 300, 2000), userCards, fixedAt);
    }

    // ---------- 카드 배치 ----------

    @Test
    @DisplayName("카드 배치: 로그인한 사용자 번호를 넣어 부르고 AI 답을 그대로 돌려준다")
    void rank() {
        ai.reply("/internal/rank", 200, "{\"cards\":[{\"user_card_id\":3,\"rank\":1}],\"reason_code\":\"HABIT\"}");

        Object result = service.rank(7L, false);

        assertThat(result).isEqualTo("{\"cards\":[{\"user_card_id\":3,\"rank\":1}],\"reason_code\":\"HABIT\"}");
        assertThat(ai.last().path()).isEqualTo("/internal/rank");
        assertThat(ai.last().body()).contains("\"user_id\":7").contains("\"explain\":false").doesNotContain("\"at\"");
    }

    @Test
    @DisplayName("카드 배치: AI 가 답하지 못하면 내 카드 순서대로 기본 순서를 돌려준다")
    @SuppressWarnings("unchecked")
    void rankFallback() {
        ai.reply("/internal/rank", 500, "boom");
        when(userCards.findOrderedIds(7L)).thenReturn(List.of(12L, 11L));

        Map<String, Object> result = (Map<String, Object>) service.rank(7L, false);

        assertThat(result.get("reason_code")).isEqualTo("FALLBACK");
        assertThat(result.get("scenario_mode")).isEqualTo("fallback");
        assertThat(result.get("recommendation_id")).isNull();
        assertThat(result.get("display_count")).isEqualTo(1);
        List<Map<String, Object>> cards = (List<Map<String, Object>>) result.get("cards");
        assertThat(cards).extracting(c -> c.get("user_card_id")).containsExactly(12L, 11L);
        assertThat(cards).extracting(c -> c.get("rank")).containsExactly(1, 2);
        assertThat(cards.get(0).get("message")).isEqualTo("AI 응답이 없어 기본 순서로 보여 드려요");
        assertThat(cards.get(1).get("message")).isEqualTo("");
    }

    @Test
    @DisplayName("카드 배치: 제한 시간을 넘겨도 기본 순서. 카드가 없으면 빈 목록")
    @SuppressWarnings("unchecked")
    void rankFallbackOnTimeoutWithoutCards() {
        ai.slow("/internal/rank", 1500);
        when(userCards.findOrderedIds(7L)).thenReturn(List.of());

        Map<String, Object> result = (Map<String, Object>) service.rank(7L, false);

        assertThat((List<Object>) result.get("cards")).isEmpty();
        assertThat(result.get("display_count")).isEqualTo(0);
        assertThat(result.get("reason_code")).isEqualTo("FALLBACK");
    }

    // ---------- 기준 시각 ----------

    @Test
    @DisplayName("기준 시각을 설정하면 본문과 쿼리에 at 으로 넣는다")
    void fixedAt() {
        service = service("2026-11-05T09:30:00");

        service.rank(7L, true);
        assertThat(ai.last().body()).contains("\"at\":\"2026-11-05T09:30:00\"").contains("\"explain\":true");

        service.monthlyReport(7L);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/monthly-report");
        assertThat(ai.last().query()).isEqualTo("at=2026-11-05T09:30:00");

        service.recommendationPage(7L);
        assertThat(ai.last().method()).isEqualTo("POST");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/recommendation-page");
        assertThat(ai.last().body()).contains("\"at\":\"2026-11-05T09:30:00\"");

        assertThat(service.today()).isEqualTo(LocalDate.of(2026, 11, 5));
    }

    @Test
    @DisplayName("기준 시각이 없으면 at 을 보내지 않고 오늘은 실제 날짜")
    void noFixedAt() {
        service.monthlyReport(7L);
        assertThat(ai.last().query()).isNull();

        service.schedulePopup(7L);
        assertThat(ai.last().body()).isEqualTo("{}");

        assertThat(service.today()).isEqualTo(LocalDate.now(java.time.ZoneId.of("Asia/Seoul")));
    }

    @Test
    @DisplayName("기준 시각 형식이 틀리면 서버가 뜰 때 알린다")
    void badFixedAt() {
        assertThatThrownBy(() -> service("11월 5일")).isInstanceOf(IllegalArgumentException.class);
    }

    // ---------- 챗봇·규칙 ----------

    @Test
    @DisplayName("챗봇: 앱이 보낸 user_id 와 at 은 버리고 로그인 사용자와 서버 기준 시각을 쓴다")
    void chat() {
        service = service("2026-11-05T09:30:00");
        Map<String, Object> request = new HashMap<>();
        request.put("message", "이번 달 실적 알려줘");
        request.put("user_id", 999);
        request.put("at", "2030-01-01T00:00:00");
        request.put("history", List.of(Map.of("role", "user", "text", "안녕")));
        request.put("screen", Map.of("name", "payment", "recommendation_id", 5));
        request.put("session_id", "abc");
        request.put("admin", true);

        service.chat(7L, request);

        String body = ai.last().body();
        assertThat(ai.last().path()).isEqualTo("/internal/chat");
        assertThat(body).contains("\"user_id\":7").doesNotContain("999");
        assertThat(body).contains("\"at\":\"2026-11-05T09:30:00\"").doesNotContain("2030");
        assertThat(body).contains("이번 달 실적 알려줘").contains("\"history\"").contains("\"screen\"").contains("\"session_id\":\"abc\"");
        assertThat(body).doesNotContain("admin");
    }

    @Test
    @DisplayName("규칙: 조회·저장·검사·초안 확정·취소")
    void rules() {
        service.rules(7L);
        assertThat(ai.last().method()).isEqualTo("GET");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/rules");

        service.saveRules(7L, List.of(Map.of("type", "pin", "user_card_id", 3)));
        assertThat(ai.last().method()).isEqualTo("PUT");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/rules");
        assertThat(ai.last().body()).startsWith("[").contains("\"type\":\"pin\"");

        service.validateRule(7L, Map.of("type", "pin"));
        assertThat(ai.last().path()).isEqualTo("/internal/rules/validate");
        assertThat(ai.last().body()).contains("\"user_id\":7").contains("\"rule\":{\"type\":\"pin\"}");

        service.confirmDraft(7L, 42);
        assertThat(ai.last().path()).isEqualTo("/internal/rules/drafts/42/confirm");
        assertThat(ai.last().body()).isEqualTo("{\"user_id\":7}");

        service.cancelDraft(7L, 42);
        assertThat(ai.last().path()).isEqualTo("/internal/rules/drafts/42/cancel");
        assertThat(ai.last().body()).isEqualTo("{\"user_id\":7}");
    }

    // ---------- 그 밖 ----------

    @Test
    @DisplayName("조회 API 들은 사용자 번호를 경로에 넣어 부른다")
    void reads() {
        service.me(7L);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7");

        service.cardStatus(7L);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/cards");

        service.strategy(7L);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/strategy");

        service.initializeStrategy(7L);
        assertThat(ai.last().method()).isEqualTo("POST");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/strategy/initialize");

        service.cardRecommendation(7L);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/card-recommendation");

        service.missedBenefit(7L, 180);
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/missed-benefit");
        assertThat(ai.last().query()).isEqualTo("days=180");

        service.merchants("강남");
        assertThat(ai.last().path()).isEqualTo("/internal/merchants");
        assertThat(ai.last().query()).isEqualTo("zone=강남");

        service.health();
        assertThat(ai.last().path()).isEqualTo("/health");
    }

    @Test
    @DisplayName("가정 계산: 허용한 값만 넘기고 사용자 번호는 로그인 사용자")
    void evaluate() {
        Map<String, Object> request = new HashMap<>();
        request.put("category_code", "CAFE");
        request.put("amount", 6000);
        request.put("user_id", 999);
        request.put("user_card_id", 3);

        service.evaluate(7L, request);

        assertThat(ai.last().path()).isEqualTo("/internal/payments/evaluate");
        assertThat(ai.last().body()).contains("\"user_id\":7").contains("\"category_code\":\"CAFE\"")
                .contains("\"amount\":6000").contains("\"user_card_id\":3").doesNotContain("999");
    }

    @Test
    @DisplayName("일정: 하루 일정을 통째로 넘기고 다시 읽는다")
    void schedules() {
        service = service("2026-11-05T09:30:00");
        LocalDate day = LocalDate.of(2026, 11, 6);

        service.putSchedule(7L, day, List.of(Map.of("start", "12:00", "end", "13:00", "category", "CAFE", "amount", 6000)));
        assertThat(ai.last().method()).isEqualTo("PUT");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/schedules/2026-11-06");
        assertThat(ai.last().query()).isEqualTo("at=2026-11-05T09:30:00");
        assertThat(ai.last().body()).startsWith("{\"items\":[").contains("\"category\":\"CAFE\"");

        service.schedule(7L, day);
        assertThat(ai.last().method()).isEqualTo("GET");
        assertThat(ai.last().path()).isEqualTo("/internal/users/7/schedules/2026-11-06");
    }

    @Test
    @DisplayName("카드 배치가 아닌 호출은 AI 오류를 그대로 알린다")
    void errorsPropagate() {
        ai.reply("/internal/users/7/monthly-report", 404, "{\"detail\":\"없는 사용자입니다\"}");

        assertThatThrownBy(() -> service.monthlyReport(7L))
                .isInstanceOf(AiException.class)
                .hasMessage("없는 사용자입니다");
    }
}
