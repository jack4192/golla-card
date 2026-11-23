package com.paymate.backend.card.controller;

import com.paymate.backend.card.dto.BenefitResponse;
import com.paymate.backend.card.dto.MyCardResponse;
import com.paymate.backend.card.dto.RegisterCardRequest;
import com.paymate.backend.card.dto.RegisterCardResponse;
import com.paymate.backend.card.dto.ReorderCardsRequest;
import com.paymate.backend.card.service.UserCardService;
import com.paymate.backend.common.security.AuthUser;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/cards")
@RequiredArgsConstructor
public class CardController {

    private final UserCardService userCardService;

    @GetMapping("/user-cards")
    public ResponseEntity<List<MyCardResponse>> myCards(
            @AuthenticationPrincipal AuthUser authUser
    ) {
        return ResponseEntity.ok(userCardService.getMyCards(authUser.getId()));
    }

    @PostMapping("/register")
    public ResponseEntity<RegisterCardResponse> register(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody RegisterCardRequest req
    ) {
        Long userCardId = userCardService.register(authUser.getId(), req.getCardCode());
        return ResponseEntity.status(HttpStatus.CREATED).body(new RegisterCardResponse(userCardId));
    }

    @GetMapping("/{userCardId}/benefits")
    public ResponseEntity<List<BenefitResponse>> benefits(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("userCardId") Long userCardId
    ) {
        return ResponseEntity.ok(userCardService.getBenefits(authUser.getId(), userCardId));
    }

    @PatchMapping("/{userCardId}/representative")
    public ResponseEntity<Void> setRepresentative(
            @AuthenticationPrincipal AuthUser authUser,
            @PathVariable("userCardId") Long userCardId
    ) {
        userCardService.setRepresentative(authUser.getId(), userCardId);
        return ResponseEntity.noContent().build();
    }

    @PutMapping("/order")
    public ResponseEntity<Void> reorder(
            @AuthenticationPrincipal AuthUser authUser,
            @Valid @RequestBody ReorderCardsRequest req
    ) {
        userCardService.reorder(authUser.getId(), req.getUserCardIds());
        return ResponseEntity.noContent().build();
    }
}
