package com.paymate.backend.user.dto;

import com.paymate.backend.user.entity.User;
import lombok.AllArgsConstructor;
import lombok.Getter;

@Getter
@AllArgsConstructor
public class UserResponse {

    private final Long id;
    private final String name;
    private final String email;
    private final String phone;
    private final Boolean mydataAgreed;   // null = 아직 동의 화면에 응답 안 함 → 앱이 첫 실행 동의 화면을 띄우는 기준
    private final Boolean notificationAgreed;   // 알림 수신 동의(선택). null = 아직 응답 안 함 → 앱은 기기 값을 쓴다

    public static UserResponse from(User user) {
        return new UserResponse(
                user.getId(),
                user.getName(),
                user.getEmail(),
                user.getPhone(),
                user.getMydataAgreed(),
                user.getNotificationAgreed());
    }
}
