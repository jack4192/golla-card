package com.paymate.backend.payment.benefit;

import com.paymate.backend.payment.repository.BenefitCandidateRow;
import com.paymate.backend.payment.repository.BenefitRuleRepository;
import com.paymate.backend.payment.repository.BenefitUsageRow;
import com.paymate.backend.payment.repository.MonthStatusRow;
import com.paymate.backend.payment.repository.PromotionRow;
import com.paymate.backend.payment.repository.TierRow;
import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 한 번의 결제에서 받을 혜택 금액을 계산합니다.
 * 결제 승인(가상 POS)과 "추천 결제 카드 조회"가 같은 계산을 쓰도록 한 곳에 모았습니다.
 *
 * 규칙 (시드 데이터의 계산 방식과 같은 기준):
 *  1) 결제 한 건에는 후보 혜택 중 금액이 가장 큰 혜택 1개만 적용
 *  2) 사용자의 전월 실적으로 정해진 구간의 값을 사용
 *  3) 조건(결제수단·최소 결제금액·시간·요일·1일/월 횟수)을 만족해야 함
 *  4) 한도: 건당 → 월(혜택 영역) → 혜택 그룹 월 통합 → 카드 월 통합 한도 순으로 깎음
 *  5) 혜택 금액은 10원 단위로 내림
 *  6) 신한카드 결제면 프로모션을 추가로 받음 (카드 혜택과 중복 가능, 프로모션 1개, 원 단위 내림)
 */
@Component
@RequiredArgsConstructor
public class BenefitCalculator {

    private static final int WON_UNIT = 10;
    private static final int FUEL_PRICE_PER_LITER = 1700;   // 주유 리터당 혜택은 리터 수를 이 단가로 추정

    private final BenefitRuleRepository ruleRepository;

    public BenefitResult calculate(Long userCardId, Long cardId, Long merchantId, String category, String merchantName,
                                   int amount, LocalDateTime at) {
        YearMonth month = YearMonth.from(at);

        // 1) 이번 달 기준 구간 (전월 실적으로 정해짐)
        List<TierRow> tiers = ruleRepository.findTiers(cardId);
        int prevPerf;
        Long tierId;
        List<MonthStatusRow> status = ruleRepository.findMonthStatus(userCardId, month.toString());
        if (!status.isEmpty()) {
            prevPerf = status.get(0).getPrevPerf();
            tierId = status.get(0).getTierId();
        } else {
            // 이번 달 기록이 아직 없으면 지난달 이용금액을 전월 실적으로 봅니다
            Integer lastMonthPerf = ruleRepository.findPerf(userCardId, month.minusMonths(1).toString());
            prevPerf = lastMonthPerf == null ? 0 : lastMonthPerf;
            tierId = null;
        }
        if (tierId == null) {
            tierId = pickTier(tiers, prevPerf);
        }
        if (tierId == null) {
            return withPromotion(BenefitResult.none(prevPerf, null), cardId, merchantId, category, merchantName, amount, at);
        }
        Integer totalLimit = findTotalLimit(tiers, tierId);

        // 2) 후보 혜택
        List<BenefitCandidateRow> candidates = ruleRepository.findCandidates(cardId, tierId, category, merchantName);
        if (candidates.isEmpty()) {
            return withPromotion(BenefitResult.none(prevPerf, tierId), cardId, merchantId, category, merchantName, amount, at);
        }

        // 3) 이번 달·오늘 이미 받은 혜택 (한도·횟수 계산용)
        Usage usage = loadUsage(userCardId, at);

        // 4) 후보마다 계산하고 가장 큰 것 선택
        BenefitCandidateRow best = null;
        int bestAmount = 0;
        for (BenefitCandidateRow c : candidates) {
            int benefit = benefitFor(c, amount, at, usage, totalLimit);
            if (benefit > bestAmount) {
                best = c;
                bestAmount = benefit;
            }
        }
        BenefitResult card = best == null
                ? BenefitResult.none(prevPerf, tierId)
                : new BenefitResult(best.getBenefitId(), best.getName(), bestAmount, null, null, 0, prevPerf, tierId);
        return withPromotion(card, cardId, merchantId, category, merchantName, amount, at);
    }

