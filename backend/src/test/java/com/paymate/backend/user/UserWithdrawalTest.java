package com.paymate.backend.user;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.exception.UserErrorCode;
import com.paymate.backend.user.repository.UserRepository;
import com.paymate.backend.user.service.UserService;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.security.crypto.password.PasswordEncoder;

/** 회원 탈퇴 (2026-11-24 사용자 결정: 비밀번호 다시 확인, 데모·가상 계정 1~1005번은 막기, 바로 완전 삭제). */
class UserWithdrawalTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final UserService service = new UserService(users, encoder, 1005L);

    private User user() {
        return new User("점검", LocalDate.of(1995, 5, 5), "010-1234-5678", "a@example.test", "HASH");
    }

    @Test
    @DisplayName("비밀번호가 맞으면 회원을 지우고 바로 DB 에 반영한다 (카드·일정·AI 기록은 DB 가 함께 지운다)")
    void withdraw() {
        User user = user();
        when(users.findById(1006L)).thenReturn(Optional.of(user));
        when(encoder.matches("pw", "HASH")).thenReturn(true);

        service.withdraw(1006L, "pw");

        InOrder order = inOrder(users);
        order.verify(users).delete(user);
        order.verify(users).flush();
    }

    @Test
    @DisplayName("비밀번호가 틀리면 지우지 않는다")
    void wrongPassword() {
        when(users.findById(1006L)).thenReturn(Optional.of(user()));
        when(encoder.matches("bad", "HASH")).thenReturn(false);

        assertThatThrownBy(() -> service.withdraw(1006L, "bad"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.WRONG_PASSWORD);
        verify(users, never()).delete(any());
    }

    @Test
    @DisplayName("데모·가상 계정(1~1005번)은 비밀번호가 맞아도 지우지 않는다")
    void protectedAccount() {
        assertThatThrownBy(() -> service.withdraw(1L, "pw"))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.DEMO_ACCOUNT);
        assertThatThrownBy(() -> service.withdraw(1005L, "pw"))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.DEMO_ACCOUNT);
        verify(users, never()).findById(any());
        verify(users, never()).delete(any());
    }

    @Test
    @DisplayName("없는 회원이면 404")
    void missing() {
        when(users.findById(2000L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.withdraw(2000L, "pw"))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }
}
