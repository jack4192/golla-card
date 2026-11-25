package com.paymate.backend.push;

/** 웹 푸시를 받을 기기 하나 (브라우저가 준 구독 정보). p256dh·auth 는 base64url. */
public record PushSubscription(long id, long userId, String endpoint, String p256dh, String auth) {
}
