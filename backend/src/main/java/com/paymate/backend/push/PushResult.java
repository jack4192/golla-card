package com.paymate.backend.push;

/** 보내기 결과. GONE = 푸시 서비스가 404·410 으로 이 구독은 없다고 답함 (지워야 한다). */
public enum PushResult {
    SENT, GONE, FAILED
}
