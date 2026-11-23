package com.paymate.backend.ai;

import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.event.ScheduleChangedEvent;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 백엔드의 일정을 AI 엔진의 하루 일정으로 바꿔 넘긴다.
 *
 * <p>AI 엔진은 '몇 시부터 몇 시까지, 어느 업종에서, 얼마쯤 쓴다'만 받는다. 그래서
 * <ul>
 *   <li>장소 일정(PLACE)만 넘긴다. 상황 일정과 직접 입력(OTHER)은 업종을 알 수 없어 넘기지 않는다.</li>
 *   <li>금액은 일정에 없으므로 과거 결제로 채운다: 내 중앙값 → 전체 사용자 중앙값 → 10,000원.</li>
 *   <li>하루 일정을 통째로 바꾼다 (AI 엔진 API 가 그렇게 받는다). 하루 10개까지.</li>
 * </ul>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ScheduleAiSync {

    private static final String PLACE = "PLACE";
    private static final Set<String> UNKNOWN_CATEGORIES = Set.of("OTHER", "ALL");
    private static final int DEFAULT_AMOUNT = 10_000;
    private static final int MAX_ITEMS = 10;

    private final AiScheduleRepository schedules;
    private final AiService ai;

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
        List<Map<String, Object>> items = new ArrayList<>();
        for (Schedule s : schedules.findByUserIdAndScheduleDateOrderByStartTimeAscIdAsc(userId, day)) {
            if (items.size() == MAX_ITEMS) {
                break;
            }
            if (!PLACE.equals(s.getKind()) || s.getCategory() == null || UNKNOWN_CATEGORIES.contains(s.getCategory())
                    || s.getStartTime() == null || s.getEndTime() == null) {
                continue;
            }
            String end = "24:00".equals(s.getEndTime()) ? "23:59" : s.getEndTime();   // AI 엔진은 24:00 을 못 읽는다
            if (end.compareTo(s.getStartTime()) <= 0) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("start", s.getStartTime());
            item.put("end", end);
            item.put("category", s.getCategory());
            item.put("amount", amountOf(userId, s.getCategory()));
            items.add(item);
        }
        return items;
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
