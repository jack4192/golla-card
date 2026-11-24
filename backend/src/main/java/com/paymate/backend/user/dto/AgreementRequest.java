package com.paymate.backend.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 필수 서비스 이용 동의 저장·철회 요청 (2026-11-24). */
@Getter
@NoArgsConstructor
public class AgreementRequest {

    @NotNull(message = "동의 여부를 보내 주세요.")
    private Boolean agreed;
}
