package com.paymate.backend.card.controller;

import com.paymate.backend.card.dto.CardProductDetailResponse;
import com.paymate.backend.card.dto.CardProductSummaryResponse;
import com.paymate.backend.card.service.CardProductService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/card-products")
@RequiredArgsConstructor
public class CardProductController {

    private final CardProductService cardProductService;

    @GetMapping
    public List<CardProductSummaryResponse> search(
            @RequestParam(value = "keyword", required = false) String keyword
    ) {
        return cardProductService.search(keyword);
    }

    @GetMapping("/{cardCode}")
    public CardProductDetailResponse detail(@PathVariable("cardCode") String cardCode) {
        return cardProductService.getDetail(cardCode);
    }
}
