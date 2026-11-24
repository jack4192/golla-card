package com.paymate.backend.payment.controller;

import com.paymate.backend.payment.dto.PosPaymentRequest;
import com.paymate.backend.payment.dto.PosPaymentResponse;
import com.paymate.backend.payment.service.PosPaymentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/pos")
@RequiredArgsConstructor
public class PosController {

    private final PosPaymentService posPaymentService;

    @PostMapping("/payments")
    public ResponseEntity<PosPaymentResponse> pay(@Valid @RequestBody PosPaymentRequest req) {
        return ResponseEntity.ok(posPaymentService.pay(req));
    }
}
