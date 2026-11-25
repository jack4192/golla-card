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
    private static final String DEMO_KEY = "demo-terminal-key-0123456789";   // 시연용 만능 키 (16자 이상)

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
        service = service(DEMO_KEY);
        when(pos.findTerminal(HashUtil.sha256Hex(KEY))).thenReturn(List.of(new Terminal(5L, 77L, "스타벅스 강남점", "CAFE")));
    }

    private PosPaymentService service(String demoKey) {
        return new PosPaymentService(pos, codes, payments, userCards, cards, calculator, new AmountPolicy(), hasher,
                FIXED_AT, demoKey);
    }

    private static PosPaymentRequest request(String key, String code, Integer amount) throws Exception {
        PosPaymentRequest req = new PosPaymentRequest();
        set(req, "terminalKey", key);
        set(req, "code", code);
        set(req, "amount", amount);
        return req;
    }

    private static PosPaymentRequest demoRequest(String key, Long merchantId, String category) throws Exception {
        PosPaymentRequest req = request(key, "12-34", 5000);       // 형식이 틀려 바로 거절 — 어느 가맹점으로 갔는지만 본다
        set(req, "merchantId", merchantId);
        set(req, "category", category);
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
    @DisplayName("앱 시연 결제: 업종을 주면 그 업종 가맹점에서, 그 업종 단말기가 없으면 아무 가맹점에서 결제한다")
    void appPayPicksTerminalByCategory() throws Exception {
        PaymentCode code = new PaymentCode(3L, hasher.hash(CODE), LocalDateTime.now(ZoneId.of("Asia/Seoul")).minusSeconds(1));
        when(codes.findMine(9L, 1L)).thenReturn(Optional.of(code));
        when(codes.findByCodeHash(hasher.hash(CODE))).thenReturn(Optional.of(code));   // 만료된 코드라 거절로 끝난다
        when(pos.findRandomTerminalInCategory("CAFE")).thenReturn(List.of(new Terminal(7L, 70L, "투썸플레이스", "CAFE")));
        when(pos.findRandomTerminalInCategory("TAXI")).thenReturn(List.of());
        when(pos.findRandomTerminal()).thenReturn(List.of(new Terminal(8L, 80L, "GS25", "CONVENIENCE")));

        assertThat(service.payFromApp(1L, 9L, null, "CAFE", 5000).getMerchantName()).isEqualTo("투썸플레이스");
        assertThat(service.payFromApp(1L, 9L, null, "TAXI", 5000).getMerchantName()).isEqualTo("GS25");
        assertThat(service.payFromApp(1L, 9L, null, null, 5000).getMerchantName()).isEqualTo("GS25");
        verify(pos, never()).findTerminalByMerchant(any());
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

    // ---------- 시연용 만능 키 (2026-11-24 팀 결정: 가상 POS 에서 아무 가맹점이나 골라 결제) ----------

    @Test
    @DisplayName("시연용 만능 키면 POS 가 고른 가맹점의 단말기로 결제한다")
    void demoKeyUsesChosenMerchant() throws Exception {
        when(pos.findTerminalByMerchant(90L)).thenReturn(List.of(new Terminal(9L, 90L, "CU 강남역점", "CONVENIENCE")));

        PosPaymentResponse res = service.pay(demoRequest(DEMO_KEY, 90L, null));

        assertThat(res.getMerchantName()).isEqualTo("CU 강남역점");
        verify(pos).insertDeclined(eq(9L), anyString(), eq(5000), eq(DEMO_NOW), eq("INVALID_FORMAT"));
        verify(pos, never()).findTerminal(any());
    }

    @Test
    @DisplayName("시연용 만능 키에 업종만 주면 그 업종 가맹점 중 하나, 없는 가맹점이면 404")
    void demoKeyCategoryAndUnknownMerchant() throws Exception {
        when(pos.findRandomTerminalInCategory("CAFE")).thenReturn(List.of(new Terminal(7L, 70L, "투썸플레이스", "CAFE")));
        when(pos.findTerminalByMerchant(999L)).thenReturn(List.of());

        assertThat(service.pay(demoRequest(DEMO_KEY, null, "CAFE")).getMerchantName()).isEqualTo("투썸플레이스");
        assertThatThrownBy(() -> service.pay(demoRequest(DEMO_KEY, 999L, null)))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode().getStatus().value())
                .isEqualTo(404);
    }

    @Test
    @DisplayName("진짜 단말기 키는 POS 가 가맹점을 보내도 자기 가맹점으로만 결제한다")
    void realKeyIgnoresMerchant() throws Exception {
        PosPaymentResponse res = service.pay(demoRequest(KEY, 90L, "CONVENIENCE"));

        assertThat(res.getMerchantName()).isEqualTo("스타벅스 강남점");
        verify(pos, never()).findTerminalByMerchant(any());
        verify(pos, never()).findRandomTerminalInCategory(any());
    }

    @Test
    @DisplayName("만능 키를 설정하지 않았거나 16자보다 짧으면 꺼져 있다 (그 키는 없는 단말기로 403)")
    void demoKeyOffWhenBlankOrShort() throws Exception {
        for (String configured : new String[]{"", "   ", "short-key"}) {
            PosPaymentService off = service(configured);
            String sent = configured.isBlank() ? DEMO_KEY : configured;
            assertThatThrownBy(() -> off.pay(demoRequest(sent, 90L, null)))
                    .isInstanceOf(BusinessException.class)
                    .extracting(e -> ((BusinessException) e).getErrorCode().getStatus().value())
                    .isEqualTo(403);
        }
        verify(pos, never()).findTerminalByMerchant(any());
    }

    // ---------- 백엔드 가상 POS 화면의 시연 결제 (2026-11-25: 키는 서버 안에만, 화면은 가맹점·금액·코드만 보낸다) ----------

    @Test
    @DisplayName("시연 결제는 고른 가맹점의 단말기로 승인한다")
    void payDemoApprovesAtChosenMerchant() throws Exception {
        issued(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusSeconds(30));
        when(pos.findTerminalByMerchant(77L)).thenReturn(List.of(new Terminal(5L, 77L, "스타벅스 강남점", "CAFE")));
        UserCard userCard = mock(UserCard.class);
        when(userCard.getId()).thenReturn(3L);
        when(userCard.getCardId()).thenReturn(10L);
        when(userCards.findById(3L)).thenReturn(Optional.of(userCard));
        Card card = mock(Card.class);
        when(card.getIssuer()).thenReturn("신한");
        when(cards.findById(10L)).thenReturn(Optional.of(card));
        when(calculator.calculate(3L, 10L, 77L, "CAFE", "스타벅스 강남점", 5000, DEMO_NOW))
                .thenReturn(new BenefitResult(1L, "카페 10%", 500, null, null, 0, 350_000, 102L));
        when(pos.nextApprovalNo()).thenReturn("A0534769");
        when(payments.save(any(Payment.class))).thenAnswer(call -> {
            Payment p = call.getArgument(0);
            set(p, "id", 1_129_902L);
            return p;
        });

        PosPaymentResponse res = service.payDemo(" PAYMATE:" + CODE + " ", 5000, 77L);

        assertThat(res.isApproved()).isTrue();
        assertThat(res.getApprovalNo()).isEqualTo("A0534769");
        assertThat(res.getMerchantName()).isEqualTo("스타벅스 강남점");
        verify(pos).insertApproved(eq(5L), eq(hasher.hash(CODE)), eq(5000), eq(DEMO_NOW), eq(1_129_902L));
        verify(pos, never()).findTerminal(any());
    }

    @Test
    @DisplayName("시연 결제에서 같은 코드를 다시 찍으면 ALREADY_USED 로 거절한다")
    void payDemoDeclinesReusedCode() throws Exception {
        PaymentCode used = issued(LocalDateTime.now(ZoneId.of("Asia/Seoul")).plusSeconds(30));
        used.markUsed(1L);
        when(pos.findTerminalByMerchant(77L)).thenReturn(List.of(new Terminal(5L, 77L, "스타벅스 강남점", "CAFE")));

        PosPaymentResponse res = service.payDemo(CODE, 5000, 77L);

        assertThat(res.isApproved()).isFalse();
        assertThat(res.getDeclineReason()).isEqualTo("ALREADY_USED");
        verify(payments, never()).save(any());
        verify(pos).insertDeclined(eq(5L), anyString(), eq(5000), eq(DEMO_NOW), eq("ALREADY_USED"));
    }

    @Test
    @DisplayName("시연 결제: 형식이 틀리면 INVALID_FORMAT, 단말기 없는 가맹점이면 404 MERCHANT_NOT_FOUND")
    void payDemoUnknownMerchant() throws Exception {
        when(pos.findTerminalByMerchant(77L)).thenReturn(List.of(new Terminal(5L, 77L, "스타벅스 강남점", "CAFE")));
        when(pos.findTerminalByMerchant(999L)).thenReturn(List.of());

        assertThat(service.payDemo("12-34", 5000, 77L).getDeclineReason()).isEqualTo("INVALID_FORMAT");
        assertThatThrownBy(() -> service.payDemo(CODE, 5000, 999L))
                .isInstanceOf(BusinessException.class)
                .extracting(e -> ((BusinessException) e).getErrorCode().getCode())
                .isEqualTo("MERCHANT_NOT_FOUND");
    }

    @Test
    @DisplayName("만능 키가 없거나 짧으면 시연 결제도 꺼져 있다 (404 POS_DEMO_DISABLED, 단말기를 찾지 않음)")
    void demoDisabledEverywhere() throws Exception {
        assertThat(service.isDemoEnabled()).isTrue();
        for (String configured : new String[]{null, "", "short-key"}) {
            PosPaymentService off = service(configured);
            assertThat(off.isDemoEnabled()).isFalse();
            assertThatThrownBy(() -> off.payDemo(CODE, 5000, 77L))
                    .isInstanceOf(BusinessException.class)
                    .extracting(e -> ((BusinessException) e).getErrorCode().getCode())
                    .isEqualTo("POS_DEMO_DISABLED");
        }
        verify(pos, never()).findTerminalByMerchant(any());
    }
}
