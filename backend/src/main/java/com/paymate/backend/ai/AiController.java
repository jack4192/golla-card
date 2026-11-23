package com.paymate.backend.ai;

import com.paymate.backend.common.security.AuthUser;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱이 부르는 AI 기능. 모두 로그인(토큰)이 필요하고, 사용자 번호는 토큰에서 꺼낸다.
 *
 * <p>응답은 AI 엔진의 JSON 을 바꾸지 않고 그대로 돌려준다 (필드 이름이 user_card_id 처럼 밑줄 형식).
 * 필드 설명은 solpay-ai/openapi.json 의 같은 이름 API 를 본다.
 */
@RestController
@RequestMapping("/api/ai")
@RequiredArgsConstructor
public class AiController {

    private static final MediaType JSON_UTF8 = new MediaType("application", "json", StandardCharsets.UTF_8);

    private final AiService ai;
    private final ScheduleAiSync scheduleSync;

    /** AI 엔진이 켜져 있는지. */
    @GetMapping("/health")
    public ResponseEntity<String> health() {
        return json(ai.health());
    }

    // ---------- 결제 화면 ----------

    /**
     * 결제 화면 카드 순서와 안내 문구. AI 가 0.8초 안에 답하지 못하면 기본 순서(reason_code=FALLBACK).
     * 홈 일정 카드 미리보기는 record=false (같은 계산, 추천 기록 없음).
     */
    @PostMapping("/rank")
    public ResponseEntity<?> rank(@AuthenticationPrincipal AuthUser authUser,
                                  @RequestParam(value = "explain", defaultValue = "false") boolean explain,
                                  @RequestParam(value = "record", defaultValue = "true") boolean record) {
        Object result = ai.rank(authUser.getId(), explain, record);
        return result instanceof String text ? json(text) : ResponseEntity.ok(result);
    }

    /** 가정 계산: 이 업종에서 이 금액을 내면 카드별로 얼마를 받는지. 본문: category_code, amount, (user_card_id, merchant_id) */
    @PostMapping("/payments/evaluate")
    public ResponseEntity<String> evaluate(@AuthenticationPrincipal AuthUser authUser,
                                           @RequestBody Map<String, Object> body) {
        return json(ai.evaluate(authUser.getId(), body));
    }

    // ---------- 내 정보·카드 ----------

    @GetMapping("/me")
    public ResponseEntity<String> me(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.me(authUser.getId()));
    }

    /** 카드별 실적 현황. */
    @GetMapping("/cards")
    public ResponseEntity<String> cards(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.cardStatus(authUser.getId()));
    }

    @GetMapping("/merchants")
    public ResponseEntity<String> merchants(@RequestParam(value = "zone", required = false) String zone) {
        return json(ai.merchants(zone));
    }

    // ---------- 일정 ----------

    /** AI 엔진이 갖고 있는 그날 일정 (일정 등록·수정·삭제 때 자동으로 넘어간다). */
    @GetMapping("/schedules/{day}")
    public ResponseEntity<String> schedule(@AuthenticationPrincipal AuthUser authUser,
                                           @PathVariable("day") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate day) {
        return json(ai.schedule(authUser.getId(), day));
    }

    /** 그날 일정을 AI 엔진에 다시 넘긴다 (AI 서버가 꺼져 있던 동안 바꾼 일정을 맞출 때). */
    @PostMapping("/schedules/{day}/sync")
    public ResponseEntity<String> syncSchedule(@AuthenticationPrincipal AuthUser authUser,
                                               @PathVariable("day") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate day) {
        return json(scheduleSync.sync(authUser.getId(), day));
    }

    /** 일정 저장 뒤 팝업 (카드 추천 또는 프로모션 추천). */
    @PostMapping("/schedule-popup")
    public ResponseEntity<String> schedulePopup(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.schedulePopup(authUser.getId()));
    }

    // ---------- 추천·리포트 ----------

    /** 맞춤 추천 페이지 (카드사 추천·가맹점 추천 탭). */
    @PostMapping("/recommendation-page")
    public ResponseEntity<String> recommendationPage(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.recommendationPage(authUser.getId()));
    }

    /** 신규 카드 추천. */
    @PostMapping("/card-recommendation")
    public ResponseEntity<String> cardRecommendation(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.cardRecommendation(authUser.getId()));
    }

    @GetMapping("/monthly-report")
    public ResponseEntity<String> monthlyReport(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.monthlyReport(authUser.getId()));
    }

    /** 연말정산: 놓친 혜택 상위 3장. */
    @GetMapping("/missed-benefit")
    public ResponseEntity<String> missedBenefit(@AuthenticationPrincipal AuthUser authUser,
                                                @RequestParam(value = "days", required = false) Integer days) {
        return json(ai.missedBenefit(authUser.getId(), days));
    }

    /** 이번 달 실적 채우기 방식과 고른 근거. */
    @GetMapping("/strategy")
    public ResponseEntity<String> strategy(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.strategy(authUser.getId()));
    }

    @PostMapping("/strategy/initialize")
    public ResponseEntity<String> initializeStrategy(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.initializeStrategy(authUser.getId()));
    }

    // ---------- 챗봇·규칙 ----------

    /** 챗봇. 본문: message, (session_id, history[{role, text}], screen{name, recommendation_id}) */
    @PostMapping("/chat")
    public ResponseEntity<String> chat(@AuthenticationPrincipal AuthUser authUser,
                                       @RequestBody Map<String, Object> body) {
        return json(ai.chat(authUser.getId(), body));
    }

    @GetMapping("/rules")
    public ResponseEntity<String> rules(@AuthenticationPrincipal AuthUser authUser) {
        return json(ai.rules(authUser.getId()));
    }

    /** 규칙을 통째로 저장한다. 본문: 규칙 목록 */
    @PutMapping("/rules")
    public ResponseEntity<String> saveRules(@AuthenticationPrincipal AuthUser authUser,
                                            @RequestBody List<Map<String, Object>> rules) {
        return json(ai.saveRules(authUser.getId(), rules));
    }

    /** 규칙 하나가 저장할 수 있는 모양인지 검사한다. 본문: {"rule": {...}} */
    @PostMapping("/rules/validate")
    @SuppressWarnings("unchecked")
    public ResponseEntity<String> validateRule(@AuthenticationPrincipal AuthUser authUser,
                                               @RequestBody Map<String, Object> body) {
        Object rule = body.get("rule");
        return json(ai.validateRule(authUser.getId(), rule instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of()));
    }

    /** 챗봇이 만든 규칙 초안을 저장한다. */
    @PostMapping("/rules/drafts/{draftId}/confirm")
    public ResponseEntity<String> confirmDraft(@AuthenticationPrincipal AuthUser authUser,
                                               @PathVariable("draftId") long draftId) {
        return json(ai.confirmDraft(authUser.getId(), draftId));
    }

    /** 챗봇이 만든 규칙 초안을 버린다. */
    @PostMapping("/rules/drafts/{draftId}/cancel")
    public ResponseEntity<String> cancelDraft(@AuthenticationPrincipal AuthUser authUser,
                                              @PathVariable("draftId") long draftId) {
        return json(ai.cancelDraft(authUser.getId(), draftId));
    }

    private static ResponseEntity<String> json(String body) {
        return ResponseEntity.ok().contentType(JSON_UTF8).body(body);
    }
}
