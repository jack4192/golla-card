package com.paymate.backend.push;

/** 웹 푸시 보내기. VAPID 키가 없으면 꺼져 있다(enabled=false). */
public interface PushSender {

    boolean enabled();

    /** 앱이 구독할 때 쓰는 VAPID 공개 키(base64url). 꺼져 있으면 null. */
    String publicKey();

    PushResult send(PushSubscription subscription, String payloadJson);
}
