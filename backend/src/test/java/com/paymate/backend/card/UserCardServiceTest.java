package com.paymate.backend.card;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.card.entity.UserCard;
import com.paymate.backend.card.exception.CardErrorCode;
import com.paymate.backend.card.repository.CardRepository;
import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.card.service.CardBenefitService;
import com.paymate.backend.card.service.UserCardService;
import com.paymate.backend.common.exception.BusinessException;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;

/** 내 카드에서 빼기 (2026-11-24 사용자 결정 '카드 빼기도 같이 만들기'). DB 없이 저장소를 흉내 낸다. */
class UserCardServiceTest {

    private final UserCardRepository userCards = mock(UserCardRepository.class);
    private final UserCardService service =
            new UserCardService(userCards, mock(CardRepository.class), mock(CardBenefitService.class));

    @Test
    @DisplayName("내 카드를 빼면 그 카드를 지우고 바로 DB 에 반영한다")
    void removeMine() {
        UserCard card = new UserCard(7L, 1L, "1234");
        when(userCards.findByIdAndUserId(11L, 7L)).thenReturn(Optional.of(card));

        service.remove(7L, 11L);

        InOrder order = inOrder(userCards);
        order.verify(userCards).delete(card);
        order.verify(userCards).flush();
    }

    @Test
    @DisplayName("남의 카드·없는 카드는 404 이고 아무것도 지우지 않는다")
    void removeOthers() {
        when(userCards.findByIdAndUserId(1L, 7L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.remove(7L, 1L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(CardErrorCode.USER_CARD_NOT_FOUND);
        verify(userCards, never()).delete(any());
    }

    @Test
    @DisplayName("다른 기록이 카드를 붙잡고 있어 지울 수 없으면 409")
    void removeInUse() {
        UserCard card = new UserCard(7L, 1L, "1234");
        when(userCards.findByIdAndUserId(11L, 7L)).thenReturn(Optional.of(card));
        doThrow(new DataIntegrityViolationException("app.demo_payments")).when(userCards).flush();

        assertThatThrownBy(() -> service.remove(7L, 11L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(CardErrorCode.CARD_IN_USE);
    }
}
