package com.paymate.backend.schedule.controller;

import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.schedule.dto.ScheduleIdResponse;
import com.paymate.backend.schedule.dto.ScheduleRequest;
import com.paymate.backend.schedule.dto.ScheduleResponse;
import com.paymate.backend.schedule.service.ScheduleService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/schedules")
@RequiredArgsConstructor
public class ScheduleController {

    private final ScheduleService scheduleService;

    @GetMapping
    public ResponseEntity<List<ScheduleResponse>> list(
            @AuthenticationPrincipal AuthUser authUser,
            @RequestParam(value = "from", required = false) String from
    ) {
        return ResponseEntity.ok(scheduleService.getSchedules(authUser.getId(), from));
    }

    @PostMapping
    public ResponseEntity<ScheduleIdResponse> create(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody ScheduleRequest req
    ) {
        Long scheduleId = scheduleService.create(authUser.getId(), req);
        return ResponseEntity.status(HttpStatus.CREATED).body(new ScheduleIdResponse(scheduleId));
    }

    @PutMapping("/{scheduleId}")
    public ResponseEntity<Void> update(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("scheduleId") Long scheduleId,
            @Valid @RequestBody ScheduleRequest req
    ) {
        scheduleService.update(authUser.getId(), scheduleId, req);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{scheduleId}")
    public ResponseEntity<Void> delete(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("scheduleId") Long scheduleId
    ) {
        scheduleService.delete(authUser.getId(), scheduleId);
        return ResponseEntity.noContent().build();
    }
}
