package com.paymate.backend.payment.util;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 결제 코드 원문(18자리)을 HMAC-SHA256 으로 해시합니다. DB에는 이 해시만 저장하고 원문은 저장하지 않습니다.
 * 가상 POS가 입력받은 코드를 확인할 때도 같은 방식으로 해시해서 비교합니다.
 */
@Component
public class PaymentCodeHasher {

    private final byte[] secret;

    public PaymentCodeHasher(
            @Value("${paymate.payment.hmac-secret:demo-hmac-secret-change-me}") String secret) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public String hash(String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(code.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("결제 코드 해시 계산에 실패했습니다.", e);
        }
    }
}
