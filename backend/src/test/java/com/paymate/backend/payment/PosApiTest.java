package com.paymate.backend.payment;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/** 결제 API 의 보안 설정 (로컬 DB 필요: backend/.env). DB 에 아무것도 쓰지 않는 요청만 보낸다. */
@SpringBootTest
@AutoConfigureMockMvc
class PosApiTest {

    @Autowired
    private MockMvc mvc;

    @Test
    @DisplayName("가상 POS 결제는 로그인 없이 부를 수 있고, 단말기 키가 틀리면 403 INVALID_TERMINAL")
    void posWithoutLogin() throws Exception {
        mvc.perform(post("/api/v1/pos/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"terminalKey\":\"no-such-terminal\",\"code\":\"123456789012345678\",\"amount\":5000}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("INVALID_TERMINAL"));
    }

    @Test
    @DisplayName("결제 코드 발급·앱 결제·카드 추천은 로그인이 필요하다")
    void appPaymentNeedsLogin() throws Exception {
        mvc.perform(post("/api/v1/payment-tokens").contentType(MediaType.APPLICATION_JSON).content("{\"userCardId\":1}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/payment-tokens/1/pay").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }
}
