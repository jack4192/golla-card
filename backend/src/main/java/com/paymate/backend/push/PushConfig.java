package com.paymate.backend.push;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 웹 푸시 설정. 매일 7시 아침 알림을 위해 @Scheduled 를 켠다 (실제로 보내는 건 PUSH_MORNING_ENABLED=on 일 때만). */
@Configuration
@EnableScheduling
public class PushConfig {

    @Bean
    public WebPushSender webPushSender(@Value("${app.push.vapid-public-key:}") String publicKey,
                                       @Value("${app.push.vapid-private-key:}") String privateKey,
                                       @Value("${app.push.vapid-subject:}") String subject) {
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        return new WebPushSender(publicKey, privateKey, subject, http);
    }
}
