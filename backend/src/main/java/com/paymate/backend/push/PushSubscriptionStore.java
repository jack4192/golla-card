package com.paymate.backend.push;

import java.util.List;

/** 웹 푸시 구독 저장소. endpoint 는 기기마다 고유하다. */
public interface PushSubscriptionStore {

    /** 같은 endpoint 가 있으면 그 기기를 이 사용자 것으로 바꾼다 (같은 아이폰에서 다른 계정으로 켠 경우). */
    void upsert(long userId, String endpoint, String p256dh, String auth);

    /** 내 기기만 지운다. 지운 개수. */
    int delete(long userId, String endpoint);

    /** 푸시 서비스가 없다고 답한(404·410) 구독을 지운다. */
    void deleteEndpoint(String endpoint);

    List<PushSubscription> forUser(long userId);

    /** 아침 알림 대상: 알림 수신 동의(users.notification_agreed = true)를 한 사람의 기기. */
    List<PushSubscription> forMorning();

    void markSent(long id);
}
