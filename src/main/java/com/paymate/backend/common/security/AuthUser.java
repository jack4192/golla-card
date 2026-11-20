package com.paymate.backend.common.security;

import java.util.Date;
import lombok.AllArgsConstructor;
import lombok.Getter;


@Getter
@AllArgsConstructor
public class AuthUser {

    private final Long id;        // users.user_id
    private final String email;
    private final String role;    // "USER" / "ADMIN"
    private final String jti;     // 토큰 고유 ID (로그아웃 처리에 사용)
    private final Date expiresAt; // 토큰 만료 시각
}
