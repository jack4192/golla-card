package com.paymate.backend.payment.service;

import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.card.repository.UserCardSummaryRow;
import com.paymate.backend.common.DemoClock;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.common.exception.CommonErrorCode;
import com.paymate.backend.payment.benefit.BenefitCalculator;
import com.paymate.backend.payment.benefit.BenefitResult;
import com.paymate.backend.payment.dto.CardRecommendationResponse;
import com.paymate.backend.payment.exception.PaymentErrorCode;
import com.paymate.backend.payment.repository.BenefitRuleRepository;
import com.paymate.backend.payment.repository.MerchantRow;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;


/** 가맹점·금액을 주면 내 카드마다 받을 혜택을 계산해 큰 순서로. 시각은 결제와 같은 서버의 '지금'(DemoClock). */
@Service
public class RecommendationService {

    private final BenefitRuleRepository ruleRepository;
    private final UserCardRepository userCardRepository;
    private final BenefitCalculator benefitCalculator;
    private final DemoClock clock;

    public RecommendationService(BenefitRuleRepository ruleRepository, UserCardRepository userCardRepository,
                                 BenefitCalculator benefitCalculator, @Value("${ai.fixed-at:}") String fixedAt) {
        this.ruleRepository = ruleRepository;
        this.userCardRepository = userCardRepository;
        this.benefitCalculator = benefitCalculator;
        this.clock = DemoClock.of(fixedAt);
    }

    @Transactional(readOnly = true)
    public List<CardRecommendationResponse> recommend(Long userId, Long merchantId, int amount) {
        if (amount < 100) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        MerchantRow merchant = ruleRepository.findMerchant(merchantId).stream().findFirst()
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.MERCHANT_NOT_FOUND));

        LocalDateTime now = clock.now();
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
