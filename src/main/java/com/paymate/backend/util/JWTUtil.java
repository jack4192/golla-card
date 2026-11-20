package com.paymate.backend.util;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class JWTUtil {

    public static final String TOKEN_TYPE_ACCESS = "ACCESS";

    private final SecretKey key;
    private final long accessTokenExpireTime;

    public JWTUtil(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-token-expire-time}") long accessTokenExpireTime
    ) {
        this.key = Keys.hmacShaKeyFor(
                secret.getBytes(StandardCharsets.UTF_8)
        );
        this.accessTokenExpireTime = accessTokenExpireTime;
    }

    public String createAccessToken(Long userId, String email, String role) {

        Date now = new Date();
        Date expireDate = new Date(now.getTime() + accessTokenExpireTime);

        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .subject(String.valueOf(userId))
                .claim("email", email)
                .claim("role", role)
                .claim("tokenType", TOKEN_TYPE_ACCESS)
                .issuedAt(now)
                .expiration(expireDate)
                .signWith(key)
                .compact();
    }

    /** 서명/만료가 유효하지 않으면 JwtException 을 던집니다. */
    public Claims getClaims(String token) {
        return Jwts.parser()
                .verifyWith(key)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /** 서명, 만료, 토큰 종류(ACCESS)가 모두 유효할 때만 Claims 를 돌려줍니다. */
    public Optional<Claims> parseAccessToken(String token) {
        try {
            Claims claims = getClaims(token);
            if (!TOKEN_TYPE_ACCESS.equals(claims.get("tokenType", String.class))) {
                return Optional.empty();
            }
            return Optional.of(claims);
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
