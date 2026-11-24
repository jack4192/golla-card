package com.paymate.backend.user.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 회원 탈퇴 요청: 본인 확인용 비밀번호 (2026-11-24). */
@Getter
@NoArgsConstructor
public class WithdrawalRequest {

    @NotBlank(message = "비밀번호를 입력해 주세요.")
    private String password;
}
