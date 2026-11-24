package com.paymate.backend.payment.controller;

import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.payment.dto.AppPayRequest;
import com.paymate.backend.payment.dto.IssuePaymentTokenRequest;
import com.paymate.backend.payment.dto.PaymentTokenResponse;
import com.paymate.backend.payment.dto.PaymentTokenStatusResponse;
import com.paymate.backend.payment.dto.PosPaymentResponse;
import com.paymate.backend.payment.service.PaymentTokenService;
import com.paymate.backend.payment.service.PosPaymentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/payment-tokens")
@RequiredArgsConstructor
public class PaymentTokenController {

    private final PaymentTokenService paymentTokenService;
    private final PosPaymentService posPaymentService;

    // 다시 호출하면 이전 코드 취소
    @PostMapping
    public ResponseEntity<PaymentTokenResponse> issue(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody IssuePaymentTokenRequest req
    ) {
        PaymentTokenResponse body = paymentTokenService.issue(authUser.getId(), req.getUserCardId());
        return ResponseEntity.status(HttpStatus.CREATED).body(body);
    }

    @GetMapping("/{paymentTokenId}")
    public ResponseEntity<PaymentTokenStatusResponse> status(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("paymentTokenId") Long paymentTokenId
    ) {
        return ResponseEntity.ok(paymentTokenService.getStatus(authUser.getId(), paymentTokenId));
    }


    @PostMapping("/{paymentTokenId}/cancel")
    public ResponseEntity<Void> cancel(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("paymentTokenId") Long paymentTokenId
    ) {
        paymentTokenService.cancel(authUser.getId(), paymentTokenId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{paymentTokenId}/pay")
    public ResponseEntity<PosPaymentResponse> pay(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("paymentTokenId") Long paymentTokenId,
            @Valid @RequestBody(required = false) AppPayRequest req
    ) {
        Long merchantId = req == null ? null : req.getMerchantId();
        String category = req == null ? null : req.getCategory();
        Integer amount = req == null ? null : req.getAmount();
        return ResponseEntity.ok(posPaymentService.payFromApp(authUser.getId(), paymentTokenId, merchantId, category, amount));
    }
}
