package com.paymate.backend.card.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class RegisterCardRequest {

    @NotBlank(message = "카드 상품 코드를 입력해 주세요.")
    private String cardCode;
}
