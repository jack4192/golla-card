package com.paymate.backend.promotion.service;

import com.paymate.backend.promotion.dto.PromotionResponse;
import com.paymate.backend.promotion.repository.PromotionRepository;
import com.paymate.backend.promotion.repository.PromotionRow;
import java.util.Comparator;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 혜택 탭 행사 목록. 기간 필터는 하지 않는다 (앱이 '기간 내·진행 예정·기간 종료'를 표시한다). */
@Service
@RequiredArgsConstructor
public class PromotionService {

    private static final String EVENT = "event";

    private final PromotionRepository promotionRepository;

    @Transactional(readOnly = true)
    public List<PromotionResponse> list() {
        return promotionRepository.findAllForList().stream()
                .map(PromotionService::toResponse)
                .sorted(Comparator.comparing((PromotionResponse r) -> EVENT.equals(r.kind()) ? 0 : 1)
                        .thenComparing(PromotionResponse::promotionId))
                .toList();
    }

    private static PromotionResponse toResponse(PromotionRow r) {
        Integer min = r.getMinAmount() == null || r.getMinAmount() == 0 ? null : r.getMinAmount();
        return new PromotionResponse(
                r.getPromotionId(), r.getKind(),
                firstOf(r.getDisplayName(), r.getMerchantName(), r.getPromoName()),
                r.getBenefitType(), r.getBenefitText(), min, r.getMaxAmount(),
                firstOf(r.getDisplayStart(), r.getStartDate()), firstOf(r.getDisplayEnd(), r.getEndDate()),
                r.getPayout(), r.getPayMethod(), r.getNote(),
                Boolean.TRUE.equals(r.getNeedsCheck()), r.getLogoUrl());
    }

    private static String firstOf(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return null;
    }
}
