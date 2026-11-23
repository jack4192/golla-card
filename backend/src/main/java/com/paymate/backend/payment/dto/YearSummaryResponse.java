package com.paymate.backend.payment.dto;

import java.util.List;

/**
 * 연말 결산의 받은 혜택 (2026-11-24). 올해 1월 1일부터 기준 시각까지 내 카드 결제에 기록된 카드 혜택(benefit)과
 * 가맹점 행사(promotion)를 더한 값. 금액은 원, from 은 'yyyy-MM-dd', until 은 'yyyy-MM-ddTHH:mm:ss' (서울 시간).
 *
 * @param months 1월부터 기준 시각의 달까지 빠짐없이 (결제가 없는 달은 0)
 * @param cards  결제가 있는 내 카드만, total 큰 순 (같으면 userCardId 작은 순)
 */
public record YearSummaryResponse(int year, String from, String until, int count, long benefit, long promotion,
                                  long total, List<MonthSum> months, List<CardSum> cards) {

    /** 한 달 합. month 는 'yyyy-MM'. */
    public record MonthSum(String month, int count, long benefit, long promotion, long total) {
    }

    /** 카드 한 장의 합. */
    public record CardSum(Long userCardId, String cardName, int count, long benefit, long promotion, long total) {
    }
}
