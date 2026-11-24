package com.paymate.backend.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.auth.dto.LoginRequest;
import com.paymate.backend.auth.dto.SignupRequest;
import com.paymate.backend.auth.service.AuthService;
import com.paymate.backend.auth.service.TokenBlacklist;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.exception.UserErrorCode;
import com.paymate.backend.user.repository.UserRepository;
import com.paymate.backend.user.service.UserService;
import com.paymate.backend.util.JWTUtil;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.lang.reflect.Field;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

/** 가입 검사·이메일 소문자 통일 (2026-11-24 점검 문제 5). */
class SignupPolicyTest {

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordEncoder encoder = mock(PasswordEncoder.class);
    private final UserService service = new UserService(users, encoder, 1005L);
    private final Validator validator = Validation.buildDefaultValidatorFactory().getValidator();

    private static SignupRequest signup(String name, String email, String password) throws Exception {
        SignupRequest req = new SignupRequest();
        set(req, "name", name);
        set(req, "birthDate", LocalDate.of(1995, 5, 5));
        set(req, "phone", "010-1234-5678");
        set(req, "email", email);
        set(req, "password", password);
        return req;
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    @Test
    @DisplayName("비밀번호는 앱과 같은 규칙(영문·숫자·특수문자 포함 8자 이상)이고 72바이트를 넘으면 안 된다")
    void passwordPolicy() throws Exception {
        for (String weak : new String[] {"1", "abcdefgh", "abcd1234", "Ab1!", "12345678!", "가나다라마바사1!"}) {
            assertThatThrownBy(() -> service.signup(signup("점검", "a@example.test", weak)))
                    .as(weak)
                    .extracting(e -> ((BusinessException) e).getErrorCode())
                    .isEqualTo(UserErrorCode.INVALID_PASSWORD);
        }
        String tooLong = "가".repeat(25) + "a1!";   // 75 + 3 = 78바이트 (BCrypt 는 72바이트까지)
        assertThatThrownBy(() -> service.signup(signup("점검", "a@example.test", tooLong)))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.INVALID_PASSWORD);
        verify(users, never()).save(any());
    }

    @Test
    @DisplayName("이메일은 소문자로 저장하고, 대소문자만 다른 이메일도 중복으로 본다")
    void emailLowercase() throws Exception {
        when(encoder.encode("Abcd1234!")).thenReturn("HASH");
        service.signup(signup("점검", "  A.B@Example.TEST ", "Abcd1234!"));
        ArgumentCaptor<User> saved = ArgumentCaptor.forClass(User.class);
        verify(users).save(saved.capture());
        assertThat(saved.getValue().getEmail()).isEqualTo("a.b@example.test");

        when(users.existsByEmailIgnoreCase("dup@example.test")).thenReturn(true);
        assertThatThrownBy(() -> service.signup(signup("점검", "DUP@example.test", "Abcd1234!")))
                .extracting(e -> ((BusinessException) e).getErrorCode())
                .isEqualTo(UserErrorCode.DUPLICATE_EMAIL);
        assertThat(service.isEmailAvailable("Dup@Example.test")).isFalse();
    }

    @Test
    @DisplayName("이름 50자·이메일 100자를 넘으면 요청 검사에서 막는다 (DB 칸 길이, 500 대신 400)")
    void lengthLimits() throws Exception {
        assertThat(validator.validate(signup("가".repeat(51), "a@example.test", "Abcd1234!"))).isNotEmpty();
        assertThat(validator.validate(signup("가".repeat(50), "a@example.test", "Abcd1234!"))).isEmpty();
        String longEmail = "a".repeat(90) + "@example.test";   // 103자
        assertThat(validator.validate(signup("점검", longEmail, "Abcd1234!"))).isNotEmpty();
    }

    @Test
    @DisplayName("로그인은 이메일을 소문자로 찾고, 예전에 대문자로 저장된 계정도 찾는다")
    void loginLowercase() throws Exception {
        JWTUtil jwt = new JWTUtil("0123456789abcdef0123456789abcdef", 3600000L);
        AuthService auth = new AuthService(users, encoder, jwt, new TokenBlacklist());
        User user = new User("점검", LocalDate.of(1995, 5, 5), "010-1234-5678", "Old@Example.test", "HASH");
        when(users.findByEmail("old@example.test")).thenReturn(Optional.empty());
        when(users.findFirstByEmailIgnoreCaseOrderByIdAsc("old@example.test")).thenReturn(Optional.of(user));
        when(encoder.matches("Abcd1234!", "HASH")).thenReturn(true);

        LoginRequest req = new LoginRequest();
        set(req, "email", " OLD@example.TEST ");
        set(req, "password", "Abcd1234!");
        assertThat(auth.login(req).getAccessToken()).isNotBlank();
    }
}
