package com.paymate.backend.payment.service;

import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.card.repository.UserCardSummaryRow;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.common.exception.CommonErrorCode;
import com.paymate.backend.payment.benefit.BenefitCalculator;
import com.paymate.backend.payment.benefit.BenefitResult;
import com.paymate.backend.payment.dto.CardRecommendationResponse;
import com.paymate.backend.payment.exception.PaymentErrorCode;
import com.paymate.backend.payment.repository.BenefitRuleRepository;
import com.paymate.backend.payment.repository.MerchantRow;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;


@Service
@RequiredArgsConstructor
public class RecommendationService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final BenefitRuleRepository ruleRepository;
    private final UserCardRepository userCardRepository;
    private final BenefitCalculator benefitCalculator;

    @Transactional(readOnly = true)
    public List<CardRecommendationResponse> recommend(Long userId, Long merchantId, int amount) {
        if (amount < 100) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        MerchantRow merchant = ruleRepository.findMerchant(merchantId).stream().findFirst()
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.MERCHANT_NOT_FOUND));

        LocalDateTime now = LocalDateTime.now(SEOUL);
        List<CardRecommendationResponse> result = new ArrayList<>();
        for (UserCardSummaryRow card : userCardRepository.findSummaries(userId)) {
            BenefitResult r = benefitCalculator.calculate(
                    card.getUserCardId(), card.getCardId(), merchant.getMerchantId(), merchant.getCategory(), merchant.getMerchantName(), amount, now);
            result.add(new CardRecommendationResponse(card.getUserCardId(), card.getCardName(), r.benefitName(), r.benefitAmount(),
                    r.promotionName(), r.promotionAmount(), r.totalAmount()));
        }
        // 혜택+프로모션 합계가 큰 순서
        result.sort(Comparator.comparingInt(CardRecommendationResponse::getTotalReward).reversed());
        return result;
    }
}
