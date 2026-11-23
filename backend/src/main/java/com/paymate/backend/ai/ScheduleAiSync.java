package com.paymate.backend.ai;

import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.event.ScheduleChangedEvent;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
 *   <li>장소 일정(PLACE)만 넘긴다. 상황 일정은 업종을 알 수 없어 넘기지 않는다.</li>
 *   <li>직접 입력(OTHER) 일정은 이름(예: 스타벅스)을 AI 분류기에 물어, 업종이 나오면 그 업종과 가맹점으로 넘긴다.
 *       업종을 못 찾거나 분류에 실패하면 넘기지 않는다. DB 의 일정은 바꾸지 않는다.</li>
 *   <li>분류는 일정 저장 중에 일어나므로, 한 번 넘길 때 분류에 쓰는 시간을 4초로 묶는다 (남은 것은 넘기지 않는다).</li>
 *   <li>금액은 일정에 없으므로 과거 결제로 채운다: 내 중앙값 → 전체 사용자 중앙값 → 10,000원.</li>
 *   <li>하루 일정을 통째로 바꾼다 (AI 엔진 API 가 그렇게 받는다). 하루 10개까지.</li>
 * </ul>
 */
@Slf4j
@Component
public class ScheduleAiSync {

    private static final String PLACE = "PLACE";
    private static final String DIRECT_INPUT = "OTHER";
    private static final Set<String> UNKNOWN_CATEGORIES = Set.of("OTHER", "ALL");
    private static final int DEFAULT_AMOUNT = 10_000;
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

    @Autowired
    public ScheduleAiSync(AiScheduleRepository schedules, AiService ai) {
        this(schedules, ai, System::nanoTime);
    }

    ScheduleAiSync(AiScheduleRepository schedules, AiService ai, LongSupplier nanoClock) {
        this.schedules = schedules;
        this.ai = ai;
        this.nanoClock = nanoClock;
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

    /** 그날 일정 중 AI 엔진에 넘길 것. */
    public List<Map<String, Object>> itemsFor(Long userId, LocalDate day) {
        long deadline = nanoClock.getAsLong() + CLASSIFY_BUDGET_NANOS;
        Map<String, Optional<Place>> guesses = new HashMap<>();      // 같은 이름은 한 번만 묻는다
        List<Map<String, Object>> items = new ArrayList<>();
        for (Schedule s : schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(userId, day)) {
            if (items.size() == MAX_ITEMS) {
                break;
            }
            if (!PLACE.equals(s.getKind()) || s.getCategory() == null || s.getStartTime() == null || s.getEndTime() == null) {
                continue;
            }
            String end = "24:00".equals(s.getEndTime()) ? "23:59" : s.getEndTime();   // AI 엔진은 24:00 을 못 읽는다
            if (end.compareTo(s.getStartTime()) <= 0) {
                continue;
            }
            Place place = placeOf(s, guesses, deadline);
            if (place == null) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("start", s.getStartTime());
            item.put("end", end);
            item.put("category", place.category());
            item.put("amount", amountOf(userId, place.category()));
            if (place.brand() != null) {
                item.put("brand", place.brand());
            }
            items.add(item);
        }
        return items;
    }

    /** 일정의 업종. 직접 입력은 이름을 분류해서 정하고, 정하지 못하면 null (넘기지 않음). */
    private Place placeOf(Schedule s, Map<String, Optional<Place>> guesses, long deadline) {
        if (!DIRECT_INPUT.equals(s.getCategory())) {
            return UNKNOWN_CATEGORIES.contains(s.getCategory()) ? null : new Place(s.getCategory(), null);
        }
        String title = s.getTitle() == null ? "" : s.getTitle().strip();
        if (title.isEmpty() || title.length() > TITLE_LIMIT) {
            return null;
        }
        Optional<Place> known = guesses.get(title);
        if (known != null) {
            return known.orElse(null);
        }
        if (nanoClock.getAsLong() - deadline >= 0) {
            return null;                       // 분류에 쓸 시간을 다 썼다. 다음에 일정을 저장할 때 다시 묻는다
        }
        Optional<Place> guess = classify(title);
        guesses.put(title, guess);
        return guess.orElse(null);
    }

    /** AI 분류기에 묻는다. 업종을 못 찾거나 실패하면 비어 있다. 입력 글은 로그에 남기지 않는다. */
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
            return Optional.empty();
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
        Integer mine = schedules.medianAmountOfUser(userId, category);
        if (mine != null && mine > 0) {
            return mine;
        }
        Integer everyone = schedules.medianAmount(category);
        return everyone != null && everyone > 0 ? everyone : DEFAULT_AMOUNT;
    }
}
