package com.paymate.backend.card.service;

import org.springframework.core.io.ClassPathResource;

/**
 * 카드 상품 이미지 주소. DB 의 image_url 이 있으면 그것을, 없으면 백엔드가 직접 제공하는 이미지
 * (src/main/resources/static/card-images/{카드번호}.webp → /card-images/{카드번호}.webp) 를 쓴다.
 * 이미지는 카드사 사이트에서 내려받아 넣어 둔 것이라 카드사 주소에 기대지 않는다. 주소는 서버 기준 경로라 앱이 서버 주소를 붙인다.
 */
public final class CardImages {

    private CardImages() {
    }

    public static String urlOf(Long cardId, String stored) {
        if (stored != null && !stored.isBlank()) {
            return stored;
        }
        if (cardId == null) {
            return null;
        }
        String path = "card-images/" + cardId + ".webp";
        return new ClassPathResource("static/" + path).exists() ? "/" + path : null;
    }
}
