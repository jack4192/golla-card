package com.paymate.backend.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.payment.dto.PosMerchantResponse;
import com.paymate.backend.payment.dto.PosTransactionResponse;
import com.paymate.backend.payment.repository.PosMerchantRow;
import com.paymate.backend.payment.repository.PosRepository;
import com.paymate.backend.payment.repository.PosTransactionRow;
import com.paymate.backend.payment.service.PosDemoService;
import com.paymate.backend.payment.service.PosPaymentService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 백엔드 가상 POS 화면의 가맹점·거래 목록 (2026-11-25). 저장소는 가짜로 둔다. */
class PosDemoServiceTest {

    record Merchant(Long merchantId, String merchantName, String branchName, String category, String categoryName)
            implements PosMerchantRow {
        public Long getMerchantId() { return merchantId; }
        public String getMerchantName() { return merchantName; }
        public String getBranchName() { return branchName; }
        public String getCategory() { return category; }
        public String getCategoryName() { return categoryName; }
    }

    record Txn(Long txnId, String requestedAt, Long paymentId, String declineReason, String approvalNo,
               String merchantName, String branchName, String categoryName, Integer amount, String cardName,
               Integer totalDiscount) implements PosTransactionRow {
        public Long getTxnId() { return txnId; }
        public String getRequestedAt() { return requestedAt; }
        public Long getPaymentId() { return paymentId; }
        public String getDeclineReason() { return declineReason; }
        public String getApprovalNo() { return approvalNo; }
        public String getMerchantName() { return merchantName; }
        public String getBranchName() { return branchName; }
        public String getCategoryName() { return categoryName; }
        public Integer getAmount() { return amount; }
        public String getCardName() { return cardName; }
        public Integer getTotalDiscount() { return totalDiscount; }
    }

    private PosRepository pos;
    private PosPaymentService payments;
    private PosDemoService service;

    @BeforeEach
    void setUp() {
        pos = mock(PosRepository.class);
        payments = mock(PosPaymentService.class);
        when(payments.isDemoEnabled()).thenReturn(true);
        service = new PosDemoService(pos, payments);
    }

    @Test
    @DisplayName("가맹점 목록은 저장소 행을 그대로 옮긴다")
    void merchantsMapsRows() {
        when(pos.findDemoMerchants()).thenReturn(List.of(new Merchant(560L, "스타벅스", "강남역점", "CAFE", "카페")));

        List<PosMerchantResponse> list = service.merchants();

        assertThat(list).containsExactly(new PosMerchantResponse(560L, "스타벅스", "강남역점", "CAFE", "카페"));
    }

    @Test
    @DisplayName("거래 목록: 승인은 결제 번호로 판단하고, 시각은 서울 시간대를 붙이며, 빈 혜택은 0")
    void transactionsMapsRows() {
        String at = "2026-11-25T12:20:00";
        when(pos.findRecentTransactions(20)).thenReturn(List.of(
                new Txn(9L, at, 1_129_903L, null, "A0534770", "스타벅스", "강남역점", "카페", 6000, "신한카드 Mr.Life", 600),
                new Txn(8L, at, null, "EXPIRED", null, "CU", "역삼점", "편의점", 3000, null, null)));

        List<PosTransactionResponse> list = service.recentTransactions(null);

        assertThat(list).hasSize(2);
        assertThat(list.get(0).approved()).isTrue();
        assertThat(list.get(0).requestedAt().toString()).isEqualTo("2026-11-25T12:20+09:00");
        assertThat(list.get(0).totalDiscount()).isEqualTo(600);
        assertThat(list.get(1).approved()).isFalse();
        assertThat(list.get(1).declineReason()).isEqualTo("EXPIRED");
        assertThat(list.get(1).totalDiscount()).isZero();
    }

    @Test
    @DisplayName("거래 목록 개수는 비우면 20, 1~50 으로 자른다")
    void recentTransactionsClampsLimit() {
        service.recentTransactions(null);
        service.recentTransactions(0);
        service.recentTransactions(-5);
        service.recentTransactions(100_000);
        service.recentTransactions(7);

        verify(pos).findRecentTransactions(20);
        verify(pos, org.mockito.Mockito.times(2)).findRecentTransactions(1);
        verify(pos).findRecentTransactions(50);
        verify(pos).findRecentTransactions(7);
    }

    @Test
    @DisplayName("시연용 POS 가 꺼져 있으면 두 목록 모두 404 POS_DEMO_DISABLED")
    void listsDisabled() {
        when(payments.isDemoEnabled()).thenReturn(false);

        for (Runnable call : new Runnable[]{service::merchants, () -> service.recentTransactions(null)}) {
            assertThatThrownBy(call::run)
                    .isInstanceOf(BusinessException.class)
                    .extracting(e -> ((BusinessException) e).getErrorCode().getCode())
                    .isEqualTo("POS_DEMO_DISABLED");
        }
        verify(pos, never()).findDemoMerchants();
        verify(pos, never()).findRecentTransactions(anyInt());
    }
}
