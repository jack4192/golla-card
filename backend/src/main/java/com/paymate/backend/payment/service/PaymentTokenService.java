package com.paymate.backend.payment.service;

import com.paymate.backend.card.exception.CardErrorCode;
import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.payment.dto.PaymentTokenResponse;
import com.paymate.backend.payment.dto.PaymentTokenStatusResponse;
import com.paymate.backend.payment.entity.PaymentCode;
import com.paymate.backend.payment.exception.PaymentErrorCode;
import com.paymate.backend.payment.repository.PaymentCodeRepository;
import com.paymate.backend.payment.util.PaymentCodeHasher;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PaymentTokenService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int CODE_LENGTH = 18;
    private static final int VALID_SECONDS = 60;
    private static final String QR_PREFIX = "PAYMATE:";

    private final SecureRandom random = new SecureRandom();

    private final UserCardRepository userCardRepository;
    private final PaymentCodeRepository paymentCodeRepository;
    private final PaymentCodeHasher hasher;

    @Transactional
    public PaymentTokenResponse issue(Long userId, Long userCardId) {
        userCardRepository.findByIdAndUserId(userCardId, userId)
                .orElseThrow(() -> new BusinessException(CardErrorCode.USER_CARD_NOT_FOUND));

        LocalDateTime now = LocalDateTime.now(SEOUL);
        paymentCodeRepository.voidIssued(userId, now);

        String code = generateCode();
        PaymentCode saved = paymentCodeRepository.save(
                new PaymentCode(userCardId, hasher.hash(code), now.plusSeconds(VALID_SECONDS)));

        return new PaymentTokenResponse(
                saved.getId(), QR_PREFIX + code, code,
                ZonedDateTime.of(saved.getExpiresAt(), SEOUL).toOffsetDateTime(), VALID_SECONDS);
    }


    @Transactional(readOnly = true)
    public PaymentTokenStatusResponse getStatus(Long userId, Long paymentTokenId) {
        PaymentCode code = findMine(userId, paymentTokenId);
        return new PaymentTokenStatusResponse(resolveStatus(code, LocalDateTime.now(SEOUL)), code.getPaymentId());
    }


    @Transactional
    public void cancel(Long userId, Long paymentTokenId) {
        PaymentCode code = findMine(userId, paymentTokenId);
        if (PaymentCode.USED.equals(code.getStatus())) {
            throw new BusinessException(PaymentErrorCode.PAYMENT_TOKEN_ALREADY_USED);
        }
        if (PaymentCode.ISSUED.equals(code.getStatus()) && code.getExpiresAt().isAfter(LocalDateTime.now(SEOUL))) {
            code.cancel();   // 변경 감지로 트랜잭션이 끝날 때 UPDATE
        }
    }

    private PaymentCode findMine(Long userId, Long paymentTokenId) {
        return paymentCodeRepository.findMine(paymentTokenId, userId)
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.PAYMENT_TOKEN_NOT_FOUND));
    }

    private String resolveStatus(PaymentCode code, LocalDateTime now) {
        return switch (code.getStatus()) {
            case PaymentCode.USED -> "COMPLETED";
            case PaymentCode.VOID -> "CANCELED";
            default -> code.getExpiresAt().isAfter(now) ? "ISSUED" : "EXPIRED";
        };
    }

    private String generateCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(random.nextInt(10));
        }
        return sb.toString();
    }
}
