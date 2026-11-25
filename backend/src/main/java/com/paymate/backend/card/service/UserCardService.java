package com.paymate.backend.card.service;

import com.paymate.backend.card.dto.BenefitResponse;
import com.paymate.backend.card.dto.MyCardResponse;
import com.paymate.backend.card.entity.UserCard;
import com.paymate.backend.card.exception.CardErrorCode;
import com.paymate.backend.card.repository.CardRepository;
import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.card.repository.UserCardSummaryRow;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.common.exception.CommonErrorCode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserCardService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    private final UserCardRepository userCardRepository;
    private final CardRepository cardRepository;
    private final CardBenefitService cardBenefitService;

    /* 내 카드 목록 */
    @Transactional(readOnly = true)
    public List<MyCardResponse> getMyCards(Long userId) {
        List<UserCardSummaryRow> rows = userCardRepository.findSummaries(userId);

        List<MyCardResponse> result = new ArrayList<>();
        for (int i = 0; i < rows.size(); i++) {
            result.add(toResponse(rows.get(i), i + 1));   // 쿼리가 표시 순서대로 정렬해 주므로 순번 = order
        }
        return result;
    }

    /* 카드 등록 끝 4자리는 가짜 값 */
    @Transactional
    public Long register(Long userId, String cardCode) {
        Long cardId = parseCardCode(cardCode);

        if (!cardRepository.existsById(cardId)) {
            throw new BusinessException(CardErrorCode.CARD_NOT_FOUND);
        }
        if (userCardRepository.existsByUserIdAndCardId(userId, cardId)) {
            throw new BusinessException(CardErrorCode.ALREADY_REGISTERED_CARD);
        }

        String last4 = String.format("%04d", ThreadLocalRandom.current().nextInt(10000));

        UserCard saved;
        try {
            saved = userCardRepository.saveAndFlush(new UserCard(userId, cardId, last4));
        } catch (DataIntegrityViolationException e) {
            // 이미 등록한 카드가 맞을 때만 409, 아니면 원래 오류를 그대로
            if (userCardRepository.existsByUserIdAndCardId(userId, cardId)) {
                throw new BusinessException(CardErrorCode.ALREADY_REGISTERED_CARD);
            }
            throw e;
        }

        userCardRepository.insertDetail(saved.getId(), userId, LocalDate.now(SEOUL));
        return saved.getId();
    }

    /*
     * 내 카드에서 빼기 (2026-11-24 팀 결정). 남의 카드·없는 카드면 404.
     * 그 카드의 결제·월 실적·결제 코드·순서 기록은 DB 가 함께 지운다 (외래키 ON DELETE CASCADE).
     * 시연 결제(app.demo_payments)처럼 카드를 붙잡는 기록이 있으면 지우지 않고 409.
     */
    @Transactional
    public void remove(Long userId, Long userCardId) {
        UserCard card = userCardRepository.findByIdAndUserId(userCardId, userId)
                .orElseThrow(() -> new BusinessException(CardErrorCode.USER_CARD_NOT_FOUND));
        try {
            userCardRepository.delete(card);
            userCardRepository.flush();   // 외래키 오류를 여기서 받아 409 로 바꾼다
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(CardErrorCode.CARD_IN_USE);
        }
    }

    /* 내 카드의 혜택 상세. 남의 카드 번호면 404 */
    @Transactional(readOnly = true)
    public List<BenefitResponse> getBenefits(Long userId, Long userCardId) {
        UserCard userCard = userCardRepository.findByIdAndUserId(userCardId, userId)
                .orElseThrow(() -> new BusinessException(CardErrorCode.USER_CARD_NOT_FOUND));
        return cardBenefitService.getBenefits(userCard.getCardId());
    }

    private MyCardResponse toResponse(UserCardSummaryRow r, int order) {
        return new MyCardResponse(
                r.getUserCardId(), String.valueOf(r.getCardId()), r.getCardName(), r.getIssuer(),
                r.getCardType(), CardImages.urlOf(r.getCardId(), r.getImageUrl()), order == 1, order, r.getCardLast4());
    }

    private Long parseCardCode(String cardCode) {
        try {
            return Long.valueOf(cardCode.trim());
        } catch (NumberFormatException e) {
            throw new BusinessException(CardErrorCode.CARD_NOT_FOUND);
        }
    }

    private String resolveYearMonth(String yearMonth) {
        if (yearMonth == null || yearMonth.isBlank()) {
            return YearMonth.now(SEOUL).toString();   // "2026-11"
        }
        try {
            return YearMonth.parse(yearMonth.trim()).toString();
        } catch (DateTimeParseException e) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
    }

    // 맨 앞(1번)으로 옮기고 나머지는 한 칸씩 뒤로 내 카드가 아니면 404
    @Transactional
    public void setRepresentative(Long userId, Long userCardId) {
        List<Long> ids = new ArrayList<>(userCardRepository.findOrderedIds(userId));
        if (!ids.remove(userCardId)) {
            throw new BusinessException(CardErrorCode.USER_CARD_NOT_FOUND);
        }
        ids.add(0, userCardId);
        applyOrder(ids);
    }

    // 내 카드 전체를 빠짐없이 아니면 400
    @Transactional
    public void reorder(Long userId, List<Long> userCardIds) {
        List<Long> current = userCardRepository.findOrderedIds(userId);
        boolean sameSize = userCardIds.size() == current.size();
        boolean noDuplicate = new HashSet<>(userCardIds).size() == userCardIds.size();
        boolean allMine = new HashSet<>(current).containsAll(userCardIds);
        if (!sameSize || !noDuplicate || !allMine) {
            throw new BusinessException(CommonErrorCode.INVALID_REQUEST);
        }
        applyOrder(userCardIds);
    }

    private void applyOrder(List<Long> orderedIds) {
        for (int i = 0; i < orderedIds.size(); i++) {
            userCardRepository.updateDisplayOrder(orderedIds.get(i), i + 1);
        }
    }
}
