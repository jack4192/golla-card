package com.paymate.backend.user.dto;

import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class UpdateConsentRequest {

    private Boolean mydataAgreed;          // true 만 허용 (필수 동의라 철회 불가)
    private Boolean notificationAgreed;    // true / false
}
