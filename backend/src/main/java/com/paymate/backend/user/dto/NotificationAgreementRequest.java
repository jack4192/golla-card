package com.paymate.backend.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 알림 수신 동의만 바꾸는 요청 (설정 > 폰 알림 받기, 2026-11-24). */
@Getter
@NoArgsConstructor
public class NotificationAgreementRequest {

    @NotNull(message = "알림 수신 동의 여부를 보내 주세요.")
    private Boolean agreed;
}
