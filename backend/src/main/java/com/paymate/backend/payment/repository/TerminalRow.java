package com.paymate.backend.payment.repository;

public interface TerminalRow {

    Long getTerminalId();

    Long getMerchantId();

    String getMerchantName();

    String getCategory();
}
