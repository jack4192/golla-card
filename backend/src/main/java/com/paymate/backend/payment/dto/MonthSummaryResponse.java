package com.paymate.backend.payment.dto;

/**
 * 지난 한 달 이용 (카드이용내역 화면 머리, 2026-11-24 사용자 요청 '실제 신한처럼').
 * from 은 기준 시각 한 달 전 같은 날 'yyyy-MM-dd', until 은 기준 시각 'yyyy-MM-ddTHH:mm:ss' (서울 시간), amount 는 결제 금액 합(원).
 */
public record MonthSummaryResponse(String from, String until, int count, long amount) {
}
