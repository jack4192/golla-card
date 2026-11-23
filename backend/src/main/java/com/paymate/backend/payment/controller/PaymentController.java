package com.paymate.backend.payment.controller;

import com.paymate.backend.payment.dto.PaymentResponse;
import com.paymate.backend.payment.service.PaymentService;
import com.paymate.backend.common.security.AuthUser;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 내 결제 내역 (홈 시간 표시줄의 결제 점·최근 결제). 로그인 필요, 기준 시각까지만. */
@RestController
@RequestMapping("/api/payments")
@RequiredArgsConstructor
public class PaymentController {

    private final PaymentService paymentService;

    /** 그날 결제, 시간순. */
    @GetMapping
    public List<PaymentResponse> ofDay(@AuthenticationPrincipal AuthUser authUser,
                                       @RequestParam("date") @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return paymentService.ofDay(authUser.getId(), date);
    }

    /** 최근순 (limit 기본 5, 최대 50). beforeId 를 주면 그 번호보다 오래된 결제 (더 보기). */
    @GetMapping("/recent")
    public List<PaymentResponse> recent(@AuthenticationPrincipal AuthUser authUser,
                                        @RequestParam(value = "beforeId", required = false) Long beforeId,
                                        @RequestParam(value = "limit", required = false) Integer limit) {
        return paymentService.recent(authUser.getId(), beforeId, limit);
    }
}
