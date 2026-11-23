package com.paymate.backend.config;

import com.paymate.backend.auth.filter.JwtAuthenticationFilter;
import com.paymate.backend.auth.service.TokenBlacklist;
import com.paymate.backend.common.exception.CommonErrorCode;
import com.paymate.backend.common.exception.ErrorCode;
import com.paymate.backend.util.JWTUtil;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

@Configuration
@RequiredArgsConstructor
public class SecurityConfig {

    private final JWTUtil jwtUtil;
    private final TokenBlacklist tokenBlacklist;

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    /**
     * 웹 프론트(Expo 웹, Vercel)에서 API를 호출할 수 있도록 허용할 주소.
     * 환경변수 CORS_ALLOWED_ORIGINS(쉼표 구분)로 바꿀 수 있고, 기본값은 로컬 개발 주소입니다.
     * (휴대폰 앱은 브라우저가 아니라서 CORS 영향을 받지 않습니다.)
     */
    @Bean
    public CorsConfigurationSource corsConfigurationSource(
            @Value("${cors.allowed-origins:http://localhost:8081,http://localhost:19006}") String allowedOrigins) {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(Arrays.stream(allowedOrigins.split(","))
                .map(String::trim).filter(origin -> !origin.isEmpty()).toList());
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type"));
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .cors(Customizer.withDefaults())
                .csrf(csrf -> csrf.disable())
                .formLogin(login -> login.disable())
                .httpBasic(basic -> basic.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // 로그인 없이 호출할 수 있는 API
                        .requestMatchers("/api/auth/signup", "/api/auth/login").permitAll()
                        .requestMatchers(HttpMethod.GET,
                                "/api/users/email-availability",
                                "/api/users/phone-availability").permitAll()
                        .requestMatchers("/error").permitAll()
                        // 카드 상품 이미지 (공개된 상품 이미지라 로그인 없이 받는다. 앱의 <Image> 는 토큰을 보낼 수 없다)
                        .requestMatchers(HttpMethod.GET, "/card-images/**").permitAll()
                        // 그 외 모든 API는 로그인(토큰) 필요 → 새 기능은 아무 설정 없이 자동으로 보호됨
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e
                        // 토큰이 없거나 유효하지 않음 → 401
                        .authenticationEntryPoint((req, res, ex) -> writeError(res, CommonErrorCode.UNAUTHORIZED))
                        // 로그인은 했지만 권한 부족 → 403
                        .accessDeniedHandler((req, res, ex) -> writeError(res, CommonErrorCode.FORBIDDEN)))
                .addFilterBefore(new JwtAuthenticationFilter(jwtUtil, tokenBlacklist),
                        UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    private static void writeError(HttpServletResponse res, ErrorCode errorCode) throws IOException {
        res.setStatus(errorCode.getStatus().value());
        res.setContentType(MediaType.APPLICATION_JSON_VALUE);
        res.setCharacterEncoding(StandardCharsets.UTF_8.name());
        res.getWriter().write("{\"code\":\"" + errorCode.getCode()
                + "\",\"message\":\"" + errorCode.getMessage() + "\"}");
    }
}
