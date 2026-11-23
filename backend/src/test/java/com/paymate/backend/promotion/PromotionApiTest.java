package com.paymate.backend.promotion;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.hasItem;
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

/** 행사 목록 API·로고 (로컬 DB 필요: 기동 테스트처럼 backend/.env, 마이그레이션 SQL 을 실행한 DB). */
@SpringBootTest
@AutoConfigureMockMvc
class PromotionApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JWTUtil jwt;

    @Test
    @DisplayName("로고는 로그인 없이 받는다 (앱의 <Image> 는 토큰을 보낼 수 없다)")
    void logoWithoutLogin() throws Exception {
        mvc.perform(get("/brand-logos/mega.png")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("행사 목록은 로그인이 필요하다")
    void listNeedsLogin() throws Exception {
        mvc.perform(get("/api/promotions")).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("행사 목록: 29건, 이벤트 먼저, 화면 이름·실제 기간·로고, 식별불가 2건 없음")
    void list() throws Exception {
        String token = jwt.createAccessToken(1L, "test1@example.com", "USER");
        mvc.perform(get("/api/promotions").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(29)))
                .andExpect(jsonPath("$[0].promotionId").value(1))
                .andExpect(jsonPath("$[0].logoUrl").value("/brand-logos/mega.png"))
                .andExpect(jsonPath("$[2].promotionId").value(3))
                .andExpect(jsonPath("$[2].name").value("온라인 다이소몰"))
                .andExpect(jsonPath("$[2].start").value("2026-11-16"))
                .andExpect(jsonPath("$[*].promotionId", not(hasItem(30))))
                .andExpect(jsonPath("$[*].promotionId", not(hasItem(31))));
    }
}
