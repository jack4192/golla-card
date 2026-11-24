package com.paymate.backend.user.controller;

import com.paymate.backend.auth.service.AuthService;
import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.user.dto.EmailAvailabilityResponse;
import com.paymate.backend.user.dto.PhoneAvailabilityResponse;
import com.paymate.backend.user.dto.UserResponse;
import com.paymate.backend.user.dto.WithdrawalRequest;
import com.paymate.backend.user.service.UserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;
    private final AuthService authService;

    public UserController(UserService userService, AuthService authService) {
        this.userService = userService;
        this.authService = authService;
    }

    /**
     * 회원 탈퇴 (2026-11-24): 비밀번호를 다시 확인하고 계정과 연결된 기록을 서버에서 모두 지운다.
     * 지금 쓰던 토큰도 바로 막는다. 데모·가상 계정은 403, 비밀번호가 틀리면 400.
     */
    @PostMapping("/me/withdrawal")
    public ResponseEntity<Void> withdraw(@AuthenticationPrincipal AuthUser authUser,
                                         @Valid @RequestBody WithdrawalRequest req) {
        userService.withdraw(authUser.getId(), req.getPassword());
        authService.logout(authUser);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/email-availability")
    public ResponseEntity<EmailAvailabilityResponse> checkEmail(
            @RequestParam("email") @NotBlank @Email String email
    ) {
        return ResponseEntity.ok(new EmailAvailabilityResponse(userService.isEmailAvailable(email)));
    }

    @GetMapping("/phone-availability")
    public ResponseEntity<PhoneAvailabilityResponse> checkPhone(
            @RequestParam("phone") @NotBlank
            @Pattern(regexp = "^01[0-9]-?\\d{3,4}-?\\d{4}$") String phone
    ) {
        return ResponseEntity.ok(new PhoneAvailabilityResponse(userService.isPhoneAvailable(phone)));
    }

    // 백엔드 테스트용
    @GetMapping("/me")
    public ResponseEntity<UserResponse> me(@AuthenticationPrincipal AuthUser authUser) {
        return ResponseEntity.ok(userService.getMe(authUser.getId()));
    }
}