package com.paymate.backend.payment.service;

import com.paymate.backend.common.exception.BusinessException;
import com.paymate.backend.payment.dto.PosMerchantResponse;
import com.paymate.backend.payment.dto.PosTransactionResponse;
import com.paymate.backend.payment.exception.PaymentErrorCode;
import com.paymate.backend.payment.repository.PosRepository;
import com.paymate.backend.payment.repository.PosTransactionRow;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 백엔드 가상 POS 화면(/pos)의 가맹점·최근 거래 목록 (2026-11-25).
 * 시연용 POS 가 꺼져 있으면(만능 키 없음) 404 POS_DEMO_DISABLED. 가맹점은 DB 에서 바로 읽어 AI 가 꺼져도 동작한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PosDemoService {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;

    private final PosRepository posRepository;
    private final PosPaymentService posPaymentService;

    public List<PosMerchantResponse> merchants() {
        requireEnabled();
        return posRepository.findDemoMerchants().stream()
                .map(m -> new PosMerchantResponse(m.getMerchantId(), m.getMerchantName(), m.getBranchName(),
                        m.getCategory(), m.getCategoryName()))
                .toList();
    }

    public List<PosTransactionResponse> recentTransactions(Integer limit) {
        requireEnabled();
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, limit));
        return posRepository.findRecentTransactions(size).stream().map(PosDemoService::toResponse).toList();
    }

    private void requireEnabled() {
        if (!posPaymentService.isDemoEnabled()) {
            throw new BusinessException(PaymentErrorCode.POS_DEMO_DISABLED);
        }
    }

    private static PosTransactionResponse toResponse(PosTransactionRow row) {
        OffsetDateTime at = row.getRequestedAt() == null ? null
                : LocalDateTime.parse(row.getRequestedAt()).atZone(SEOUL).toOffsetDateTime();
        return new PosTransactionResponse(row.getTxnId(), at, row.getPaymentId() != null, row.getDeclineReason(),
                row.getApprovalNo(), row.getMerchantName(), row.getBranchName(), row.getCategoryName(),
                row.getAmount() == null ? 0 : row.getAmount(), row.getCardName(),
                row.getTotalDiscount() == null ? 0 : row.getTotalDiscount());
    }
}
