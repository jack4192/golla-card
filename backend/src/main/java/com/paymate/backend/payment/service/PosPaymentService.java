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
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import lombok.extern.slf4j.Slf4j;
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
 *
 * <p>시연용 만능 키(app.pos.demo-terminal-key, 환경 변수 POS_DEMO_TERMINAL_KEY): 이 키로 온 요청은 POS 가 보낸 가맹점
 * (없으면 업종)의 단말기로 결제한다. DB 단말기는 키 원문을 저장하지 않아, 가상 POS 에서 아무 가맹점이나 고르려면 필요하다
 * (2026-11-24 사용자 결정). 비우거나 16자보다 짧으면 꺼진다.
 */
@Slf4j
@Service
public class PosPaymentService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final String SHINHAN = "신한";
    private static final int DEMO_KEY_MIN_LENGTH = 16;

    private final PosRepository posRepository;
    private final PaymentCodeRepository paymentCodeRepository;
    private final PaymentWriteRepository paymentRepository;
    private final UserCardRepository userCardRepository;
    private final CardRepository cardRepository;
    private final BenefitCalculator benefitCalculator;
    private final AmountPolicy amountPolicy;
    private final PaymentCodeHasher hasher;
    private final DemoClock clock;
    private final byte[] demoKey;   // 시연용 만능 키 (꺼져 있으면 null)

    public PosPaymentService(PosRepository posRepository, PaymentCodeRepository paymentCodeRepository,
                             PaymentWriteRepository paymentRepository, UserCardRepository userCardRepository,
                             CardRepository cardRepository, BenefitCalculator benefitCalculator,
                             AmountPolicy amountPolicy, PaymentCodeHasher hasher,
                             @Value("${ai.fixed-at:}") String fixedAt,
                             @Value("${app.pos.demo-terminal-key:}") String demoTerminalKey) {
        this.posRepository = posRepository;
        this.paymentCodeRepository = paymentCodeRepository;
        this.paymentRepository = paymentRepository;
        this.userCardRepository = userCardRepository;
        this.cardRepository = cardRepository;
        this.benefitCalculator = benefitCalculator;
        this.amountPolicy = amountPolicy;
        this.hasher = hasher;
        this.clock = DemoClock.of(fixedAt);
        String demo = demoTerminalKey == null ? "" : demoTerminalKey.trim();
        if (!demo.isEmpty() && demo.length() < DEMO_KEY_MIN_LENGTH) {
            log.warn("시연용 POS 만능 키가 {}자보다 짧아 쓰지 않습니다", DEMO_KEY_MIN_LENGTH);
        }
        this.demoKey = demo.length() >= DEMO_KEY_MIN_LENGTH ? demo.getBytes(StandardCharsets.UTF_8) : null;
    }

    @Transactional
    public PosPaymentResponse pay(PosPaymentRequest req) {
        String key = req.getTerminalKey().trim();
        TerminalRow terminal = isDemoKey(key)
                ? pickTerminal(req.getMerchantId(), req.getCategory())
                : posRepository.findTerminal(HashUtil.sha256Hex(key)).stream().findFirst()
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
    public PosPaymentResponse payFromApp(Long userId, Long paymentTokenId, Long merchantId, String category,
                                         Integer requestedAmount) {
        PaymentCode mine = paymentCodeRepository.findMine(paymentTokenId, userId)
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.PAYMENT_TOKEN_NOT_FOUND));
        TerminalRow terminal = pickTerminal(merchantId, category);

        LocalDateTime now = clock.now();   // 결제 시각 (시연용 기준 시각이 있으면 그 시각)
        int amount = requestedAmount != null ? requestedAmount : amountPolicy.randomAmount(terminal.getCategory());
        return process(terminal, mine.getCodeHash(), amount, now);
    }

    /**
     * 앱 시연 결제의 가맹점: 가맹점을 정했으면 그 가맹점, 아니면 업종(일정에서 연 결제)의 가맹점 중 무작위,
     * 그 업종에 단말기가 없거나 업종도 없으면 아무 가맹점 (2026-11-24).
     */
    private boolean isDemoKey(String key) {
        return demoKey != null && MessageDigest.isEqual(demoKey, key.getBytes(StandardCharsets.UTF_8));
    }

    private TerminalRow pickTerminal(Long merchantId, String category) {
        if (merchantId != null) {
            return posRepository.findTerminalByMerchant(merchantId).stream().findFirst()
                    .orElseThrow(() -> new BusinessException(PaymentErrorCode.MERCHANT_NOT_FOUND));
        }
        if (category != null && !category.isBlank()) {
            var inCategory = posRepository.findRandomTerminalInCategory(category.trim());
            if (!inCategory.isEmpty()) {
                return inCategory.get(0);
            }
        }
        return posRepository.findRandomTerminal().stream().findFirst()
                .orElseThrow(() -> new BusinessException(PaymentErrorCode.MERCHANT_NOT_FOUND));
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
