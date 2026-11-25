package com.paymate.backend.payment.controller;

import com.paymate.backend.payment.dto.PosDemoPaymentRequest;
import com.paymate.backend.payment.dto.PosMerchantResponse;
import com.paymate.backend.payment.dto.PosPaymentResponse;
import com.paymate.backend.payment.dto.PosTransactionResponse;
import com.paymate.backend.payment.service.PosDemoService;
import com.paymate.backend.payment.service.PosPaymentService;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 백엔드 가상 POS 화면(/pos)이 부르는 시연 API (2026-11-25). 로그인 없이 부르고, 만능 키(POS_DEMO_TERMINAL_KEY)가
 * 없는 서버에서는 셋 다 404 POS_DEMO_DISABLED. 키는 서버 안에서만 쓴다.
 */
@RestController
@RequestMapping("/api/v1/pos/demo")
@RequiredArgsConstructor
public class PosDemoController {

    private final PosDemoService posDemoService;
    private final PosPaymentService posPaymentService;

    @GetMapping("/merchants")
    public ResponseEntity<List<PosMerchantResponse>> merchants() {
        return ResponseEntity.ok(posDemoService.merchants());
    }

    @PostMapping("/payments")
    public ResponseEntity<PosPaymentResponse> pay(@Valid @RequestBody PosDemoPaymentRequest req) {
        return ResponseEntity.ok(posPaymentService.payDemo(req.getCode(), req.getAmount(), req.getMerchantId()));
    }

    @GetMapping("/transactions")
    public ResponseEntity<List<PosTransactionResponse>> transactions(
            @RequestParam(value = "limit", required = false) Integer limit) {
        return ResponseEntity.ok(posDemoService.recentTransactions(limit));
    }
}
