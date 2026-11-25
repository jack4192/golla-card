package com.paymate.backend.payment;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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

/** 만능 키가 없는 서버: 시연 API 3개는 로그인 없이 불러도 404 POS_DEMO_DISABLED (로컬 DB 필요). */
@SpringBootTest(properties = "app.pos.demo-terminal-key=")
@AutoConfigureMockMvc
class PosDemoOffApiTest {

    @Autowired
    private MockMvc mvc;

    @Test
    @DisplayName("키가 없으면 가맹점·거래·결제 모두 404 POS_DEMO_DISABLED")
    void disabled() throws Exception {
        mvc.perform(get("/api/v1/pos/demo/merchants"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POS_DEMO_DISABLED"));
        mvc.perform(get("/api/v1/pos/demo/transactions"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POS_DEMO_DISABLED"));
        mvc.perform(post("/api/v1/pos/demo/payments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"123456789012345678\",\"amount\":5000,\"merchantId\":1}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POS_DEMO_DISABLED"));
    }
}
