package com.paymate.backend.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.auth.dto.SignupRequest;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.exception.UserErrorCode;
import com.paymate.backend.user.repository.UserRepository;
import com.paymate.backend.user.service.UserService;
import java.lang.reflect.Field;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

/** 직장·필수 동의 서버 저장 (2026-11-24 사용자 결정: users.workplace_name, users.mydata_agreed 기존 칸 사용). */
class UserConsentWorkplaceTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final UserService service = new UserService(users, encoder, 1005L);

    private static SignupRequest signup(String workplaceName) throws Exception {
        SignupRequest req = new SignupRequest();
        set(req, "name", "점검");
        set(req, "birthDate", LocalDate.of(1995, 5, 5));
        set(req, "phone", "010-1234-5678");
        set(req, "email", "a@example.test");
        set(req, "password", "Abcd1234!");
        set(req, "workplaceName", workplaceName);
        return req;
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private User savedUser() {
        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(users).save(saved.capture());
        return saved.getValue();
    }

    @Test
    @DisplayName("가입할 때 고른 직장을 users.workplace_name 에 앞뒤 공백 없이 저장한다")
    void signupStoresWorkplace() throws Exception {
        when(encoder.encode("Abcd1234!")).thenReturn("HASH");
        service.signup(signup("  회사원 "));
        assertThat(savedUser().getWorkplaceName()).isEqualTo("회사원");
    }

    @Test
    @DisplayName("직장을 안 보내거나 빈 칸이면 null")
    void signupWithoutWorkplace() throws Exception {
        when(encoder.encode("Abcd1234!")).thenReturn("HASH");
        service.signup(signup("   "));
        assertThat(savedUser().getWorkplaceName()).isNull();
    }

    @Test
    @DisplayName("필수 서비스 이용 동의를 users.mydata_agreed 에 저장하고, 철회하면 false")
    void saveAgreement() {
        User user = new User("점검", LocalDate.of(1995, 5, 5), "010-1234-5678", "a@example.test", "HASH");
        when(users.findById(1006L)).thenReturn(Optional.of(user));

        service.saveAgreement(1006L, true);
        assertThat(user.getMydataAgreed()).isTrue();

        service.saveAgreement(1006L, false);
        assertThat(user.getMydataAgreed()).isFalse();
    }

    @Test
    @DisplayName("없는 회원의 동의 저장은 404")
    void saveAgreementMissing() {
        when(users.findById(2000L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.saveAgreement(2000L, true))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }
}
