package com.paymate.backend.ai;

import com.paymate.backend.card.repository.UserCardRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * AI 엔진 기능을 하나씩 부르는 곳. 사용자 번호는 항상 로그인 토큰에서 온 값만 쓰고,
 * 기준 시각(at)은 서버 설정(ai.fixed-at)으로만 정한다. 앱이 보낸 user_id·at 은 쓰지 않는다.
 *
 * <p>답은 AI 엔진의 JSON 을 바꾸지 않고 그대로 돌려준다 (필드 설명: solpay-ai/openapi.json).
 */
@Slf4j
@Service
public class AiService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final List<String> CHAT_FIELDS = List.of("message", "session_id", "history", "screen");
    private static final List<String> EVALUATE_FIELDS = List.of("category_code", "amount", "user_card_id", "merchant_id");
    private static final String FALLBACK_MESSAGE = "AI 응답이 없어 기본 순서로 보여 드려요";

    private final AiClient client;
    private final UserCardRepository userCards;
    private final String fixedAt;         // 시연용 기준 시각. 없으면 null (= 현재 시각)
    private final LocalDate fixedDate;

    public AiService(AiClient client, UserCardRepository userCards, @Value("${ai.fixed-at:}") String fixedAt) {
        this.client = client;
        this.userCards = userCards;
        this.fixedAt = fixedAt == null || fixedAt.isBlank() ? null : fixedAt.trim();
        this.fixedDate = this.fixedAt == null ? null : parseDate(this.fixedAt);
        if (this.fixedAt != null) {
            log.warn("AI 기준 시각을 {} 로 고정했습니다 (ai.fixed-at). 시연용 설정입니다.", this.fixedAt);
        }
    }

    private static LocalDate parseDate(String value) {
        try {
            return LocalDateTime.parse(value).toLocalDate();
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(value).atZoneSameInstant(SEOUL).toLocalDate();
            } catch (DateTimeParseException e2) {
                throw new IllegalArgumentException(
                        "ai.fixed-at(AI_FIXED_AT) 형식이 올바르지 않습니다. 예: 2026-11-05T09:30:00 (값: " + value + ")");
            }
        }
    }

    /** AI 엔진이 보는 '오늘'. 기준 시각을 고정했으면 그 날짜다. */
    public LocalDate today() {
        return fixedDate != null ? fixedDate : LocalDate.now(SEOUL);
    }

    // ---------- 결제 화면 카드 배치 ----------

    /**
     * 카드 순서와 안내 문구. AI 가 제한 시간 안에 답하지 못하면 내 카드의 표시 순서대로 돌려준다
     * (reason_code=FALLBACK). 결제 화면이 AI 때문에 멈추면 안 되기 때문이다.
     *
     * @return AI 답(JSON 글자) 또는 기본 순서(Map)
     */
    public Object rank(Long userId, boolean explain) {
        Map<String, Object> body = withAt(userBody(userId));
        body.put("explain", explain);
        try {
            return client.postFast("/internal/rank", body);
        } catch (AiException e) {
            log.warn("카드 배치를 기본 순서로 대신합니다: user={} ({})", userId, e.getCode());
            return fallbackRank(userId);
        }
    }

    private Map<String, Object> fallbackRank(Long userId) {
        List<Long> ids = userCards.findOrderedIds(userId);
        List<Map<String, Object>> cards = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            Map<String, Object> card = new LinkedHashMap<>();
            card.put("user_card_id", ids.get(i));
            card.put("rank", i + 1);
            card.put("score_won", 0);
            card.put("message", i == 0 ? FALLBACK_MESSAGE : "");
            cards.add(card);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("recommendation_id", null);
        result.put("cards", cards);
        result.put("display_count", cards.isEmpty() ? 0 : 1);
        result.put("reason_code", "FALLBACK");
        result.put("rule_applied", null);
        result.put("version", "unknown");
        result.put("scenario_mode", "fallback");
        result.put("explanation", null);
        return result;
    }

    // ---------- 조회 ----------

    public String health() {
        return client.get("/health", null);
    }

    public String me(Long userId) {
        return client.get(userPath(userId, ""), null);
    }

    /** 카드별 실적 현황. */
    public String cardStatus(Long userId) {
        return client.get(userPath(userId, "/cards"), atQuery());
    }

    public String monthlyReport(Long userId) {
        return client.get(userPath(userId, "/monthly-report"), atQuery());
    }

    /** 연말정산: 지난 days 일 동안 놓친 혜택 (days 가 없으면 AI 기본값 365). */
    public String missedBenefit(Long userId, Integer days) {
        Map<String, Object> query = atQuery();
        query.put("days", days);
        return client.get(userPath(userId, "/missed-benefit"), query);
    }

    public String strategy(Long userId) {
        return client.get(userPath(userId, "/strategy"), atQuery());
    }

    public String initializeStrategy(Long userId) {
        return client.post(userPath(userId, "/strategy/initialize"), atQuery(), null);
    }

    public String merchants(String zone) {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("zone", zone == null || zone.isBlank() ? null : zone);
        return client.get("/internal/merchants", query);
    }

    // ---------- 일정 ----------

    public String schedule(Long userId, LocalDate day) {
        return client.get(userPath(userId, "/schedules/" + day), null);
    }

    /** 하루 일정을 통째로 바꾼다. 빈 목록이면 그날 일정을 지운다. */
    public String putSchedule(Long userId, LocalDate day, List<Map<String, Object>> items) {
        return client.put(userPath(userId, "/schedules/" + day), atQuery(), Map.of("items", items));
    }

    public String schedulePopup(Long userId) {
        return client.post(userPath(userId, "/schedule-popup"), null, withAt(new LinkedHashMap<>()));
    }

    // ---------- 추천 ----------

    public String recommendationPage(Long userId) {
        return client.post(userPath(userId, "/recommendation-page"), null, withAt(new LinkedHashMap<>()));
    }

    public String cardRecommendation(Long userId) {
        return client.post(userPath(userId, "/card-recommendation"), null, withAt(new LinkedHashMap<>()));
    }

    /** 가정 계산: 이 업종에서 이 금액을 내면 카드별로 얼마를 받는지. */
    public String evaluate(Long userId, Map<String, Object> request) {
        Map<String, Object> body = userBody(userId);
        copy(request, body, EVALUATE_FIELDS);
        return client.post("/internal/payments/evaluate", null, withAt(body));
    }

    // ---------- 챗봇·규칙 ----------

    public String chat(Long userId, Map<String, Object> request) {
        Map<String, Object> body = userBody(userId);
        copy(request, body, CHAT_FIELDS);
        return client.post("/internal/chat", null, withAt(body));
    }

    public String rules(Long userId) {
        return client.get(userPath(userId, "/rules"), null);
    }

    public String saveRules(Long userId, List<Map<String, Object>> rules) {
        return client.put(userPath(userId, "/rules"), null, rules);
    }

    public String validateRule(Long userId, Map<String, Object> rule) {
        Map<String, Object> body = userBody(userId);
        body.put("rule", rule);
        return client.post("/internal/rules/validate", null, body);
    }

    public String confirmDraft(Long userId, long draftId) {
        return client.post("/internal/rules/drafts/" + draftId + "/confirm", null, userBody(userId));
    }

    public String cancelDraft(Long userId, long draftId) {
        return client.post("/internal/rules/drafts/" + draftId + "/cancel", null, userBody(userId));
    }

    // ---------- 공통 ----------

    private static String userPath(Long userId, String rest) {
        return "/internal/users/" + userId + rest;
    }

    private static Map<String, Object> userBody(Long userId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("user_id", userId);
        return body;
    }

    private Map<String, Object> withAt(Map<String, Object> body) {
        if (fixedAt != null) {
            body.put("at", fixedAt);
        }
        return body;
    }

    private Map<String, Object> atQuery() {
        Map<String, Object> query = new LinkedHashMap<>();
        query.put("at", fixedAt);
        return query;
    }

    /** 앱이 보낸 본문에서 허용한 값만 옮긴다 (user_id·at 같은 값을 앱이 정하지 못하게). */
    private static void copy(Map<String, Object> from, Map<String, Object> to, List<String> fields) {
        if (from == null) {
            return;
        }
        for (String field : fields) {
            if (from.get(field) != null) {
                to.put(field, from.get(field));
            }
        }
    }
}
