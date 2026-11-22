package com.paymate.backend.card.service;

import com.paymate.backend.card.dto.CardProductDetailResponse;
import com.paymate.backend.card.dto.CardProductSummaryResponse;
import com.paymate.backend.card.dto.PerkResponse;
import com.paymate.backend.card.entity.Card;
import com.paymate.backend.card.exception.CardErrorCode;
import com.paymate.backend.card.repository.CardProductRow;
import com.paymate.backend.card.repository.CardRepository;
import com.paymate.backend.card.repository.CardTagRow;
import com.paymate.backend.common.exception.BusinessException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CardProductService {

    private static final int MAX_TAGS = 3;

    private final CardRepository cardRepository;
    private final CardBenefitService cardBenefitService;

    @Transactional(readOnly = true)
    public List<CardProductSummaryResponse> search(String keyword) {
        String kw = keyword == null ? "" : keyword.trim();

        List<CardProductRow> rows = cardRepository.searchProducts(kw);
        if (rows.isEmpty()) {
            return List.of();
        }

        Map<Long, List<String>> tagsByCard = loadTags(rows.stream().map(CardProductRow::getCardId).toList());

        return rows.stream()
                .map(r -> new CardProductSummaryResponse(
                        String.valueOf(r.getCardId()), r.getCardName(), r.getIssuer(), r.getCardType(),
                        r.getAnnualFeeDomestic(), tagsByCard.getOrDefault(r.getCardId(), List.of()),
                        r.getImageUrl(), r.getAnnualFeeOverseas(), r.getDescription()))
                .toList();
    }

    @Transactional(readOnly = true)
    public CardProductDetailResponse getDetail(String cardCode) {
        Card card = cardRepository.findById(parseCardCode(cardCode))
                .orElseThrow(() -> new BusinessException(CardErrorCode.CARD_NOT_FOUND));

        List<PerkResponse> perks = cardRepository.findPerks(card.getId()).stream()
                .map(p -> new PerkResponse(p.getPerkName(), p.getDescription()))
                .toList();

        return new CardProductDetailResponse(
                String.valueOf(card.getId()), card.getCardName(), card.getIssuer(),
                card.getAnnualFeeDomestic(), cardBenefitService.getBenefits(card.getId()),
                null,   // officialUrl: cards 테이블에 컬럼이 없어 아직 제공하지 않음
                card.getCardType(), card.getAnnualFeeOverseas(), card.getDescription(),
                card.getImageUrl(), perks);
    }

    private Map<Long, List<String>> loadTags(List<Long> cardIds) {
        Map<Long, List<String>> tags = new HashMap<>();
        for (CardTagRow row : cardRepository.findTags(cardIds)) {
            List<String> list = tags.computeIfAbsent(row.getCardId(), k -> new ArrayList<>());
            if (list.size() < MAX_TAGS) {
                list.add(row.getCategoryName());
            }
        }
        return tags;
    }

    private Long parseCardCode(String cardCode) {
        try {
            return Long.valueOf(cardCode.trim());
        } catch (NumberFormatException e) {
            throw new BusinessException(CardErrorCode.CARD_NOT_FOUND);
        }
    }
}
