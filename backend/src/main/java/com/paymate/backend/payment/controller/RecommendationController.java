package com.paymate.backend.payment.controller;

import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.payment.dto.CardRecommendationResponse;
import com.paymate.backend.payment.service.RecommendationService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/recommendations")
@RequiredArgsConstructor
public class RecommendationController {

    private final RecommendationService recommendationService;


    @GetMapping("/merchants/{merchantId}/cards")
    public ResponseEntity<List<CardRecommendationResponse>> cards(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("merchantId") Long merchantId,
            @RequestParam("amount") int amount
    ) {
        return ResponseEntity.ok(recommendationService.recommend(authUser.getId(), merchantId, amount));
    }
}