    /**
     * 프로모션을 더합니다. 카드 혜택과 중복 적용되고, 카드 혜택 한도(월/그룹/카드 통합)에는 포함되지 않습니다.
     * 한 결제에는 후보 중 금액이 가장 큰 프로모션 1개만 적용합니다. (payments 에 프로모션 칸이 하나뿐)
     * 프로모션 금액은 혜택과 달리 10원 단위 내림 없이 원 단위로 내립니다. (시드 데이터 기준)
     */
    private BenefitResult withPromotion(BenefitResult card, Long cardId, Long merchantId, String category,
                                        String merchantName, int amount, LocalDateTime at) {
        PromotionRow bestPromo = null;
        int bestAmount = 0;
        for (PromotionRow p : ruleRepository.findPromotions(cardId, merchantId, category, merchantName, at.toLocalDate(), amount)) {
            long value = "RATE".equals(p.getValueType())
                    ? p.getValue().multiply(BigDecimal.valueOf(amount)).divide(BigDecimal.valueOf(100)).longValue()
                    : Math.min(p.getValue().longValue(), amount);
            if (p.getMaxAmount() != null) value = Math.min(value, p.getMaxAmount());
            value = Math.min(value, amount);
            if (value > bestAmount) {
                bestPromo = p;
                bestAmount = (int) value;
            }
        }
        if (bestPromo == null) return card;
        return new BenefitResult(card.benefitId(), card.benefitName(), card.benefitAmount(),
                bestPromo.getPromotionId(), bestPromo.getName(), bestAmount, card.prevPerf(), card.tierId());
    }

    /** 후보 혜택 하나의 금액. 조건에 안 맞거나 한도가 남지 않았으면 0 */
    private int benefitFor(BenefitCandidateRow c, int amount, LocalDateTime at, Usage usage, Integer totalLimit) {
        if (!payTypeOk(c.getPayType())) return 0;
        if (c.getMinPayAmount() != null && amount < c.getMinPayAmount()) return 0;
        if (!timeOk(c.getTimeFrom(), c.getTimeTo(), at)) return 0;
        if (!dayOk(c.getDays(), at.getDayOfWeek())) return 0;

        BenefitUsageRow used = usage.month.get(c.getBenefitId());
        long monthCount = used == null ? 0 : used.getCnt();
        long monthUsageAmount = used == null ? 0 : used.getUsageAmount();
        long monthBenefit = used == null ? 0 : used.getBenefitAmount();
        long todayCount = usage.todayCount.getOrDefault(c.getBenefitId(), 0L);

        if (c.getDailyCount() != null && todayCount >= c.getDailyCount()) return 0;
        if (c.getMonthlyCount() != null && monthCount >= c.getMonthlyCount()) return 0;

        // 한도 기준이 '이용금액'이면 이용금액을 깎고, '혜택금액'이면 계산된 혜택을 깎습니다
        boolean usageBasis = "USAGE".equals(c.getLimitBasis());
        long base = amount;
        if (usageBasis) {
            if (c.getPerPaymentLimit() != null) base = Math.min(base, c.getPerPaymentLimit());
            if (c.getMonthlyLimit() != null) base = Math.min(base, Math.max(0, c.getMonthlyLimit() - monthUsageAmount));
        }

        long benefit = rawBenefit(c.getValueType(), c.getValue(), base);

        if (!usageBasis) {
            if (c.getPerPaymentLimit() != null) benefit = Math.min(benefit, c.getPerPaymentLimit());
            if (c.getMonthlyLimit() != null) benefit = Math.min(benefit, Math.max(0, c.getMonthlyLimit() - monthBenefit));
        }
        if (c.getGroupId() != null && c.getGroupMonthlyLimit() != null) {
            long groupUsed = usage.groupBenefit.getOrDefault(c.getGroupId(), 0L);
            benefit = Math.min(benefit, Math.max(0, c.getGroupMonthlyLimit() - groupUsed));
        }
        if (totalLimit != null) {
            benefit = Math.min(benefit, Math.max(0, totalLimit - usage.cardBenefit));
        }

        benefit = Math.min(benefit, amount);                 // 결제금액보다 많이 돌려주지는 않음
        return (int) (benefit / WON_UNIT * WON_UNIT);         // 10원 단위 내림
    }

