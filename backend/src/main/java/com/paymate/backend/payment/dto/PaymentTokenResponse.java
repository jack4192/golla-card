package com.paymate.backend.payment.dto;

import java.time.OffsetDateTime;
import lombok.AllArgsConstructor;
import lombok.Getter;


@Getter
@AllArgsConstructor
public class PaymentTokenResponse {

    private final Long paymentTokenId;        // 상태 조회·취소에 쓰는 번호
    private final String qrPayload;           // QR에 넣을 문자열
    private final String barcodeNumber;       // 바코드로 그리고 화면에 보여줄 18자리 숫자
    private final OffsetDateTime expiresAt;   // 만료 시각 (예: 2026-11-23T07:20:10+09:00)
    private final int expiresInSeconds;       // 발급부터 만료까지 초 (60)
}
