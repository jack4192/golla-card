package com.paymate.backend.push;

import com.paymate.backend.common.security.AuthUser;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 바탕화면 웹앱 웹 푸시 (2026-11-25). 공개 키만 로그인 없이, 나머지는 로그인한 사용자 자신의 기기만. */
@RestController
@RequestMapping("/api/push")
@RequiredArgsConstructor
public class PushController {

    private final PushService pushService;

    @GetMapping("/public-key")
    public PushService.PublicKeyResponse publicKey() {
        return pushService.publicKey();
    }

    @PostMapping("/subscriptions")
    public ResponseEntity<Void> subscribe(@AuthenticationPrincipal AuthUser authUser, @RequestBody PushSubscribeRequest request) {
        pushService.subscribe(authUser.getId(), request);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/subscriptions")
    public ResponseEntity<Void> unsubscribe(@AuthenticationPrincipal AuthUser authUser, @RequestBody Map<String, String> body) {
        pushService.unsubscribe(authUser.getId(), body == null ? null : body.get("endpoint"));
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/test")
    public ResponseEntity<Map<String, Integer>> test(@AuthenticationPrincipal AuthUser authUser) {
        return ResponseEntity.accepted().body(Map.of("delaySeconds", pushService.sendTestSoon(authUser.getId())));
    }
}
