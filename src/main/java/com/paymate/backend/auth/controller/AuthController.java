package com.paymate.backend.auth.controller;

import com.paymate.backend.auth.dto.LoginRequest;
import com.paymate.backend.auth.dto.SignupRequest;
import com.paymate.backend.auth.dto.TokenResponse;
import com.paymate.backend.auth.service.AuthService;
import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.user.service.UserService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final UserService userService;
    private final AuthService authService;

    @PostMapping("/signup")
    public ResponseEntity<Void> signup(@Valid @RequestBody SignupRequest req) {
        userService.signup(req);
        return ResponseEntity.status(HttpStatus.CREATED).build();   // 201
    }

    @PostMapping("/login")
    public ResponseEntity<TokenResponse> login(@Valid @RequestBody LoginRequest req) {
        return ResponseEntity.ok(authService.login(req));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AuthUser authUser) {
        authService.logout(authUser);
        return ResponseEntity.noContent().build();   // 204
    }
}
