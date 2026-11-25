package com.paymate.backend.user.service;

import com.paymate.backend.auth.dto.SignupRequest;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.user.dto.UserResponse;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.exception.UserErrorCode;
import com.paymate.backend.user.repository.UserRepository;
import java.util.Locale;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final long protectedMaxUserId;   // 이 번호까지는 데모·가상 계정이라 탈퇴로 지우지 않는다 (가상 데이터 1~1005번)

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder,
                       @Value("${app.withdrawal.protected-max-user-id:1005}") long protectedMaxUserId) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.protectedMaxUserId = protectedMaxUserId;
    }

    /**
     * 회원 탈퇴 (2026-11-24 팀 결정): 비밀번호를 다시 확인하고 바로 완전히 지운다.
     * 카드·카드 상세·결제·월 실적·일정·AI 기록(app 스키마)은 외래키 ON DELETE CASCADE 로 DB 가 함께 지운다.
     * 데모·가상 계정(1~protectedMaxUserId번)은 시연 데이터가 사라지지 않게 지우지 않는다.
     */
    @Transactional
    public void withdraw(Long userId, String password) {
        if (userId == null || userId <= protectedMaxUserId) {
            throw new BusinessException(UserErrorCode.DEMO_ACCOUNT);
        }
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(UserErrorCode.USER_NOT_FOUND));
        if (password == null || !passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new BusinessException(UserErrorCode.WRONG_PASSWORD);
        }
        try {
            userRepository.delete(user);
            userRepository.flush();   // 외래키 오류를 여기서 받아 409 로 바꾼다
        } catch (DataIntegrityViolationException e) {
            throw new BusinessException(UserErrorCode.WITHDRAWAL_FAILED);
        }
    }

    @Transactional(readOnly = true)
    public boolean isEmailAvailable(String email) {
        return !userRepository.existsByEmailIgnoreCase(normalizeEmail(email));
    }

    /** 이메일은 앞뒤 공백을 빼고 소문자로 통일한다 (2026-11-24 점검 문제 5). */
    public static String normalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional(readOnly = true)
    public boolean isPhoneAvailable(String phone) {
        return !userRepository.existsByPhone(normalizePhone(phone));
    }

    @Transactional
    public void signup(SignupRequest req) {
        String email = normalizeEmail(req.getEmail());   // 공백 제거·소문자 통일 (2026-11-24)
        String phone = normalizePhone(req.getPhone());   // 010-1234-5678 형태로 통일

        if (!PasswordPolicy.isValid(req.getPassword())) {
            throw new BusinessException(UserErrorCode.INVALID_PASSWORD);
        }
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new BusinessException(UserErrorCode.DUPLICATE_EMAIL);
        }
        if (userRepository.existsByPhone(phone)) {
            throw new BusinessException(UserErrorCode.DUPLICATE_PHONE);
        }

        User user = new User(
                req.getName().trim(),
                req.getBirthDate(),
                phone,
                email,
                passwordEncoder.encode(req.getPassword())   // 평문 대신 BCrypt 해시 저장
        );
        user.changeWorkplaceName(req.getWorkplaceName());   // 가입 화면의 직장 (2026-11-24)
        userRepository.save(user);
    }

    /**
     * 필수 서비스 이용 동의 저장·철회 (2026-11-24). 다른 기기에서 로그인해도 다시 묻지 않게 서버에 둔다.
     * notificationAgreed 가 있으면 알림 수신 동의도 함께 저장하고, 필수 동의를 철회하면 알림 수신 동의도 false 로 둔다.
     */
    @Transactional
    public void saveAgreement(Long userId, boolean agreed, Boolean notificationAgreed) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(UserErrorCode.USER_NOT_FOUND));
        user.agreeMydata(agreed);
        if (!agreed) {
            user.changeNotificationAgreed(false);
        } else if (notificationAgreed != null) {
            user.changeNotificationAgreed(notificationAgreed);
        }
    }

    /** 알림 수신 동의만 바꾼다 (설정 > 폰 알림 받기, 2026-11-24). */
    @Transactional
    public void saveNotificationAgreement(Long userId, boolean agreed) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(UserErrorCode.USER_NOT_FOUND));
        user.changeNotificationAgreed(agreed);
    }

    @Transactional(readOnly = true)
    public UserResponse getMe(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new BusinessException(UserErrorCode.USER_NOT_FOUND));
        return UserResponse.from(user);
    }

    private String normalizePhone(String raw) {
        String digits = raw.replaceAll("\\D", "");
        if (digits.length() == 11) {
            return digits.substring(0, 3) + "-" + digits.substring(3, 7) + "-" + digits.substring(7);
        }
        if (digits.length() == 10) {
            return digits.substring(0, 3) + "-" + digits.substring(3, 6) + "-" + digits.substring(6);
        }
        return digits;   // 형식이 맞지 않는 값은 그대로 (중복확인 API에서 오류가 나지 않도록)
    }
}