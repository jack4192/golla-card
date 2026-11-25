package com.paymate.backend.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.lessThanOrEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.forwardedUrl;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** 백엔드 가상 POS 화면·시연 API, 켜진 서버 (로컬 DB 필요: backend/.env). DB 에 쓰는 요청은 보내지 않는다. */
@SpringBootTest(properties = "app.pos.demo-terminal-key=test-demo-key-0123456789")
@AutoConfigureMockMvc
class PosDemoApiTest {

    @Autowired
    private MockMvc mvc;

    @Test
    @DisplayName("/pos 는 로그인 없이 POS 화면으로 간다")
    void posPage() throws Exception {
        mvc.perform(get("/pos")).andExpect(status().isOk()).andExpect(forwardedUrl("/pos/index.html"));
        String html = mvc.perform(get("/pos/index.html"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);   // 화면은 <meta charset="utf-8">
        assertThat(html).contains("가상 POS").doesNotContain("POS_DEMO_TERMINAL_KEY=");
    }

    @Test
    @DisplayName("가맹점 목록은 로그인 없이, 업종 이름과 함께 온다")
    void merchants() throws Exception {
        mvc.perform(get("/api/v1/pos/demo/merchants"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(greaterThan(0)))
                .andExpect(jsonPath("$[0].merchantId").isNumber())
                .andExpect(jsonPath("$[0].categoryName").isString());
    }

    @Test
    @DisplayName("최근 거래는 로그인 없이, limit 개수 이하로 온다")
    void transactions() throws Exception {
        mvc.perform(get("/api/v1/pos/demo/transactions").param("limit", "3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(lessThanOrEqualTo(3)));
    }

    @Test
    @DisplayName("시연 결제: 금액이 100원 미만이거나 코드·가맹점이 비면 400 (DB 에 쓰지 않음)")
    void paymentValidation() throws Exception {
        mvc.perform(post("/api/v1/pos/demo/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"123456789012345678\",\"amount\":50,\"merchantId\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/pos/demo/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\" \",\"amount\":5000,\"merchantId\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/pos/demo/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"123456789012345678\",\"amount\":10000001,\"merchantId\":1}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/v1/pos/demo/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"123456789012345678\",\"amount\":5000}"))
                .andExpect(status().isBadRequest());
    }
}
