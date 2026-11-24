package com.paymate.backend.common;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.paymate.backend.util.JWTUtil;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/** 오류 응답을 앱이 읽는 {code, message} 형식으로 통일 (2026-11-24 점검 문제 5). 로컬 DB 필요(읽기만). */
@SpringBootTest
@AutoConfigureMockMvc
class ErrorFormatApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JWTUtil jwt;

    private String token() {
        return "Bearer " + jwt.createAccessToken(1L, "test1@example.com", "USER");
    }

    @Test
    @DisplayName("날짜 형식이 틀리면 400 INVALID_REQUEST")
    void typeMismatch() throws Exception {
        mvc.perform(get("/api/payments").param("date", "bad").header("Authorization", token()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").isNotEmpty());
    }

    @Test
    @DisplayName("필요한 값이 빠지면 400 INVALID_REQUEST")
    void missingParam() throws Exception {
        mvc.perform(get("/api/payments").header("Authorization", token()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("요청 값 검사(@RequestParam 제약)에 걸리면 400 INVALID_REQUEST")
    void paramConstraint() throws Exception {
        mvc.perform(get("/api/users/email-availability").param("email", "not-an-email"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("없는 주소는 404 NOT_FOUND, 지원하지 않는 방식은 405 METHOD_NOT_ALLOWED")
    void notFoundAndMethod() throws Exception {
        mvc.perform(get("/api/does-not-exist").header("Authorization", token()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(delete("/api/promotions").header("Authorization", token()))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value("METHOD_NOT_ALLOWED"));
    }
}
