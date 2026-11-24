package com.paymate.backend.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Past;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class SignupRequest {

    @NotBlank(message = "이름을 입력해 주세요.")
    @Size(max = 50, message = "이름은 50자 이내로 입력해 주세요.")
    private String name;

    @NotNull(message = "생년월일을 입력해 주세요.")
    @Past(message = "생년월일이 올바르지 않습니다.")
    private LocalDate birthDate;

    @NotBlank(message = "휴대폰 번호를 입력해 주세요.")
    @Pattern(regexp = "^01[0-9]-?\\d{3,4}-?\\d{4}$", message = "휴대폰 번호 형식이 올바르지 않습니다.")
    private String phone;

    @NotBlank(message = "이메일을 입력해 주세요.")
    @Email(message = "이메일 형식이 올바르지 않습니다.")
    @Size(max = 100, message = "이메일은 100자 이내로 입력해 주세요.")
    private String email;

    @NotBlank(message = "비밀번호를 입력해 주세요.")
    private String password;

    // 가입 화면에서 고른 직장 (예: 회사원, 직접입력 글자). 선택 항목, users.workplace_name (2026-11-24)
    @Size(max = 100, message = "직장은 100자 이내로 입력해 주세요.")
    private String workplaceName;
}
