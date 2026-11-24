package com.paymate.backend.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.card.entity.Card;
import com.paymate.backend.card.entity.UserCard;
import com.paymate.backend.card.repository.CardRepository;
import com.paymate.backend.card.repository.UserCardRepository;
import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.payment.benefit.AmountPolicy;
import com.paymate.backend.payment.benefit.BenefitCalculator;
import com.paymate.backend.payment.benefit.BenefitResult;
import com.paymate.backend.payment.dto.PosPaymentRequest;
import com.paymate.backend.payment.dto.PosPaymentResponse;
import com.paymate.backend.payment.entity.Payment;
import com.paymate.backend.payment.entity.PaymentCode;
import com.paymate.backend.payment.repository.PaymentCodeRepository;
import com.paymate.backend.payment.repository.PaymentWriteRepository;
import com.paymate.backend.payment.repository.PosRepository;
import com.paymate.backend.payment.repository.TerminalRow;
import com.paymate.backend.payment.service.PosPaymentService;
import com.paymate.backend.payment.util.HashUtil;
import com.paymate.backend.payment.util.PaymentCodeHasher;
import java.lang.reflect.Field;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 가상 POS 결제 승인·거절 (PR #6, 2026-11-24). 저장소는 가짜로 두고 흐름만 본다. */
class PosPaymentServiceTest {

    private static final String FIXED_AT = "2026-11-05T09:30:00";
    private static final LocalDateTime DEMO_NOW = LocalDateTime.parse(FIXED_AT);
    private static final String KEY = "terminal-key-1";
    private static final String CODE = "123456789012345678";

    record Terminal(Long terminalId, Long merchantId, String merchantName, String category) implements TerminalRow {
        public Long getTerminalId() { return terminalId; }
        public Long getMerchantId() { return merchantId; }
        public String getMerchantName() { return merchantName; }
        public String getCategory() { return category; }
    }

    private PosRepository pos;
    private PaymentCodeRepository codes;
    private PaymentWriteRepository payments;
    private UserCardRepository userCards;
    private CardRepository cards;
    private BenefitCalculator calculator;
    private final PaymentCodeHasher hasher = new PaymentCodeHasher("test-secret");
    private PosPaymentService service;

    @BeforeEach
    void setUp() {
        pos = mock(PosRepository.class);
        codes = mock(PaymentCodeRepository.class);
        payments = mock(PaymentWriteRepository.class);
        userCards = mock(UserCardRepository.class);
        cards = mock(CardRepository.class);
        calculator = mock(BenefitCalculator.class);
        service = new PosPaymentService(pos, codes, payments, userCards, cards, calculator, new AmountPolicy(), hasher, FIXED_AT);
        when(pos.findTerminal(HashUtil.sha256Hex(KEY))).thenReturn(List.of(new Terminal(5L, 77L, "스타벅스 강남점", "CAFE")));
    }

    private static PosPaymentRequest request(String key, String code, Integer amount) throws Exception {
        PosPaymentRequest req = new PosPaymentRequest();
        set(req, "terminalKey", key);
        set(req, "code", code);
        set(req, "amount", amount);
        return req;
    }

    private static void set(Object target, String field, Object value) throws Exception {
        Field f = target.getClass().getDeclaredField(field);
        f.setAccessible(true);
        f.set(target, value);
    }

    private PaymentCode issued(LocalDateTime expiresAt) {
        PaymentCode code = new PaymentCode(3L, hasher.hash(CODE), expiresAt);
        when(codes.findByCodeHash(hasher.hash(CODE))).thenReturn(Optional.of(code));
        return code;
    }

    @Test
    @DisplayName("등록되지 않은 단말기는 403 (401 이면 앱이 로그인 만료로 본다)")
    void unknownTerminal() throws Exception {
        assertThatThrownBy(() -> service.pay(request("wrong", CODE, 5000)))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode().getStatus().value())
                .isEqualTo(403);
    }

    @Test
    @DisplayName("거절: 형식이 틀림·발급 안 됨·이미 사용·만료는 사유를 남기고 결제를 만들지 않는다")
    void declines() throws Exception {
        assertThat(service.pay(request(KEY, "12-34", 5000)).getDeclineReason()).isEqualTo("INVALID_FORMAT");
        assertThat(service.pay(request(KEY, CODE, 5000)).getDeclineReason()).isEqualTo("NOT_ISSUED");

        PaymentCode used = issued(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusSeconds(30));
        used.markUsed(1L);
        assertThat(service.pay(request(KEY, CODE, 5000)).getDeclineReason()).isEqualTo("ALREADY_USED");

        issued(LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusSeconds(1));
        assertThat(service.pay(request(KEY, "PAYMATE:" + CODE, 5000)).getDeclineReason()).isEqualTo("EXPIRED");

        verify(payments, never()).save(any());
        verify(pos).insertDeclined(eq(5L), anyString(), eq(5000), eq(DEMO_NOW), eq("INVALID_FORMAT"));
    }

    @Test
    @DisplayName("승인: 만료는 실제 시각으로 보고, 결제 시각·혜택 계산은 시연용 기준 시각(DemoClock)으로 저장한다")
    void approveUsesDemoClock() throws Exception {
        PaymentCode code = issued(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusSeconds(30));   // 실제 시각으로는 유효
        UserCard userCard = mock(UserCard.class);
        when(userCard.getId()).thenReturn(3L);
        when(userCard.getCardId()).thenReturn(10L);
        when(userCards.findById(3L)).thenReturn(Optional.of(userCard));
        Card card = mock(Card.class);
        when(card.getIssuer()).thenReturn("신한");
        when(cards.findById(10L)).thenReturn(Optional.of(card));
        when(calculator.calculate(3L, 10L, 77L, "CAFE", "스타벅스 강남점", 5000, DEMO_NOW))
                .thenReturn(new BenefitResult(1L, "카페 10%", 500, 55L, "스벅 행사", 300, 350_000, 102L));
        when(pos.nextApprovalNo()).thenReturn("A0534768");
        when(payments.save(any(Payment.class))).thenAnswer(call -> {
            Payment p = call.getArgument(0);
            set(p, "id", 1_129_901L);
            return p;
        });

        PosPaymentResponse res = service.pay(request(KEY, CODE, 5000));

        assertThat(res.isApproved()).isTrue();
        assertThat(res.getPaymentId()).isEqualTo(1_129_901L);
        assertThat(res.getApprovalNo()).isEqualTo("A0534768");
        assertThat(res.getTotalDiscount()).isEqualTo(800);
        assertThat(res.getPaidAt().toLocalDateTime()).isEqualTo(DEMO_NOW);
        ArgumentCaptor<Payment> saved = ArgumentCaptor.forClass(Payment.class);
        verify(payments).save(saved.capture());
        assertThat(saved.getValue().getPaidAt()).isEqualTo(DEMO_NOW);
        assertThat(saved.getValue().getBenefitAmount()).isEqualTo(500);
        assertThat(saved.getValue().getPromotionAmount()).isEqualTo(300);
        verify(pos).insertPaymentDetail(1_129_901L, "own", DEMO_NOW, 77L);
        verify(pos).addToMonthStatus(3L, "2026-11", 350_000, 102L, 5000, 500, 300);
        assertThat(code.getStatus()).isEqualTo(PaymentCode.USED);
        assertThat(code.getPaymentId()).isEqualTo(1_129_901L);
    }

    @Test
    @DisplayName("금액을 비우면 가맹점 업종 범위 안에서 100원 단위로 정한다")
    void randomAmount() throws Exception {
        PosPaymentResponse res = service.pay(request(KEY, "bad", null));

        assertThat(res.getAmount()).isBetween(3_000, 12_000);       // CAFE 범위
        assertThat(res.getAmount() % 100).isZero();
        verify(pos, never()).nextApprovalNo();
        verify(calculator, never()).calculate(any(), any(), any(), any(), any(), anyInt(), any());
    }
}
