package com.paymate.backend.schedule.service;

import com.paymate.backend.common.DemoClock;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.common.exception.CommonErrorCode;
import com.paymate.backend.schedule.dto.ScheduleRequest;
import com.paymate.backend.schedule.dto.ScheduleResponse;
import com.paymate.backend.schedule.entity.Schedule;
import com.paymate.backend.schedule.event.ScheduleChangedEvent;
import com.paymate.backend.schedule.exception.ScheduleErrorCode;
import com.paymate.backend.schedule.repository.CategoryNameRow;
import com.paymate.backend.schedule.repository.ScheduleRepository;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ScheduleService {

    private static final String SITUATION = "SITUATION";
    private static final String PLACE = "PLACE";
    private static final String OTHER = "OTHER";
    private static final Set<String> OTHER_TYPES = Set.of("기타", "OTHER");

    private static final int MAX_PER_DAY = 10;          // AI 엔진이 하루 10개까지만 받는다 (2026-11-24)
    private static final int RANGE_YEARS = 1;           // 기준 시각의 1년 전 ~ 1년 뒤

    private final ScheduleRepository scheduleRepository;
    private final ApplicationEventPublisher events;   // 일정이 바뀐 날짜를 알린다 (AI 엔진에 다시 넘기는 데 쓴다)
    private final DemoClock clock;                    // '오늘'은 시연 시각(ai.fixed-at)을 따른다

    public ScheduleService(ScheduleRepository scheduleRepository, ApplicationEventPublisher events,
                           @Value("${ai.fixed-at:}") String fixedAt) {
        this.scheduleRepository = scheduleRepository;
        this.events = events;
        this.clock = DemoClock.of(fixedAt);
    }

    /** 날짜는 기준 시각 1년 전~1년 뒤, 그날 일정은 10개까지 (sameDay 면 이미 있는 일정을 고치는 것이라 개수를 세지 않는다). */
    private void checkDate(Long userId, LocalDate date, boolean sameDay) {
        LocalDate today = clock.today();
        if (date.isBefore(today.minusYears(RANGE_YEARS)) || date.isAfter(today.plusYears(RANGE_YEARS))) {
            throw new BusinessException(ScheduleErrorCode.DATE_OUT_OF_RANGE);
        }
        if (!sameDay && scheduleRepository.countByUserIdAndScheduleDate(userId, date) >= MAX_PER_DAY) {
            throw new BusinessException(ScheduleErrorCode.TOO_MANY_SCHEDULES);
        }
    }

    private record Parsed(String kind, String types, String category, String title,
                          String start, String end, String memo) {
    }

    @Transactional(readOnly = true)
    public List<ScheduleResponse> getSchedules(Long userId, String from) {
        List<Schedule> schedules = (from == null || from.isBlank())
                ? scheduleRepository.findAllByUser(userId)
                : scheduleRepository.findFromDate(userId, parseDate(from));

        Map<String, String> categoryNames = loadCategoryNames(schedules);
        return schedules.stream().map(s -> toResponse(s, categoryNames)).toList();
    }

    private Map<String, String> loadCategoryNames(List<Schedule> schedules) {
        Set<String> codes = schedules.stream()
                .map(Schedule::getCategory)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        if (codes.isEmpty()) {
            return Map.of();
        }
        return scheduleRepository.findCategoryNames(codes).stream()
                .collect(Collectors.toMap(CategoryNameRow::getCategory, CategoryNameRow::getCategoryName));
    }

    @Transactional
    public Long create(Long userId, ScheduleRequest req) {
        Parsed p = parse(req);
        checkDate(userId, req.getDate(), false);
        Schedule saved = scheduleRepository.save(new Schedule(
                userId, req.getDate(), p.kind(), p.types(), p.category(),
                p.title(), p.start(), p.end(), p.memo()));
        events.publishEvent(new ScheduleChangedEvent(userId, Set.of(req.getDate())));
        return saved.getId();
    }

    @Transactional
    public void update(Long userId, Long scheduleId, ScheduleRequest req) {
        Schedule schedule = findMine(userId, scheduleId);
        Parsed p = parse(req);
        checkDate(userId, req.getDate(), req.getDate().equals(schedule.getScheduleDate()));
        Set<LocalDate> changed = new LinkedHashSet<>(List.of(schedule.getScheduleDate(), req.getDate()));   // 날짜를 옮기면 두 날짜 모두
        schedule.update(req.getDate(), p.kind(), p.types(), p.category(),
                p.title(), p.start(), p.end(), p.memo());
        events.publishEvent(new ScheduleChangedEvent(userId, changed));
    }

    @Transactional
    public void delete(Long userId, Long scheduleId) {
        Schedule schedule = findMine(userId, scheduleId);
        scheduleRepository.delete(schedule);
        events.publishEvent(new ScheduleChangedEvent(userId, Set.of(schedule.getScheduleDate())));
    }

    private Schedule findMine(Long userId, Long scheduleId) {
        return scheduleRepository.findByIdAndUserId(scheduleId, userId)
                .orElseThrow(() -> new BusinessException(ScheduleErrorCode.SCHEDULE_NOT_FOUND));
    }

    private Parsed parse(ScheduleRequest req) {
        boolean hasTypes = req.getTypes() != null && !req.getTypes().isEmpty();
        boolean hasCategory = req.getCategory() != null && !req.getCategory().isBlank();
        if (hasTypes == hasCategory) {   // 둘 다 있거나 둘 다 없음
            throw new BusinessException(ScheduleErrorCode.INVALID_SCHEDULE_KIND);
        }

        String start = blankToNull(req.getStart());
        String end = blankToNull(req.getEnd());
        if ((start == null) != (end == null)) {
            throw new BusinessException(ScheduleErrorCode.TIME_PAIR_REQUIRED);
        }
        // 하루 안에서 시작 < 끝 (끝은 최대 24:00). 시작=끝·밤샘 일정은 받지 않는다 (2026-11-24 팀 결정)
        if (start != null && start.compareTo(end) >= 0) {
            throw new BusinessException(ScheduleErrorCode.INVALID_TIME_RANGE);
        }
        String memo = blankToNull(req.getMemo());

        if (hasTypes) {
            Set<String> types = new LinkedHashSet<>();
            for (String t : req.getTypes()) {
                String name = t == null ? "" : t.trim();
                if (name.isEmpty() || name.length() > 30 || name.contains(",")) {
                    throw new BusinessException(ScheduleErrorCode.INVALID_SCHEDULE_TYPE);
                }
                types.add(name);
            }
            String joined = String.join(",", types);
            if (joined.length() > 100) {
                throw new BusinessException(ScheduleErrorCode.INVALID_SCHEDULE_TYPE);
            }
            if (memo == null && types.stream().anyMatch(OTHER_TYPES::contains)) {
                throw new BusinessException(ScheduleErrorCode.MEMO_REQUIRED);
            }
            // 상황 일정도 '직접 입력'한 이름(예: 밥먹기)을 저장한다. 없으면 null (앱은 종류 이름을 보여준다)
            return new Parsed(SITUATION, joined, null, blankToNull(req.getTitle()), start, end, memo);
        }

        String category = req.getCategory().trim().toUpperCase();
        if (!scheduleRepository.existsCategory(category)) {
            throw new BusinessException(ScheduleErrorCode.INVALID_CATEGORY);
        }
        String title = blankToNull(req.getTitle());
        if (OTHER.equals(category) && title == null) {
            throw new BusinessException(ScheduleErrorCode.TITLE_REQUIRED);
        }
        if (start == null) {
            throw new BusinessException(ScheduleErrorCode.TIME_REQUIRED);
        }
        return new Parsed(PLACE, null, category, title, start, end, memo);
    }

    private ScheduleResponse toResponse(Schedule s, Map<String, String> categoryNames) {
        List<String> types = s.getTypes() == null ? List.of() : List.of(s.getTypes().split(","));
        String categoryName = s.getCategory() == null ? null : categoryNames.get(s.getCategory());
        return new ScheduleResponse(
                s.getId(), s.getScheduleDate(), s.getKind(), types, s.getCategory(), categoryName,
                s.getTitle(), s.getStartTime(), s.getEndTime(), s.getMemo());
    }

    private LocalDate parseDate(String value) {
        try {
            return LocalDate.parse(value.trim());
        } catch (DateTimeParseException e) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
