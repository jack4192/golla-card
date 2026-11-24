package com.paymate.backend.ai;

import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.event.ScheduleChangedEvent;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.LongSupplier;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 백엔드의 일정을 AI 엔진의 하루 일정으로 바꿔 넘긴다.
 *
 * <p>AI 엔진은 '몇 시부터 몇 시까지, 어느 업종에서, 얼마쯤 쓴다'만 받는다. 그래서
 * <ul>
 *   <li>장소 일정(PLACE)을 넘긴다. 상황 일정은 업종을 알 수 없어 넘기지 않는다.</li>
 *   <li>직접 입력(OTHER) 일정은 이름(예: 스타벅스)을 AI 분류기에 물어, 업종이 나오면 그 업종과 가맹점으로 넘긴다.
 *       업종을 못 찾거나 분류에 실패하면 넘기지 않는다. DB 의 일정은 바꾸지 않는다.</li>
 *   <li>일정 추가 창(팀원 PR #5)의 직접 입력은 상황 일정(종류 other + 이름)으로 저장된다. 시간이 있으면 이것도
 *       장소 일정의 직접 입력처럼 이름을 분류해 넘긴다 (2026-11-24: 영화관·골프 일정이 AI 에 안 가던 문제).</li>
 *   <li>분류는 일정 저장 중에 일어나므로, 한 번 넘길 때 분류에 쓰는 시간을 4초로 묶는다 (남은 것은 넘기지 않는다).</li>
 *   <li>금액은 일정에 없으므로 과거 결제로 채운다: 내 중앙값 → 전체 사용자 중앙값 → 10,000원.
 *       중앙값은 1시간 동안 기억한다(AmountMedians, 일정 저장 속도 2026-11-24).</li>
 *   <li>하루 일정을 통째로 바꾼다 (AI 엔진 API 가 그렇게 받는다). 하루 10개까지.</li>
 * </ul>
 */
@Slf4j
@Component
public class ScheduleAiSync {

    private static final String PLACE = "PLACE";
    private static final String SITUATION = "SITUATION";
    private static final String TYPED_DIRECT_INPUT = "other";     // 상황 일정의 '직접 입력' 종류 (앱 일정 추가 창)
    private static final String DIRECT_INPUT = "OTHER";
    private static final Set<String> UNKNOWN_CATEGORIES = Set.of("OTHER", "ALL");
    private static final int MAX_ITEMS = 10;
    private static final int TITLE_LIMIT = 100;                  // AI 분류기가 받는 글 길이
    private static final long CLASSIFY_BUDGET_NANOS = 4_000_000_000L;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** AI 에 넘길 업종과 가맹점 브랜드 코드(없으면 null). */
    private record Place(String category, String brand) {
    }

    private final AiScheduleRepository schedules;
    private final AiService ai;
    private final LongSupplier nanoClock;
    private final AmountMedians medians;

    @Autowired
    public ScheduleAiSync(AiScheduleRepository schedules, AiService ai) {
        this(schedules, ai, System::nanoTime);
    }

    ScheduleAiSync(AiScheduleRepository schedules, AiService ai, LongSupplier nanoClock) {
        this.schedules = schedules;
        this.ai = ai;
        this.nanoClock = nanoClock;
        this.medians = new AmountMedians(schedules);
    }

    /** 일정 저장이 끝난(커밋된) 뒤에 넘긴다. 실패해도 일정 저장은 이미 성공이므로 경고만 남긴다. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void on(ScheduleChangedEvent event) {
        for (LocalDate day : event.dates()) {
            if (day.isBefore(ai.today())) {
                continue;                      // 지난 날의 일정은 AI 엔진이 받지 않는다
            }
            try {
                ai.putSchedule(event.userId(), day, itemsFor(event.userId(), day));
            } catch (RuntimeException e) {
                log.warn("일정을 AI 엔진에 넘기지 못했습니다: user={} day={} ({})", event.userId(), day, e.getMessage());
            }
        }
    }

    /** 그날 일정을 지금 다시 넘긴다 (실패하면 예외). AI 엔진의 답을 돌려준다. */
    public String sync(Long userId, LocalDate day) {
        return ai.putSchedule(userId, day, itemsFor(userId, day));
    }

    /**
     * AI 엔진의 그날 일정이 서버 일정과 다르면 다시 넘긴다 (맞춤 추천을 부르기 전에, 2026-11-23).
     *
     * <p>일정은 저장할 때만 넘기므로, AI 가 꺼져 있었거나 서버를 다시 켜는 중에 저장했거나 직접 입력을 넘기지 않던 옛 백엔드로
     * 저장한 일정은 AI 에 없다. 그러면 AI 는 '오늘 일정 없음'으로 보고 평소 소비로 추천한다.
     * 같으면 아무것도 하지 않는다 (다시 넘기면 AI 가 그날 추천을 버리고 새로 계산하므로). 실패해도 경고만 남긴다.
     */
    public void ensureSynced(Long userId, LocalDate day) {
        try {
            // AI 의 일정을 먼저 읽는다: AI 가 꺼져 있으면 분류·중앙값 계산을 하지 않고 바로 넘어간다
            JsonNode current = JSON.readTree(ai.schedule(userId, day)).path("items");
            Collected expected = collect(userId, day);
            if (!expected.complete) {
                // 직접 입력을 이번에 분류하지 못했다(실패·시간 초과). '업종 없음'과 구분할 수 없으니 AI 의 일정을 그대로 둔다
                log.info("직접 입력 일정을 분류하지 못해 AI 일정을 바꾸지 않습니다: user={} day={}", userId, day);
                return;
            }
            if (!sameItems(expected.items, current)) {
                ai.putSchedule(userId, day, expected.items);
            }
        } catch (RuntimeException e) {
            log.warn("맞춤 추천 전에 일정을 맞추지 못했습니다: user={} day={} ({})", userId, day, e.getMessage());
        }
    }

    /** (시작, 끝, 업종, 금액, 브랜드) 목록이 순서까지 같은지. 브랜드가 없으면 서버는 칸이 없고 AI 는 null 로 준다. */
    private static boolean sameItems(List<Map<String, Object>> expected, JsonNode current) {
        if (!current.isArray() || current.size() != expected.size()) {
            return false;
        }
        for (int i = 0; i < expected.size(); i++) {
            Map<String, Object> e = expected.get(i);
            JsonNode c = current.get(i);
            JsonNode brand = c.path("brand");
            String currentBrand = brand.isMissingNode() || brand.isNull() ? null : brand.asString();
            if (!String.valueOf(e.get("start")).equals(c.path("start").asString())
                    || !String.valueOf(e.get("end")).equals(c.path("end").asString())
                    || !String.valueOf(e.get("category")).equals(c.path("category").asString())
                    || ((Number) e.get("amount")).intValue() != c.path("amount").asInt()
                    || !Objects.equals(e.get("brand"), currentBrand)) {
                return false;
            }
        }
        return true;
    }

    /** 그날 일정 중 AI 엔진에 넘길 것. */
    public List<Map<String, Object>> itemsFor(Long userId, LocalDate day) {
        return collect(userId, day).items;
    }

    /** 넘길 항목과, 직접 입력을 모두 분류했는지(실패·시간 초과가 없었는지). */
    private static final class Collected {
        final List<Map<String, Object>> items = new ArrayList<>();
        boolean complete = true;
    }

    private Collected collect(Long userId, LocalDate day) {
        long deadline = nanoClock.getAsLong() + CLASSIFY_BUDGET_NANOS;
        Map<String, Optional<Place>> guesses = new HashMap<>();      // 같은 이름은 한 번만 묻는다
        Collected out = new Collected();
        List<Map<String, Object>> items = out.items;
        for (Schedule s : schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(userId, day)) {
            if (items.size() == MAX_ITEMS) {
                break;
            }
            boolean typedDirect = isTypedDirectInput(s);
            boolean place = PLACE.equals(s.getKind()) && s.getCategory() != null;
            if (!(place || typedDirect) || s.getStartTime() == null || s.getEndTime() == null) {
                continue;
            }
            String end = "24:00".equals(s.getEndTime()) ? "23:59" : s.getEndTime();   // AI 엔진은 24:00 을 못 읽는다
            if (end.compareTo(s.getStartTime()) <= 0) {
                continue;
            }
            Place found = typedDirect ? classifyTitle(s, guesses, deadline, out) : placeOf(s, guesses, deadline, out);
            if (found == null) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("start", s.getStartTime());
            item.put("end", end);
            item.put("category", found.category());
            item.put("amount", amountOf(userId, found.category()));
            if (found.brand() != null) {
                item.put("brand", found.brand());
            }
            items.add(item);
        }
        return out;
    }

    /** 일정의 업종. 직접 입력은 이름을 분류해서 정하고, 정하지 못하면 null (넘기지 않음).
     *  분류에 실패했거나 시간을 다 써서 정하지 못했으면 out.complete 를 false 로 둔다. */
    private Place placeOf(Schedule s, Map<String, Optional<Place>> guesses, long deadline, Collected out) {
        if (!DIRECT_INPUT.equals(s.getCategory())) {
            return UNKNOWN_CATEGORIES.contains(s.getCategory()) ? null : new Place(s.getCategory(), null);
        }
        return classifyTitle(s, guesses, deadline, out);
    }

    /** 상황 일정인데 종류가 '직접 입력(other)'이고 이름이 있는지 (앱 일정 추가 창). */
    private static boolean isTypedDirectInput(Schedule s) {
        if (!SITUATION.equals(s.getKind()) || s.getTypes() == null || s.getTitle() == null || s.getTitle().isBlank()) {
            return false;
        }
        return Arrays.stream(s.getTypes().split(",")).map(String::strip).anyMatch(TYPED_DIRECT_INPUT::equalsIgnoreCase);
    }

    /** 일정 이름을 분류해 업종을 정한다. 정하지 못하면 null, 실패·시간 초과면 out.complete 를 false 로 둔다. */
    private Place classifyTitle(Schedule s, Map<String, Optional<Place>> guesses, long deadline, Collected out) {
        String title = s.getTitle() == null ? "" : s.getTitle().strip();
        if (title.isEmpty() || title.length() > TITLE_LIMIT) {
            return null;
        }
        if (guesses.containsKey(title)) {
            Optional<Place> known = guesses.get(title);
            if (known == null) {
                out.complete = false;           // 같은 이름을 이번에 이미 분류하지 못했다
            }
            return known == null ? null : known.orElse(null);
        }
        if (nanoClock.getAsLong() - deadline >= 0) {
            out.complete = false;
            return null;                       // 분류에 쓸 시간을 다 썼다. 다음에 일정을 저장할 때 다시 묻는다
        }
        Optional<Place> guess = classify(title);
        guesses.put(title, guess);             // 실패(null)도 기억해 같은 이름을 다시 묻지 않는다
        if (guess == null) {
            out.complete = false;
            return null;
        }
        return guess.orElse(null);
    }

    /** AI 분류기에 묻는다. 업종을 못 찾으면 비어 있고, 분류에 실패하면 null. 입력 글은 로그에 남기지 않는다. */
    private Optional<Place> classify(String title) {
        try {
            JsonNode answer = JSON.readTree(ai.classifyPlace(title));
            String category = textOf(answer, "category");
            if (category == null || UNKNOWN_CATEGORIES.contains(category)) {
                return Optional.empty();
            }
            return Optional.of(new Place(category, textOf(answer, "brand")));
        } catch (RuntimeException e) {
            log.warn("직접 입력 일정을 분류하지 못했습니다 ({})", e.getClass().getSimpleName());
            return null;
        }
    }

    private static String textOf(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        if (value == null || !value.isString()) {
            return null;
        }
        String text = value.asString().strip();
        return text.isEmpty() ? null : text;
    }

    private int amountOf(Long userId, String category) {
        return medians.amountOf(userId, category);
    }
}
