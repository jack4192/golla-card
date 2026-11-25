package com.paymate.backend.push;

/** 브라우저 PushSubscription.toJSON() 모양: { endpoint, expirationTime, keys: { p256dh, auth } } (expirationTime 은 안 씀). */
public record PushSubscribeRequest(String endpoint, Keys keys) {

    public record Keys(String p256dh, String auth) {
    }
}
