package com.paymate.backend.card.repository;

public interface UserCardSummaryRow {

    Long getUserCardId();

    Long getCardId();

    String getIssuer();

    String getCardName();

    String getCardType();

    String getImageUrl();

    String getCardLast4();

}
