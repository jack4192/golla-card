package com.paymate.backend.user.service;

import com.paymate.backend.auth.dto.SignupRequest;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.user.dto.UserResponse;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.exception.UserErrorCode;
import com.paymate.backend.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Transactional(readOnly = true)
    public boolean isEmailAvailable(String email) {
        return !userRepository.existsByEmail(email.trim());
    }

    @Transactional(readOnly = true)
    public boolean isPhoneAvailable(String phone) {
        return !userRepository.existsByPhone(normalizePhone(phone));
    }

    @Transactional
    public void signup(SignupRequest req) {
        String email = req.getEmail().trim();            // 공백만 제거 (대소문자는 구분)
        String phone = normalizePhone(req.getPhone());   // 010-1234-5678 형태로 통일

        if (userRepository.existsByEmail(email)) {
            throw new BusinessException(UserErrorCode.DUPLICATE_EMAIL);
        }
        if (userRepository.existsByPhone(phone)) {
            throw new BusinessException(UserErrorCode.DUPLICATE_PHONE);
        }

        userRepository.save(new User(
                req.getName().trim(),
                req.getBirthDate(),
                phone,
                email,
                passwordEncoder.encode(req.getPassword())   // 평문 대신 BCrypt 해시 저장
        ));
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