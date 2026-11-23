package com.paymate.backend.schedule.service;

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
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ScheduleService {

    private static final String SITUATION = "SITUATION";
    private static final String PLACE = "PLACE";
    private static final String OTHER = "OTHER";
    private static final Set<String> OTHER_TYPES = Set.of("기타", "OTHER");

    private final ScheduleRepository scheduleRepository;
    private final ApplicationEventPublisher events;   // 일정이 바뀐 날짜를 알린다 (AI 엔진에 다시 넘기는 데 쓴다)

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
