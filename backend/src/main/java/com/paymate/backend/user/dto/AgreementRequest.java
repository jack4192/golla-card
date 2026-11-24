package com.paymate.backend.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 필수 서비스 이용 동의 저장·철회 요청 (2026-11-24). 동의 화면에서 고른 알림 수신 동의도 함께 보낼 수 있다. */
@Getter
@NoArgsConstructor
public class AgreementRequest {

    @NotNull(message = "동의 여부를 보내 주세요.")
    private Boolean agreed;

    /** 알림 수신 동의(선택). 보내지 않으면(null) 그대로 둔다. 필수 동의를 철회하면 함께 false 가 된다. */
    private Boolean notificationAgreed;
}
