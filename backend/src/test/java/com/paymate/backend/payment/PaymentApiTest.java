package com.paymate.backend.payment;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.in;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import com.paymate.backend.util.JWTUtil;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** 결제 내역 API (로컬 DB 필요: backend/.env 의 DB, 가상 결제가 2026-11-04 에 있는 판). 기준 시각을 11-04 12시로 고정한다. */
@SpringBootTest(properties = "ai.fixed-at=2026-11-04T12:00:00")
@AutoConfigureMockMvc
class PaymentApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JWTUtil jwt;

    private final JsonMapper json = JsonMapper.builder().build();

    private String token(long userId) {
        return "Bearer " + jwt.createAccessToken(userId, "test" + userId + "@example.com", "USER");
    }

    @Test
    @DisplayName("결제 내역은 로그인이 필요하다")
    void needsLogin() throws Exception {
        mvc.perform(get("/api/payments").param("date", "2026-11-04")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("그날 결제: 내 카드만, 기준 시각까지, 시간순")
    void ofDay() throws Exception {
        String body = mvc.perform(get("/api/payments").param("date", "2026-11-04").header("Authorization", token(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()", greaterThan(0)))
                .andExpect(jsonPath("$[*].paidAt", everyItem(startsWith("2026-11-04T"))))
                .andExpect(jsonPath("$[*].paidAt", everyItem(lessThanOrEqualTo("2026-11-04T12:00:00"))))
                .andExpect(jsonPath("$[*].userCardId", everyItem(in(List.of(1, 2, 3, 4)))))
                .andReturn().getResponse().getContentAsString();
        JsonNode rows = json.readTree(body);
        for (int i = 1; i < rows.size(); i++) {
            assert rows.get(i - 1).get("paidAt").asString().compareTo(rows.get(i).get("paidAt").asString()) <= 0;
        }
    }

    @Test
    @DisplayName("최근 결제: 최근순 5건, beforeId 로 다음 쪽")
    void recentPaging() throws Exception {
        String first = mvc.perform(get("/api/payments/recent").param("limit", "5").header("Authorization", token(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(5)))
                .andExpect(jsonPath("$[0].paidAt", lessThanOrEqualTo("2026-11-04T12:00:00")))
                .andReturn().getResponse().getContentAsString();
        JsonNode page = json.readTree(first);
        for (int i = 1; i < page.size(); i++) {
            assert page.get(i - 1).get("paymentId").asLong() > page.get(i).get("paymentId").asLong();
        }
        long last = page.get(4).get("paymentId").asLong();
        String second = mvc.perform(get("/api/payments/recent").param("limit", "5").param("beforeId", String.valueOf(last))
                        .header("Authorization", token(1)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assert json.readTree(second).get(0).get("paymentId").asLong() < last;
    }

    @Test
    @DisplayName("올해 결산은 로그인이 필요하다")
    void yearSummaryNeedsLogin() throws Exception {
        mvc.perform(get("/api/payments/year-summary")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("올해 결산: 1월~기준 시각의 달, 내 카드만, 합계가 월별 합·카드별 합과 같다")
    void yearSummary() throws Exception {
        String body = mvc.perform(get("/api/payments/year-summary").header("Authorization", token(1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.year").value(2026))
                .andExpect(jsonPath("$.from").value("2026-01-01"))
                .andExpect(jsonPath("$.until").value("2026-11-04T12:00:00"))
                .andExpect(jsonPath("$.months", hasSize(11)))
                .andExpect(jsonPath("$.count", greaterThan(0)))
                .andExpect(jsonPath("$.cards[*].userCardId", everyItem(in(List.of(1, 2, 3, 4)))))
                .andReturn().getResponse().getContentAsString();
        JsonNode s = json.readTree(body);
        long total = s.get("total").asLong();
        assert total == s.get("benefit").asLong() + s.get("promotion").asLong();
        long months = 0;
        for (JsonNode m : s.get("months")) {
            months += m.get("total").asLong();
        }
        long cards = 0;
        for (JsonNode c : s.get("cards")) {
            cards += c.get("total").asLong();
        }
        assert months == total && cards == total : "합계가 다르다: " + total + " / " + months + " / " + cards;
    }

    @Test
    @DisplayName("다른 사람의 결제는 보이지 않는다")
    void notOthers() throws Exception {
        mvc.perform(get("/api/payments").param("date", "2026-11-04").header("Authorization", token(2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[*].userCardId", everyItem(in(List.of(5, 6, 7)))));
    }
}
