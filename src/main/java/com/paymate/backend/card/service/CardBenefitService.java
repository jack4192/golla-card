package com.paymate.backend.card.service;

import com.paymate.backend.card.dto.BenefitResponse;
import com.paymate.backend.card.dto.BenefitTierResponse;
import com.paymate.backend.card.repository.BenefitRow;
import com.paymate.backend.card.repository.BenefitTargetRow;
import com.paymate.backend.card.repository.CardRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CardBenefitService {

    private static final Map<String, String> DAY_LABELS = Map.of(
            "MON", "월", "TUE", "화", "WED", "수", "THU", "목", "FRI", "금", "SAT", "토", "SUN", "일");

    private final CardRepository cardRepository;

    @Transactional(readOnly = true)
    public List<BenefitResponse> getBenefits(Long cardId) {
        Map<Long, List<BenefitRow>> rowsByBenefit = cardRepository.findBenefitRows(cardId).stream()
                .collect(Collectors.groupingBy(BenefitRow::getBenefitId, LinkedHashMap::new, Collectors.toList()));

        Map<Long, List<BenefitTargetRow>> targetsByBenefit = cardRepository.findBenefitTargets(cardId).stream()
                .collect(Collectors.groupingBy(BenefitTargetRow::getBenefitId));

        List<BenefitResponse> result = new ArrayList<>();
        for (Map.Entry<Long, List<BenefitRow>> entry : rowsByBenefit.entrySet()) {
            List<BenefitTargetRow> targets = targetsByBenefit.getOrDefault(entry.getKey(), List.of());
            result.add(toResponse(entry.getValue(), targets));
        }
        return result;
    }

    private BenefitResponse toResponse(List<BenefitRow> rows, List<BenefitTargetRow> targets) {
        BenefitRow first = rows.get(0);

        Set<String> categories = new LinkedHashSet<>();
        Set<String> merchants = new LinkedHashSet<>();
        for (BenefitTargetRow t : targets) {
            categories.add(t.getCategoryName());
            if (t.getMerchantName() != null && !t.getMerchantName().isBlank()) {
                merchants.add(t.getMerchantName());
            }
        }

        List<BenefitTierResponse> tiers = rows.stream()
                .map(r -> toTier(r, first.getValueType()))
                .toList();

        return new BenefitResponse(
                first.getBenefitId(), first.getName(), first.getKind(), first.getValueType(),
                first.getLimitBasis(), first.getGroupName(),
                new ArrayList<>(categories), new ArrayList<>(merchants),
                buildNote(first, targets.isEmpty()), tiers);
    }

    private BenefitTierResponse toTier(BenefitRow r, String valueType) {
        boolean isRate = "RATE".equals(valueType);
        BigDecimal value = r.getBenefitValue();
        Double rate = isRate && value != null ? value.doubleValue() : null;
        Long fixedAmount = !isRate && value != null ? value.longValue() : null;

        return new BenefitTierResponse(
                r.getTierNo(), r.getMinPrevSpend(), rate, fixedAmount,
                displayValue(valueType, value),
                r.getMonthlyLimit(), r.getMonthlyCount(), r.getPerPaymentLimit(),
                r.getGroupMonthlyLimit());
    }

    private String displayValue(String valueType, BigDecimal value) {
        if (value == null) {
            return null;
        }
        return switch (valueType) {
            case "RATE" -> value.stripTrailingZeros().toPlainString() + "%";
            case "PER_LITER" -> "리터당 " + won(value.longValue());
            default -> won(value.longValue());
        };
    }

    private String buildNote(BenefitRow r, boolean allCategories) {
        List<String> parts = new ArrayList<>();

        if (allCategories) {
            parts.add("국내 전 업종");
        }
        if (r.getTimeFrom() != null && r.getTimeTo() != null) {
            parts.add(r.getTimeFrom() + "~" + r.getTimeTo());
        }
        if (r.getDays() != null && !r.getDays().isBlank()) {
            parts.add(toKoreanDays(r.getDays()));
        }
        if (r.getPayType() != null) {
            parts.add(payTypeLabel(r.getPayType()));
        }
        if (r.getMinPayAmount() != null) {
            parts.add("건당 " + won(r.getMinPayAmount()) + " 이상 결제");
        }
        if (r.getDailyCount() != null) {
            parts.add("1일 " + r.getDailyCount() + "회");
        }
        if (r.getDescription() != null && !r.getDescription().isBlank()) {
            parts.add(r.getDescription().trim());
        }

        return parts.isEmpty() ? null : String.join(" · ", parts);
    }

    private String toKoreanDays(String days) {
        Map<String, String> ordered = new LinkedHashMap<>();
        for (String d : days.split(",")) {
            String key = d.trim();
            ordered.put(key, DAY_LABELS.getOrDefault(key, key));
        }
        return String.join("·", ordered.values());
    }

    private String payTypeLabel(String payType) {
        return switch (payType) {
            case "PAY" -> "간편결제 시";
            case "NOPAY" -> "간편결제 제외";
            case "SOLPAY" -> "SOL페이 결제 시";
            case "KBPAY" -> "KB Pay 결제 시";
            case "SAMSUNGPAY" -> "삼성페이 결제 시";
            case "NHPAY" -> "NH페이 결제 시";
            default -> payType;
        };
    }

    private String won(long amount) {
        return String.format("%,d원", amount);
    }
}
