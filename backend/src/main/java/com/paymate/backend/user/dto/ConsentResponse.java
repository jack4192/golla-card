package com.paymate.backend.user.dto;

import com.paymate.backend.user.entity.User;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class ConsentResponse {

    private final Boolean mydataAgreed;          // 마이데이터 이용 동의 (필수)
    private final Boolean notificationAgreed;    // 알림 수신 동의 (선택)

    public static ConsentResponse from(User user) {
        return new ConsentResponse(user.getMydataAgreed(), user.getNotificationAgreed());
    }
}
