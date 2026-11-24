package com.paymate.backend.auth.service;

import com.paymate.backend.auth.dto.LoginRequest;
import com.paymate.backend.auth.dto.TokenResponse;
import com.paymate.backend.auth.exception.AuthErrorCode;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.user.entity.User;
import com.paymate.backend.user.repository.UserRepository;
import com.paymate.backend.user.service.UserService;
import com.paymate.backend.util.JWTUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JWTUtil jwtUtil;
    private final TokenBlacklist tokenBlacklist;

    @Transactional(readOnly = true)
    public TokenResponse login(LoginRequest req) {
        // 소문자로 찾고, 예전에 대문자로 저장된 계정도 찾는다 (2026-11-24)
        String email = UserService.normalizeEmail(req.getEmail());
        User user = userRepository.findByEmail(email)
                .or(() -> userRepository.findFirstByEmailIgnoreCaseOrderByIdAsc(email))
                .orElseThrow(() -> new BusinessException(AuthErrorCode.INVALID_CREDENTIALS));

        if (!passwordEncoder.matches(req.getPassword(), user.getPasswordHash())) {
            throw new BusinessException(AuthErrorCode.INVALID_CREDENTIALS);
        }

        String accessToken = jwtUtil.createAccessToken(user.getId(), user.getEmail(), user.getRole().name());
        return new TokenResponse(accessToken, "Bearer");
    }

    public void logout(AuthUser authUser) {
        tokenBlacklist.revoke(authUser.getJti(), authUser.getExpiresAt());
    }
}
