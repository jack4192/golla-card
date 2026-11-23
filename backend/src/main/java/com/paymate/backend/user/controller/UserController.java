package com.paymate.backend.user.controller;

import com.paymate.backend.common.security.AuthUser;
import com.paymate.backend.user.dto.EmailAvailabilityResponse;
import com.paymate.backend.user.dto.PhoneAvailabilityResponse;
import com.paymate.backend.user.dto.UserResponse;
import com.paymate.backend.user.service.UserService;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
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