    private long rawBenefit(String valueType, BigDecimal value, long base) {
        return switch (valueType) {
            case "RATE" -> value.multiply(BigDecimal.valueOf(base)).divide(BigDecimal.valueOf(100)).longValue();
            case "PER_LITER" -> value.multiply(BigDecimal.valueOf(base))
                    .divide(BigDecimal.valueOf(FUEL_PRICE_PER_LITER), 4, java.math.RoundingMode.DOWN).longValue();
            default -> Math.min(value.longValue(), base);    // FIXED: 정액 (이용금액보다 크진 않게)
        };
    }

    /** 이 결제는 SOL페이 결제화면(간편결제)으로 낸 것으로 봅니다. 다른 간편결제 전용 혜택은 제외 */
    private boolean payTypeOk(String payType) {
        if (payType == null) return true;
        return "PAY".equals(payType) || "SOLPAY".equals(payType);
    }

    private boolean timeOk(String from, String to, LocalDateTime at) {
        if (from == null || to == null) return true;
        String now = String.format("%02d:%02d", at.getHour(), at.getMinute());
        if (from.compareTo(to) <= 0) {
            return now.compareTo(from) >= 0 && now.compareTo(to) < 0;
        }
        return now.compareTo(from) >= 0 || now.compareTo(to) < 0;   // 자정을 넘기는 시간대
    }

    private boolean dayOk(String days, DayOfWeek today) {
        if (days == null || days.isBlank()) return true;
        String key = today.name().substring(0, 3);                    // MONDAY -> MON
        for (String d : days.split(",")) {
            if (d.trim().equals(key)) return true;
        }
        return false;
    }

    /** 전월 실적 이하 중 가장 높은 구간 */
    private Long pickTier(List<TierRow> tiers, int prevPerf) {
        Long picked = null;
        for (TierRow t : tiers) {                                      // tier_no 오름차순
            if (t.getMinAmount() <= prevPerf) picked = t.getTierId();
        }
        return picked;
    }

    private Integer findTotalLimit(List<TierRow> tiers, Long tierId) {
        for (TierRow t : tiers) {
            if (t.getTierId().equals(tierId)) return t.getTotalLimit();
        }
        return null;
    }

    private Usage loadUsage(Long userCardId, LocalDateTime at) {
        YearMonth month = YearMonth.from(at);
        LocalDateTime monthStart = month.atDay(1).atStartOfDay();
        LocalDateTime monthEnd = month.plusMonths(1).atDay(1).atStartOfDay();
        LocalDateTime dayStart = at.toLocalDate().atStartOfDay();
        LocalDateTime dayEnd = dayStart.plusDays(1);

        Usage usage = new Usage();
        for (BenefitUsageRow row : ruleRepository.findUsage(userCardId, monthStart, monthEnd)) {
            usage.month.put(row.getBenefitId(), row);
            usage.cardBenefit += row.getBenefitAmount();
            if (row.getGroupId() != null) {
                usage.groupBenefit.merge(row.getGroupId(), row.getBenefitAmount(), Long::sum);
            }
        }
        for (BenefitUsageRow row : ruleRepository.findUsage(userCardId, dayStart, dayEnd)) {
            usage.todayCount.put(row.getBenefitId(), row.getCnt());
        }
        return usage;
    }

    /** 이번 달·오늘 이미 받은 혜택 모음 */
    private static class Usage {
        final Map<Long, BenefitUsageRow> month = new HashMap<>();
        final Map<Long, Long> todayCount = new HashMap<>();
        final Map<Long, Long> groupBenefit = new HashMap<>();
        long cardBenefit = 0;
    }
}
