package com.paymate.backend.card.repository;

public interface CardProductRow {

    Long getCardId();

    String getCardName();

    String getIssuer();

    String getCardType();

    Integer getAnnualFeeDomestic();

    Integer getAnnualFeeOverseas();

    String getDescription();

    String getImageUrl();
}
