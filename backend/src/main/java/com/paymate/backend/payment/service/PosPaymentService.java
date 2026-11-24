package com.paymate.backend.payment.service;

import com.paymate.backend.card.entity.Card;
import com.paymate.backend.card.entity.UserCard;
import com.paymate.backend.card.repository.CardRepository;
import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.common.DemoClock;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.payment.benefit.AmountPolicy;
import com.paymate.backend.payment.benefit.BenefitCalculator;
import com.paymate.backend.payment.benefit.BenefitResult;
import com.paymate.backend.payment.dto.PosPaymentRequest;
import com.paymate.backend.payment.dto.PosPaymentResponse;
import com.paymate.backend.payment.entity.Payment;
import com.paymate.backend.payment.entity.PaymentCode;
import com.paymate.backend.payment.exception.PaymentErrorCode;
import com.paymate.backend.payment.repository.PaymentCodeRepository;
import com.paymate.backend.payment.repository.PaymentWriteRepository;
import com.paymate.backend.payment.repository.PosRepository;
import com.paymate.backend.payment.repository.TerminalRow;
import com.paymate.backend.payment.util.HashUtil;
import com.paymate.backend.payment.util.PaymentCodeHasher;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 가상 POS 결제: 결제 코드를 확인하고, 금액을 정하고, 혜택을 계산해서 결제를 저장합니다.
 *
 * <p>시각은 두 가지를 씁니다 (2026-11-24).
 * <ul>
 *   <li>결제 시각·혜택 계산: 서버의 '지금'({@link DemoClock}, 시연용 AI_FIXED_AT 이 있으면 그 시각).
 *       결제 내역·AI 와 같은 날을 봐야 방금 한 결제가 내역에 보이고 실적도 같은 달로 쌓인다.</li>
 *   <li>결제 코드 만료(60초): 실제 시각. 코드를 발급할 때도 실제 시각으로 만료를 정한다.</li>
 * </ul>
 */
