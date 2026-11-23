package com.paymate.backend.promotion.controller;

import com.paymate.backend.promotion.dto.PromotionResponse;
import com.paymate.backend.promotion.service.PromotionService;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 행사(카드사 이벤트·마이샵) 목록. 앱 혜택 탭·홈 미리보기·오늘의 프로모션이 쓴다. 로그인 필요. */
@RestController
@RequestMapping("/api/promotions")
@RequiredArgsConstructor
public class PromotionController {

    private final PromotionService promotionService;

    @GetMapping
    public List<PromotionResponse> list() {
        return promotionService.list();
    }
}