@Service
public class PosPaymentService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String SHINHAN = "신한";

    private final PosRepository posRepository;
    private final PaymentCodeRepository paymentCodeRepository;
    private final PaymentWriteRepository paymentRepository;
    private final UserCardRepository userCardRepository;
    private final CardRepository cardRepository;
    private final BenefitCalculator benefitCalculator;
    private final AmountPolicy amountPolicy;
    private final PaymentCodeHasher hasher;
    private final DemoClock clock;

    public PosPaymentService(PosRepository posRepository, PaymentCodeRepository paymentCodeRepository,
                             PaymentWriteRepository paymentRepository, UserCardRepository userCardRepository,
                             CardRepository cardRepository, BenefitCalculator benefitCalculator,
                             AmountPolicy amountPolicy, PaymentCodeHasher hasher,
                             @Value("${ai.fixed-at:}") String fixedAt) {
        this.posRepository = posRepository;
        this.paymentCodeRepository = paymentCodeRepository;
        this.paymentRepository = paymentRepository;
        this.userCardRepository = userCardRepository;
        this.cardRepository = cardRepository;
        this.benefitCalculator = benefitCalculator;
        this.amountPolicy = amountPolicy;
        this.hasher = hasher;
        this.clock = DemoClock.of(fixedAt);
    }

    @Transactional
    public PosPaymentResponse pay(PosPaymentRequest req) {
        TerminalRow terminal = posRepository.findTerminal(HashUtil.sha256Hex(req.getTerminalKey().trim()))
                .stream().findFirst()
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.INVALID_TERMINAL));

        LocalDateTime now = clock.now();   // 결제 시각 (시연용 기준 시각이 있으면 그 시각)
        int amount = req.getAmount() != null ? req.getAmount() : amountPolicy.randomAmount(terminal.getCategory());

        String code = normalizeCode(req.getCode());
        String codeHash = hasher.hash(code);

        if (!code.matches("\\d{18}")) {
            return decline(terminal, codeHash, amount, now, "INVALID_FORMAT");
        }
        return process(terminal, codeHash, amount, now);
    }


    @Transactional
    public PosPaymentResponse payFromApp(Long userId, Long paymentTokenId, Long merchantId, Integer requestedAmount) {
        PaymentCode mine = paymentCodeRepository.findMine(paymentTokenId, userId)
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.PAYMENT_TOKEN_NOT_FOUND));
        TerminalRow terminal = (merchantId != null
                ? posRepository.findTerminalByMerchant(merchantId)
                : posRepository.findRandomTerminal())
                .stream().findFirst()
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.MERCHANT_NOT_FOUND));

        LocalDateTime now = clock.now();   // 결제 시각 (시연용 기준 시각이 있으면 그 시각)
        int amount = requestedAmount != null ? requestedAmount : amountPolicy.randomAmount(terminal.getCategory());
        return process(terminal, mine.getCodeHash(), amount, now);
    }

    private PosPaymentResponse process(TerminalRow terminal, String codeHash, int amount, LocalDateTime now) {
        PaymentCode paymentCode = paymentCodeRepository.findByCodeHash(codeHash).orElse(null);
        if (paymentCode == null) {
            return decline(terminal, codeHash, amount, now, "NOT_ISSUED");
        }
        if (PaymentCode.USED.equals(paymentCode.getStatus())) {
            return decline(terminal, codeHash, amount, now, "ALREADY_USED");
        }
        if (PaymentCode.VOID.equals(paymentCode.getStatus())) {
            return decline(terminal, codeHash, amount, now, "VOIDED");
        }
        if (!paymentCode.getExpiresAt().isAfter(LocalDateTime.now(SEOUL))) {   // 만료는 발급 때처럼 실제 시각으로
            return decline(terminal, codeHash, amount, now, "EXPIRED");
        }
        return approve(terminal, paymentCode, codeHash, amount, now);
    }

    private PosPaymentResponse approve(TerminalRow terminal, PaymentCode paymentCode, String codeHash,
                                       int amount, LocalDateTime now) {
        UserCard userCard = userCardRepository.findById(paymentCode.getUserCardId()).orElseThrow();
        Card card = cardRepository.findById(userCard.getCardId()).orElseThrow();

        // 이번 결제에서 받을 혜택 (이번 결제는 아직 저장 전이라 한도 계산에 포함되지 않음)
        BenefitResult benefit = benefitCalculator.calculate(
                userCard.getId(), userCard.getCardId(), terminal.getMerchantId(), terminal.getCategory(), terminal.getMerchantName(), amount, now);

        String approvalNo = posRepository.nextApprovalNo();
        Payment payment = paymentRepository.save(new Payment(
                userCard.getId(), terminal.getMerchantName(), terminal.getCategory(), amount, now,
                benefit.benefitId(), benefit.benefitAmount(),
                benefit.promotionId(), benefit.promotionAmount(), approvalNo));

        posRepository.insertPaymentDetail(
                payment.getId(), SHINHAN.equals(card.getIssuer()) ? "own" : "mydata", now, terminal.getMerchantId());
        posRepository.insertApproved(terminal.getTerminalId(), codeHash, amount, now, payment.getId());
        paymentCode.markUsed(payment.getId());
        posRepository.addToMonthStatus(
                userCard.getId(), YearMonth.from(now).toString(),
                benefit.prevPerf(), benefit.tierId(), amount, benefit.benefitAmount(), benefit.promotionAmount());

        return new PosPaymentResponse(true, null, payment.getId(), approvalNo, terminal.getMerchantName(),
                amount, benefit.benefitName(), benefit.benefitAmount(),
                benefit.promotionName(), benefit.promotionAmount(), benefit.totalAmount(), toOffset(now));
    }

    private PosPaymentResponse decline(TerminalRow terminal, String codeHash, int amount,
                                       LocalDateTime now, String reason) {
        posRepository.insertDeclined(terminal.getTerminalId(), codeHash, amount, now, reason);
        return new PosPaymentResponse(false, reason, null, null, terminal.getMerchantName(),
                amount, null, 0, null, 0, 0, toOffset(now));
    }


    private String normalizeCode(String raw) {
        return raw.trim().replaceFirst("(?i)^PAYMATE:", "").replaceAll("[\\s-]", "");
    }

    private OffsetDateTime toOffset(LocalDateTime time) {
        return ZonedDateTime.of(time, SEOUL).toOffsetDateTime();
    }
}
